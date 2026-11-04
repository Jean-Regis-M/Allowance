/**
 * Mandate lifecycle orchestration. This is the only module that moves money,
 * and it only ever moves amounts computed by the Policy Engine.
 *
 *   DRAFT ──fund (Braintree hold)──▶ ACTIVE ──run agent──▶ SHOPPING
 *     SHOPPING ──cart ≤ auto-approve──▶ settle ──▶ SETTLED
 *     SHOPPING ──cart > auto-approve──▶ NEEDS_APPROVAL ──owner approves──▶ settle ──▶ SETTLED
 *     SHOPPING ──no compliant cart──▶ ACTIVE (hold kept, owner can retry or cancel)
 *     DRAFT/ACTIVE/NEEDS_APPROVAL ──cancel──▶ CANCELLED (hold voided)
 */
import { randomBytes } from "node:crypto";
import * as braintreeGateway from "./braintree";
import { toCents, formatUSD, type Mandate, type MandateDraft } from "./domain";
import { compileMandate } from "./ai/compile";
import { runAgent, type AgentEvent } from "./ai/agent";
import { activeModel, type ChatModel } from "./ai/llm";
import { compromisedAgent } from "./ai/redteam";
import { evaluateCart } from "./policy";
import { catalog, searchCatalog } from "./catalog";
import { appendLedger, getLedger, getMandate, saveMandate, transition } from "./store";

export type Gateway = Pick<typeof braintreeGateway, "holdBudget" | "settleExact" | "releaseHold" | "refund" | "findTransaction" | "sandboxSettle" | "isSandbox">;

export interface ServiceDeps {
  gateway?: Gateway;
  model?: ChatModel;
  compile?: (request: string) => Promise<MandateDraft>;
  /** Owner the new mandate is bound to (from the middleware-issued cookie). */
  ownerId?: string;
  /** Red-team: run a scripted compromised agent through the real firewall. Never settles. */
  simulation?: boolean;
}

const DEFAULT_AUTO_APPROVE = toCents(Number(process.env.AUTO_APPROVE_UNDER_USD ?? 150));
const MANDATE_DAYS = 7;

export const newId = (prefix: string) => `${prefix}_${randomBytes(6).toString("hex")}`;

function must(id: string): Mandate {
  const m = getMandate(id);
  if (!m) throw new Error(`Mandate ${id} not found`);
  return m;
}

/** 1. Plain English → reviewable DRAFT mandate (AI). */
export async function draftMandate(request: string, deps: ServiceDeps = {}): Promise<{ mandate: Mandate; questions: string[] }> {
  const text = request.trim().slice(0, 1000);
  if (text.length < 8) throw new Error("Describe the task in a sentence or two.");
  const d = await (deps.compile ?? compileMandate)(text);
  const m: Mandate = {
    id: newId("md"),
    ownerId: deps.ownerId,
    title: d.title || "Purchasing task",
    purpose: d.purpose,
    request: text,
    preferences: d.preferences,
    status: "DRAFT",
    holdId: null,
    authorizedAmount: 0,
    capturedAmount: 0,
    pendingCart: null,
    order: null,
    createdAt: new Date().toISOString(),
    rules: {
      budget: toCents(d.budgetUSD),
      maxPerItem: toCents(d.maxPerItemUSD),
      allowedCategories: d.allowedCategories,
      allowedMerchants: d.allowedMerchants,
      mustArriveByDays: d.mustArriveByDays,
      maxUnitsPerProduct: d.maxUnitsPerProduct,
      autoApproveUnder: Math.min(DEFAULT_AUTO_APPROVE, toCents(d.budgetUSD)),
      expiresAt: new Date(Date.now() + MANDATE_DAYS * 86_400_000).toISOString(),
    },
  };
  saveMandate(m);
  appendLedger(m.id, "owner", "request", `Owner asked: "${text.slice(0, 140)}"`, { request: text });
  appendLedger(m.id, "agent", "mandate.compiled", `AI compiled mandate "${m.title}" with ${formatUSD(m.rules.budget)} budget`, { draft: d });
  return { mandate: m, questions: d.questions };
}

/** Owner edits before funding. Only DRAFT mandates are editable; values are re-validated. */
export function updateDraftRules(id: string, patch: Partial<Pick<Mandate["rules"], "budget" | "autoApproveUnder" | "maxUnitsPerProduct" | "mustArriveByDays">>): Mandate {
  const m = must(id);
  if (m.status !== "DRAFT") throw new Error("Rules are frozen once the mandate is funded.");
  const r = { ...m.rules };
  if (patch.budget !== undefined) r.budget = Math.max(100, Math.min(500_000, Math.round(patch.budget)));
  if (patch.autoApproveUnder !== undefined) r.autoApproveUnder = Math.max(0, Math.round(patch.autoApproveUnder));
  if (patch.maxUnitsPerProduct !== undefined) r.maxUnitsPerProduct = Math.max(1, Math.min(50, Math.round(patch.maxUnitsPerProduct)));
  if (patch.mustArriveByDays !== undefined) r.mustArriveByDays = Math.max(0, Math.min(60, Math.round(patch.mustArriveByDays)));
  r.autoApproveUnder = Math.min(r.autoApproveUnder, r.budget);
  m.rules = r;
  saveMandate(m);
  appendLedger(m.id, "owner", "mandate.edited", "Owner adjusted mandate limits", { rules: r });
  return m;
}

