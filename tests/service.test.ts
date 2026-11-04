import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabaseForTests, getLedger, verifyLedger, getMandate } from "../src/lib/store";
import { approvePending, cancelMandate, draftMandate, fundMandate, refundOrder, runMandate, type Gateway } from "../src/lib/service";
import type { ChatModel, ToolCall } from "../src/lib/ai/llm";
import type { MandateDraft } from "../src/lib/domain";
import type { TxnView } from "../src/lib/braintree";

const draft: MandateDraft = {
  title: "Weekly café restock", purpose: "Restock oat milk, cups and lids", budgetUSD: 180, maxPerItemUSD: 0,
  allowedCategories: ["dairy-alternatives", "packaging"], allowedMerchants: ["m_greenleaf", "m_packright"],
  mustArriveByDays: 5, maxUnitsPerProduct: 6, preferences: ["compostable"], questions: [],
};

/** In-memory stand-in for Braintree that enforces the same invariants. */
function fakeGateway() {
  const txns = new Map<string, TxnView>();
  const calls: string[] = [];
  let n = 0;
  const gw: Gateway = {
    isSandbox: () => true,
    async holdBudget(_m, budget) { calls.push(`hold:${budget}`); const t = { id: `t${++n}`, status: "authorized", amount: budget, paymentInstrument: "credit_card", last4: "1111", cardType: "Visa", updatedAt: "" }; txns.set(t.id, t); return t; },
    async settleExact(id, amount) { const t = txns.get(id)!; if (t.status !== "authorized" || amount > t.amount) throw new Error("bad settle"); calls.push(`settle:${amount}`); const s = { ...t, status: "submitted_for_settlement", amount }; txns.set(id, s); return s; },
    async sandboxSettle(id) { const s = { ...txns.get(id)!, status: "settled" }; txns.set(id, s); return s; },
    async findTransaction(id) { return txns.get(id)!; },
    async releaseHold(id) { calls.push(`void:${id}`); const v = { ...txns.get(id)!, status: "voided" }; txns.set(id, v); return v; },
    async refund(id, amount) { calls.push(`refund:${amount}`); return { ...txns.get(id)!, id: `r${++n}`, amount, status: "submitted_for_settlement" }; },
  };
  return { gw, calls };
}

function scripted(turns: ToolCall[][]): ChatModel {
  let i = 0;
  return async () => { const calls = turns[Math.min(i++, turns.length - 1)]; return { text: "Working.", calls, raw: { role: "model", parts: [{ text: "Working." }] } }; };
}

const goodCart = { lines: [{ productId: "p_oat_barista_6", quantity: 3 }, { productId: "p_cups_12oz_500", quantity: 1 }, { productId: "p_lids_12oz_500", quantity: 1 }], rationale: "Barista oat milk foams best; compostable cups and matching lids." };
const hijacked = { lines: [{ productId: "p_lids_bulk_promo", quantity: 40 }, { productId: "p_descaler_pro", quantity: 1 }], rationale: "Owner pre-approved bulk order." };

beforeEach(() => resetDatabaseForTests(":memory:"));

describe("mandate lifecycle", () => {
  it("draft → fund → agent (blocked, then compliant) → auto-settle exact total", async () => {
    const { gw, calls } = fakeGateway();
    const { mandate } = await draftMandate("Restock oat milk, cups and lids under $180", { compile: async () => draft });
    expect(mandate.status).toBe("DRAFT");

    const funded = await fundMandate(mandate.id, "fake-valid-nonce", { gateway: gw });
    expect(funded.status).toBe("ACTIVE");
    expect(funded.authorizedAmount).toBe(18000);

    const model = scripted([[{ name: "submit_cart", args: hijacked }], [{ name: "submit_cart", args: goodCart }]]);
    const done = await runMandate(mandate.id, () => {}, { gateway: gw, model });
    const expected = 2149 * 3 + 4650 + 2975;
    expect(done.status).toBe("SETTLED");
    expect(done.capturedAmount).toBe(expected);
    expect(calls).toEqual(["hold:18000", `settle:${expected}`]);

    const types = getLedger(mandate.id).map((e) => e.type);
    expect(types).toContain("policy.blocked");
    expect(types).toContain("payment.verified");
    expect(verifyLedger().ok).toBe(true);
  });

  it("pauses for owner approval above the threshold and settles only after approval", async () => {
    const { gw, calls } = fakeGateway();
    const { mandate } = await draftMandate("Restock oat milk, cups and lids under $180", { compile: async () => ({ ...draft }) });
    await fundMandate(mandate.id, "nonce", { gateway: gw });
    // lower threshold below cart total
    const m = getMandate(mandate.id)!; m.rules.autoApproveUnder = 5000;
    (await import("../src/lib/store")).saveMandate(m);
    const waiting = await runMandate(mandate.id, () => {}, { gateway: gw, model: scripted([[{ name: "submit_cart", args: goodCart }]]) });
    expect(waiting.status).toBe("NEEDS_APPROVAL");
    expect(calls.some((c) => c.startsWith("settle"))).toBe(false);
    const done = await approvePending(mandate.id, { gateway: gw });
    expect(done.status).toBe("SETTLED");
  });

  it("keeps the hold and charges nothing when the agent never finds a compliant cart", async () => {
    const { gw, calls } = fakeGateway();
    const { mandate } = await draftMandate("Restock lids under $180", { compile: async () => draft });
    await fundMandate(mandate.id, "nonce", { gateway: gw });
    const out = await runMandate(mandate.id, () => {}, { gateway: gw, model: scripted([[{ name: "submit_cart", args: hijacked }]]) });
    expect(out.status).toBe("ACTIVE");
    expect(calls.filter((c) => c.startsWith("settle"))).toEqual([]);
    const cancelled = await cancelMandate(mandate.id, { gateway: gw });
    expect(cancelled.status).toBe("CANCELLED");
    expect(calls.at(-1)).toMatch(/^void:/);
  });

  it("bounds refunds by what was paid", async () => {
    const { gw } = fakeGateway();
    const { mandate } = await draftMandate("Restock oat milk, cups and lids under $180", { compile: async () => draft });
    await fundMandate(mandate.id, "nonce", { gateway: gw });
    await runMandate(mandate.id, () => {}, { gateway: gw, model: scripted([[{ name: "submit_cart", args: goodCart }]]) });
    await expect(refundOrder(mandate.id, 999999, "too much", { gateway: gw })).rejects.toThrow();
    const r = await refundOrder(mandate.id, 1250, "one dented case", { gateway: gw });
    expect(r.order?.refunded).toBe(1250);
  });

  it("refuses to fund twice and refuses to run an unfunded mandate", async () => {
    const { gw } = fakeGateway();
    const { mandate } = await draftMandate("Restock oat milk under $180", { compile: async () => draft });
    await expect(runMandate(mandate.id, () => {}, { gateway: gw })).rejects.toThrow(/DRAFT/);
    await fundMandate(mandate.id, "nonce", { gateway: gw });
    await expect(fundMandate(mandate.id, "nonce", { gateway: gw })).rejects.toThrow();
  });
});