/** 2. Fund: the owner's card authorizes a hold for the budget via PayPal Braintree. */
export async function fundMandate(id: string, paymentMethodNonce: string, deps: ServiceDeps = {}): Promise<Mandate> {
  const gw = deps.gateway ?? braintreeGateway;
  const m = must(id);
  if (m.status !== "DRAFT") throw new Error(`Mandate is ${m.status}; it can only be funded once.`);
  if (m.rules.budget <= 0) throw new Error("Set a budget before funding.");
  transition(id, ["DRAFT"], "AWAITING_FUNDING");
  try {
    const hold = await gw.holdBudget(m.id, m.rules.budget, paymentMethodNonce);
    const fresh = must(id);
    fresh.status = "ACTIVE";
    fresh.holdId = hold.id;
    fresh.authorizedAmount = hold.amount;
    fresh.card = { brand: hold.cardType, last4: hold.last4 };
    saveMandate(fresh);
    appendLedger(id, "paypal", "hold.authorized", `PayPal Braintree authorized a ${formatUSD(hold.amount)} hold (txn ${hold.id})`, hold);
    return fresh;
  } catch (e) {
    const back = must(id);
    back.status = "DRAFT";
    saveMandate(back);
    appendLedger(id, "paypal", "hold.failed", `Hold failed: ${(e as Error).message.slice(0, 160)}`, { error: (e as Error).message });
    throw e;
  }
}

/** 3. Run the agent. Streams events; settles automatically if within the auto-approve threshold. */
export async function runMandate(id: string, emit: (e: AgentEvent | { kind: "status"; mandate: Mandate }) => void, deps: ServiceDeps = {}): Promise<Mandate> {
  const sim = deps.simulation === true;
  const m = transition(id, ["ACTIVE"], "SHOPPING");
  const runStart = appendLedger(
    id, "agent", sim ? "redteam.started" : "agent.started",
    sim ? "RED-TEAM SIMULATION: scripted compromised agent that obeys injected listing text" : "Purchasing agent started",
  );
  emit({ kind: "status", mandate: m });

  const result = await runAgent(
    m,
    { catalog, search: searchCatalog, model: sim ? compromisedAgent() : deps.model, rawListings: sim },
    (e) => {
      if (e.kind === "shield") appendLedger(id, "policy", "shield.flagged", `Listing shield sanitised "${e.productName}": ${e.reasons.join(", ")}`, e);
      if (e.kind === "tool") appendLedger(id, "agent", `tool.${e.name}`, `Agent called ${e.name}: ${e.summary}`, { input: e.input });
      if (e.kind === "policy") {
        appendLedger(
          id, "policy", e.decision.allowed ? "policy.approved" : "policy.blocked",
          e.decision.allowed
            ? `Firewall approved cart: ${formatUSD(e.decision.total)}`
            : `Firewall BLOCKED cart: ${e.decision.violations.map((v) => v.code).join(", ")}`,
          { cart: e.cart, total: e.decision.total, violations: e.decision.violations, rationale: e.rationale },
        );
      }
      if (e.kind === "error") appendLedger(id, "system", "agent.error", e.message);
      emit(e);
    },
  );

  const d = result.decision;
  if (sim) {
    const back = must(id);
    back.status = "ACTIVE";
    saveMandate(back);
    const blocked = getLedger(id).filter((e) => e.seq > runStart.seq && e.type === "policy.blocked").length;
    appendLedger(id, "system", "redteam.finished", `Red-team simulation finished: firewall blocked ${blocked} cart(s). $0.00 charged; hold untouched.`);
    emit({ kind: "status", mandate: back });
    return back;
  }
  if (!d || !d.allowed) {
    const back = must(id);
    back.status = "ACTIVE";
    saveMandate(back);
    appendLedger(id, "agent", "agent.no_cart", "Agent finished without a compliant cart. Hold kept; nothing was charged.");
    emit({ kind: "status", mandate: back });
    return back;
  }

  appendLedger(id, "agent", "agent.finished", `Agent (${activeModel()}) proposed a compliant cart of ${formatUSD(d.total)}`, { model: activeModel() });
  const fresh = must(id);
  fresh.pendingCart = { lines: d.lines, total: d.total, rationale: result.rationale };
  if (d.requiresHumanApproval) {
    fresh.status = "NEEDS_APPROVAL";
    saveMandate(fresh);
    appendLedger(id, "policy", "approval.required", `Cart ${formatUSD(d.total)} is above the ${formatUSD(fresh.rules.autoApproveUnder)} auto-approve limit: owner approval required`);
    emit({ kind: "status", mandate: fresh });
    return fresh;
  }
  saveMandate(fresh);
  const settled = await settle(id, deps);
  emit({ kind: "status", mandate: settled });
  return settled;
}

/** Owner approves a pending cart (step-up). */
export async function approvePending(id: string, deps: ServiceDeps = {}): Promise<Mandate> {
  const m = must(id);
  if (m.status !== "NEEDS_APPROVAL" || !m.pendingCart) throw new Error("Nothing is waiting for approval.");
  appendLedger(id, "owner", "approval.granted", `Owner approved ${formatUSD(m.pendingCart.total)}`);
  return settle(id, deps);
}

/** Settle exactly the re-validated cart total against the hold. */
async function settle(id: string, deps: ServiceDeps): Promise<Mandate> {
  const gw = deps.gateway ?? braintreeGateway;
  const m = must(id);
  if (!m.pendingCart || !m.holdId) throw new Error("No cart to settle.");
  // Re-validate at the moment of payment: rules, stock, prices may have changed.
  const recheck = evaluateCart({ ...m, status: "ACTIVE" }, m.pendingCart.lines.map((l) => ({ productId: l.productId, quantity: l.quantity })), catalog);
  if (!recheck.allowed || recheck.total !== m.pendingCart.total) {
    appendLedger(id, "policy", "settle.refused", "Cart no longer passes policy at payment time", { violations: recheck.violations });
    throw new Error("Cart no longer passes policy; payment refused.");
  }
  const locked = transition(id, ["SHOPPING", "NEEDS_APPROVAL"], "SHOPPING");
  const txn = await gw.settleExact(locked.holdId!, recheck.total);
  appendLedger(id, "paypal", "payment.submitted", `PayPal Braintree submitted ${formatUSD(txn.amount)} for settlement; ${formatUSD(locked.authorizedAmount - txn.amount)} of the hold released`, txn);
  let confirmed = txn;
  if (gw.isSandbox()) {
    confirmed = await gw.sandboxSettle(txn.id);
    appendLedger(id, "paypal", "payment.settled.sandbox", `Sandbox settlement batch run: status ${confirmed.status}`, confirmed);
  }
  const verified = await gw.findTransaction(txn.id);
  const done = must(id);
  done.status = "SETTLED";
  done.capturedAmount = verified.amount;
  done.order = { lines: recheck.lines, total: verified.amount, rationale: locked.pendingCart!.rationale, transactionId: verified.id, gatewayStatus: verified.status, settledAt: new Date().toISOString(), refunded: 0 };
  done.pendingCart = null;
  saveMandate(done);
  appendLedger(id, "paypal", "payment.verified", `Verified with PayPal Braintree: ${verified.status}, ${formatUSD(verified.amount)}`, verified);
  return done;
}

/** Cancel: void the hold so no money moves. */
export async function cancelMandate(id: string, deps: ServiceDeps = {}): Promise<Mandate> {
  const gw = deps.gateway ?? braintreeGateway;
  const m = must(id);
  if (!["DRAFT", "ACTIVE", "NEEDS_APPROVAL"].includes(m.status)) throw new Error(`Cannot cancel a ${m.status} mandate.`);
  if (m.holdId) {
    const v = await gw.releaseHold(m.holdId);
    appendLedger(id, "paypal", "hold.voided", `Hold ${m.holdId} voided: ${v.status}. No money moved.`, v);
  }
  const c = must(id);
  c.status = "CANCELLED";
  c.pendingCart = null;
  saveMandate(c);
  appendLedger(id, "owner", "mandate.cancelled", "Owner cancelled the mandate");
  return c;
}

/** Owner-approved refund of a settled order (amount bounded by what was paid). */
export async function refundOrder(id: string, amount: number, reason: string, deps: ServiceDeps = {}): Promise<Mandate> {
  const gw = deps.gateway ?? braintreeGateway;
  const m = must(id);
  if (m.status !== "SETTLED" || !m.order) throw new Error("Only settled orders can be refunded.");
  const refundable = m.order.total - m.order.refunded;
  const amt = Math.round(amount);
  if (amt <= 0 || amt > refundable) throw new Error(`Refund must be between $0.01 and ${formatUSD(refundable)}.`);
  const r = await gw.refund(m.order.transactionId, amt);
  m.order.refunded += r.amount;
  saveMandate(m);
  appendLedger(id, "paypal", "refund.issued", `Refunded ${formatUSD(r.amount)} via PayPal Braintree (txn ${r.id}): ${reason.slice(0, 120)}`, r);
  return m;
}
