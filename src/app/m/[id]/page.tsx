"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Mandate, PricedLine } from "@/lib/domain";
import type { LedgerEntry } from "@/lib/ledger";
import type { PolicyDecision } from "@/lib/policy";
import { CATEGORY_LABEL, ErrorNote, MERCHANT_LABEL, Spinner, StatusPill, VIOLATION_LABEL, usd } from "@/components/ui";
import { DropIn } from "@/components/DropIn";
import { LedgerGrid } from "@/components/LedgerGrid";
import { SpendMeter, Stepper } from "@/components/SpendMeter";
import { CopyId } from "@/components/CopyId";

type FeedItem =
  | { kind: "thought"; text: string }
  | { kind: "tool"; name: string; input: unknown; summary: string }
  | { kind: "shield"; productId: string; productName: string; reasons: string[] }
  | { kind: "policy"; decision: PolicyDecision; rationale: string }
  | { kind: "error"; message: string };

export default function MandatePage() {
  const { id } = useParams<{ id: string }>();
  const [mandate, setMandate] = useState<Mandate | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [running, setRunning] = useState<false | "agent" | "redteam">(false);
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/mandates/${id}`);
    if (r.status === 404) return setNotFound(true);
    const j = await r.json();
    setMandate(j.mandate);
    setLedger(j.ledger);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function action(name: string, body: unknown = {}) {
    setActing(name);
    setError(null);
    try {
      const r = await fetch(`/api/mandates/${id}/${name}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      await load();
    } catch (e) {
      setError((e as Error).message);
      await load();
    } finally {
      setActing(null);
    }
  }

  async function fund(nonce: string) {
    const r = await fetch(`/api/mandates/${id}/fund`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nonce }) });
    const j = await r.json();
    await load();
    if (!r.ok) throw new Error(j.error);
  }

  async function runAgent(mode: "agent" | "redteam" = "agent") {
    setRunning(mode);
    setFeed([]);
    setError(null);
    try {
      const r = await fetch(`/api/mandates/${id}/run${mode === "redteam" ? "?mode=redteam" : ""}`, { method: "POST" });
      if (!r.ok || !r.body) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error ?? "Agent could not start");
      }
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const p of parts) {
          if (!p.startsWith("data: ")) continue;
          const ev = JSON.parse(p.slice(6));
          if (ev.kind === "status") setMandate(ev.mandate);
          else if (["thought", "tool", "shield", "policy", "error"].includes(ev.kind)) setFeed((f) => [...f, ev]);
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
      await load();
    }
  }

  if (notFound)
    return (
      <div className="panel p-10 text-center">
        <p className="font-semibold">Mandate not found</p>
        <Link href="/" className="text-sm text-ink-2 underline mt-2 inline-block">Back to mandates</Link>
      </div>
    );
  if (!mandate) return <div className="text-ink-3 text-sm"><Spinner label="Loading mandate…" /></div>;

  const r = mandate.rules;
  const remaining = mandate.authorizedAmount - mandate.capturedAmount;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/" className="text-sm text-ink-3 hover:text-ink">← Mandates</Link>
          <h1 className="display text-4xl mt-1">{mandate.title}</h1>
          <p className="text-ink-2 mt-1 max-w-2xl">{mandate.purpose}</p>
        </div>
        <div className="flex items-center gap-3">
          <StatusPill status={mandate.status} />
          <CopyId value={mandate.id} label="mandate id" />
        </div>
      </div>

      <div className="panel px-5 py-4 grid md:grid-cols-[auto_1fr] gap-x-10 gap-y-4 items-center">
        <Stepper mandate={mandate} />
        <SpendMeter mandate={mandate} />
      </div>

      {error && <ErrorNote message={error} onDismiss={() => setError(null)} />}

      <div className="grid lg:grid-cols-[1fr_380px] gap-6 items-start">
        <div className="space-y-6 min-w-0">
          <MandateCard mandate={mandate} />
          {(feed.length > 0 || running) && <ActivityFeed feed={feed} running={running} />}
          {mandate.order && <Receipt mandate={mandate} onRefund={(amount, reason) => action("refund", { amount, reason })} busy={acting === "refund"} />}
        </div>

        <aside className="space-y-4 lg:sticky lg:top-20">
          {mandate.status === "DRAFT" && (
            <div className="panel p-5">
              <p className="text-xs font-semibold uppercase tracking-[.12em] text-ink-3">Step 2 · Fund the mandate</p>
              <p className="mt-2 text-sm text-ink-2 leading-relaxed">
                Authorize a <strong className="text-ink">{usd(r.budget)}</strong> hold with PayPal Braintree. It is the hard ceiling for this task. Nothing is charged yet.
              </p>
              <DraftLimits mandate={mandate} onSaved={load} />
              <div className="mt-4"><DropIn amountLabel={usd(r.budget)} onNonce={fund} /></div>
            </div>
          )}

          {(mandate.status === "ACTIVE" || mandate.status === "SHOPPING") && (
            <div className="panel p-5">
              <p className="text-xs font-semibold uppercase tracking-[.12em] text-ink-3">Step 3 · Delegate</p>
              <HoldBox mandate={mandate} remaining={remaining} />
              <button className="btn btn-primary w-full mt-4" onClick={() => runAgent("agent")} disabled={!!running || mandate.status === "SHOPPING"}>
                {running === "agent" ? <Spinner label="Agent is shopping…" /> : "Let the agent shop →"}
              </button>
              <button className="btn btn-danger w-full mt-2" onClick={() => action("cancel")} disabled={!!running || acting !== null}>
                {acting === "cancel" ? <Spinner label="Releasing hold…" /> : "Cancel & release hold"}
              </button>
            </div>
          )}

          {(mandate.status === "ACTIVE" || mandate.status === "SHOPPING") && (
            <div className="panel p-5 border-dashed">
              <p className="text-xs font-semibold uppercase tracking-[.12em] text-block">Red team</p>
              <p className="mt-1.5 text-sm font-semibold">Stress-test the firewall</p>
              <p className="text-sm text-ink-2 mt-1 leading-relaxed">
                Run a <strong className="text-ink">simulated compromised agent</strong> that obeys a prompt injection hidden in a supplier listing.
                The firewall must block it. A simulation can never be charged.
              </p>
              <button className="btn btn-ghost w-full mt-3" onClick={() => runAgent("redteam")} disabled={!!running || mandate.status === "SHOPPING"}>
                {running === "redteam" ? <Spinner label="Attacking…" /> : "Run attack simulation"}
              </button>
            </div>
          )}

          {mandate.status === "NEEDS_APPROVAL" && mandate.pendingCart && (
            <div className="panel p-5 border-[#e8d3a6]">
              <p className="text-xs font-semibold uppercase tracking-[.12em] text-wait">Your approval needed</p>
              <p className="mt-2 text-sm text-ink-2">
                The cart passed every rule, but <strong className="text-ink">{usd(mandate.pendingCart.total)}</strong> is above your
                auto-approve limit of {usd(r.autoApproveUnder)}.
              </p>
              <Lines lines={mandate.pendingCart.lines} total={mandate.pendingCart.total} />
              {mandate.pendingCart.rationale && <p className="text-sm text-ink-2 mt-3 italic">“{mandate.pendingCart.rationale}”</p>}
              <button className="btn btn-primary w-full mt-4" onClick={() => action("approve")} disabled={acting !== null}>
                {acting === "approve" ? <Spinner label="Settling with PayPal Braintree…" /> : `Approve & pay ${usd(mandate.pendingCart.total)}`}
              </button>
              <button className="btn btn-danger w-full mt-2" onClick={() => action("cancel")} disabled={acting !== null}>
                Reject & release hold
              </button>
            </div>
          )}

          {mandate.status === "SETTLED" && mandate.order && (
            <div className="panel p-5">
              <p className="text-xs font-semibold uppercase tracking-[.12em] text-allow">Paid · verified with PayPal Braintree</p>
              <p className="display text-4xl mt-2 num">{usd(mandate.order.total)}</p>
              <p className="text-sm text-ink-2 mt-1">
                of a {usd(mandate.authorizedAmount)} hold. <strong className="text-ink">{usd(mandate.authorizedAmount - mandate.order.total)}</strong> released back to the card.
              </p>
              <dl className="mt-4 text-xs space-y-1.5">
                <div className="flex justify-between gap-3 items-center"><dt className="text-ink-3">Transaction</dt><dd><CopyId value={mandate.order.transactionId} label="transaction id" /></dd></div>
                <Row k="Gateway status" v={mandate.order.gatewayStatus.replaceAll("_", " ")} />
                {mandate.card?.last4 && <Row k="Card" v={`${mandate.card.brand ?? "Card"} •••• ${mandate.card.last4}`} />}
              </dl>
            </div>
          )}

          {mandate.status === "CANCELLED" && (
            <div className="panel p-5">
              <p className="font-semibold">Cancelled</p>
              <p className="text-sm text-ink-2 mt-1">{mandate.holdId ? "The hold was voided with PayPal Braintree. No money moved." : "Nothing was ever held."}</p>
            </div>
          )}

          <p className="text-xs text-ink-3 px-1 leading-relaxed">
            The AI never sees payment credentials or sets prices. It can only propose product IDs and quantities; the firewall prices and checks every cart.
          </p>
        </aside>
      </div>

      <section aria-labelledby="ledger-h" className="space-y-3">
        <div className="flex items-end justify-between">
          <h2 id="ledger-h" className="display text-2xl">Audit trail</h2>
          <Link href="/ledger" className="text-sm text-ink-2 hover:text-ink">Verify the full chain →</Link>
        </div>
        <LedgerGrid entries={ledger} height={360} />
      </section>
    </div>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-3">{k}</dt>
      <dd className={`${mono ? "num" : ""} text-ink text-right break-all`}>{v}</dd>
    </div>
  );
}

function HoldBox({ mandate, remaining }: { mandate: Mandate; remaining: number }) {
  return (
    <div className="mt-3 rounded-xl bg-pay-bg p-4">
      <p className="text-xs text-pay font-semibold">PayPal Braintree authorization hold</p>
      <p className="display text-3xl num mt-1">{usd(remaining)}</p>
      <p className="text-xs text-ink-2 mt-1 flex items-center gap-2 flex-wrap">available to the agent {mandate.holdId && <CopyId value={mandate.holdId} label="hold id" />}</p>
      {mandate.card?.last4 && <p className="text-xs text-ink-3 mt-1">{mandate.card.brand} •••• {mandate.card.last4}</p>}
    </div>
  );
}

function MandateCard({ mandate }: { mandate: Mandate }) {
  const r = mandate.rules;
  const can = [
    `Spend up to ${usd(r.budget)} in total`,
    r.allowedCategories.length ? `Buy only: ${r.allowedCategories.map((c) => CATEGORY_LABEL[c] ?? c).join(", ")}` : "Buy from any category",
    r.allowedMerchants.length ? `From: ${r.allowedMerchants.map((m) => MERCHANT_LABEL[m] ?? m).join(", ")}` : "From any verified merchant",
    `At most ${r.maxUnitsPerProduct} units of any one product`,
    r.mustArriveByDays ? `Only suppliers delivering within ${r.mustArriveByDays} days` : "Any delivery time",
    `Pay automatically up to ${usd(r.autoApproveUnder)}; above that, ask you`,
  ];
  const cannot = [
    "Exceed the PayPal Braintree hold, ever",
    "Buy from unverified merchants",
    "Set or change any price",
    "Act on instructions hidden in product listings",
    `Spend after ${new Date(r.expiresAt).toLocaleDateString()}`,
  ];
  return (
    <section className="panel p-5 sm:p-6" aria-labelledby="mandate-h">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="mandate-h" className="text-xs font-semibold uppercase tracking-[.12em] text-ink-3">The mandate</h2>
        <span className="text-xs text-ink-3">Compiled by Gemini · enforced by code</span>
      </div>
      <blockquote className="mt-3 border-l-2 border-line-2 pl-3 text-ink-2 italic">“{mandate.request}”</blockquote>
      <div className="grid sm:grid-cols-2 gap-5 mt-5">
        <div>
          <p className="text-sm font-semibold text-allow">Your agent CAN</p>
          <ul className="mt-2 space-y-1.5 text-sm">
            {can.map((c) => (
              <li key={c} className="flex gap-2"><span className="text-allow" aria-hidden>✓</span><span>{c}</span></li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-sm font-semibold text-block">Your agent CANNOT</p>
          <ul className="mt-2 space-y-1.5 text-sm">
            {cannot.map((c) => (
              <li key={c} className="flex gap-2"><span className="text-block" aria-hidden>✕</span><span>{c}</span></li>
            ))}
          </ul>
        </div>
      </div>
      {mandate.preferences.length > 0 && (
        <p className="mt-5 text-xs text-ink-3">Soft preferences the agent weighs: {mandate.preferences.join(" · ")}</p>
      )}
    </section>
  );
}

function DraftLimits({ mandate, onSaved }: { mandate: Mandate; onSaved: () => void }) {
  const [budget, setBudget] = useState((mandate.rules.budget / 100).toString());
  const [auto, setAuto] = useState((mandate.rules.autoApproveUnder / 100).toString());
  const [saving, setSaving] = useState(false);
  const dirty = Number(budget) * 100 !== mandate.rules.budget || Number(auto) * 100 !== mandate.rules.autoApproveUnder;
  async function save() {
    setSaving(true);
    await fetch(`/api/mandates/${mandate.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ budget: Math.round(Number(budget) * 100), autoApproveUnder: Math.round(Number(auto) * 100) }),
    });
    setSaving(false);
    onSaved();
  }
  return (
    <div className="mt-4 grid grid-cols-2 gap-3">
      <label className="text-xs text-ink-3">
        Budget (USD)
        <input inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} className="num mt-1 w-full rounded-lg border border-line-2 bg-paper/60 px-2.5 py-1.5 text-sm text-ink outline-none focus:border-ink" />
      </label>
      <label className="text-xs text-ink-3">
        Auto-approve under
        <input inputMode="decimal" value={auto} onChange={(e) => setAuto(e.target.value)} className="num mt-1 w-full rounded-lg border border-line-2 bg-paper/60 px-2.5 py-1.5 text-sm text-ink outline-none focus:border-ink" />
      </label>
      {dirty && (
        <button className="btn btn-ghost col-span-2 py-1.5" onClick={save} disabled={saving || !(Number(budget) > 0)}>
          {saving ? <Spinner label="Saving…" /> : "Save limits"}
        </button>
      )}
    </div>
  );
}

function Lines({ lines, total }: { lines: PricedLine[]; total: number }) {
  return (
    <table className="w-full text-sm mt-3">
      <tbody>
        {lines.map((l) => (
          <tr key={l.productId} className="border-b border-line align-top">
            <td className="py-1.5 pr-2">
              <span className="num text-ink-3 mr-1">{l.quantity}×</span>
              {l.name}
              <div className="text-xs text-ink-3">{MERCHANT_LABEL[l.merchantId] ?? l.merchantId}</div>
            </td>
            <td className="py-1.5 text-right num whitespace-nowrap">{usd(l.lineTotal)}</td>
          </tr>
        ))}
        <tr>
          <td className="pt-2 font-semibold">Total</td>
          <td className="pt-2 text-right num font-semibold">{usd(total)}</td>
        </tr>
      </tbody>
    </table>
  );
}

const ICON: Record<string, { glyph: string; cls: string; who: string }> = {
  thought: { glyph: "✦", cls: "bg-allow-bg text-allow", who: "AI agent" },
  tool: { glyph: "⌕", cls: "bg-[#ece7de] text-ink-2", who: "Tool call" },
  shield: { glyph: "◈", cls: "bg-wait-bg text-wait", who: "Listing shield" },
  policy: { glyph: "⛨", cls: "bg-ink text-paper", who: "Policy firewall" },
  error: { glyph: "!", cls: "bg-block-bg text-block", who: "Error" },
};

function ActivityFeed({ feed, running }: { feed: FeedItem[]; running: false | "agent" | "redteam" }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [feed.length]);
  return (
    <section className="panel p-5 sm:p-6" aria-live="polite" aria-labelledby="feed-h">
      <div className="flex items-center gap-2">
        {running && <span className="live-dot" aria-hidden />}
        <h2 id="feed-h" className="text-xs font-semibold uppercase tracking-[.12em] text-ink-3">
          {running === "redteam" ? "Attack simulation — live" : running ? "Agent working — live" : "Last run"}
        </h2>
      </div>
      <ol className="mt-4 relative">
        <span className="absolute left-[11px] top-2 bottom-2 w-px bg-line" aria-hidden />
        {feed.map((f, i) => (
          <li key={i} className="rise relative pl-9 pb-4 last:pb-0">
            <span className={`absolute left-0 top-0 grid place-items-center size-6 rounded-full text-[11px] ${ICON[f.kind].cls}`} aria-hidden>{ICON[f.kind].glyph}</span>
            <span className="sr-only">{ICON[f.kind].who}: </span>
            {f.kind === "thought" && <p className="text-sm text-ink-2 leading-relaxed">{f.text}</p>}
            {f.kind === "tool" && (
              <p className="text-xs text-ink-3">
                <span className="num rounded bg-[#ece7de] px-1.5 py-0.5 text-ink-2">{f.name}</span>
                <span className="ml-2">{f.summary}</span>
              </p>
            )}
            {f.kind === "shield" && (
              <p className="text-sm">
                <span className="font-semibold text-wait">Listing shield</span>{" "}
                <span className="text-ink-2">removed hidden instructions aimed at AI agents from “{f.productName}” ({f.reasons.join(", ")}).</span>
              </p>
            )}
            {f.kind === "policy" && <Verdict decision={f.decision} rationale={f.rationale} />}
            {f.kind === "error" && <p className="text-sm text-block">{f.message}</p>}
          </li>
        ))}
        {running && <li className="text-xs text-ink-3 pl-9"><Spinner label="Thinking…" /></li>}
      </ol>
      <div ref={end} />
    </section>
  );
}

function Verdict({ decision, rationale }: { decision: PolicyDecision; rationale: string }) {
  if (!decision.allowed)
    return (
      <div className="rounded-xl border border-[#e3b9b0] bg-block-bg p-4">
        <p className="font-semibold text-block flex items-center gap-2">
          <span aria-hidden>⛔</span> Firewall blocked this cart · {usd(decision.total)} proposed
        </p>
        {rationale && <p className="text-xs text-ink-2 mt-1 italic">Agent said: “{rationale}”</p>}
        <ul className="mt-2 space-y-1">
          {decision.violations.map((v, i) => (
            <li key={i} className="text-sm flex gap-2">
              <span className="num text-[11px] rounded bg-white/70 px-1.5 py-0.5 text-block shrink-0">{VIOLATION_LABEL[v.code] ?? v.code}</span>
              <span className="text-ink-2">{v.message}</span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-ink-3 mt-2">Nothing was charged. The agent was told why and must correct the cart.</p>
      </div>
    );
  return (
    <div className="rounded-xl border border-[#bcd6c9] bg-allow-bg p-4">
      <p className="font-semibold text-allow flex items-center gap-2">
        <span aria-hidden>✓</span> Firewall approved · {usd(decision.total)}
        {decision.requiresHumanApproval && <span className="text-wait text-xs font-semibold">· needs your OK</span>}
      </p>
      <Lines lines={decision.lines} total={decision.total} />
      {rationale && <p className="text-xs text-ink-2 mt-2 italic">“{rationale}”</p>}
    </div>
  );
}

function Receipt({ mandate, onRefund, busy }: { mandate: Mandate; onRefund: (amount: number, reason: string) => void; busy: boolean }) {
  const o = mandate.order!;
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const refundable = o.total - o.refunded;
  return (
    <section className="panel p-5 sm:p-6" aria-labelledby="receipt-h">
      <div className="flex items-baseline justify-between">
        <h2 id="receipt-h" className="text-xs font-semibold uppercase tracking-[.12em] text-ink-3">Receipt</h2>
        <span className="text-xs text-ink-3">{new Date(o.settledAt).toLocaleString()}</span>
      </div>
      <Lines lines={o.lines} total={o.total} />
      {o.rationale && <p className="text-sm text-ink-2 mt-3 italic">Why the agent chose this: “{o.rationale}”</p>}
      {o.refunded > 0 && <p className="text-sm mt-3">Refunded so far: <span className="num font-semibold">{usd(o.refunded)}</span></p>}
      {refundable > 0 && (
        <form
          className="mt-4 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            onRefund(Math.round(Number(amount) * 100), reason || "Owner-approved refund");
          }}
        >
          <label className="text-xs text-ink-3">
            Refund (max {usd(refundable)})
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="12.50" className="num mt-1 block w-28 rounded-lg border border-line-2 bg-paper/60 px-2.5 py-1.5 text-sm text-ink outline-none focus:border-ink" />
          </label>
          <label className="text-xs text-ink-3 flex-1 min-w-40">
            Reason
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="One case arrived damaged" className="mt-1 block w-full rounded-lg border border-line-2 bg-paper/60 px-2.5 py-1.5 text-sm text-ink outline-none focus:border-ink" />
          </label>
          <button className="btn btn-ghost" disabled={busy || !(Number(amount) > 0)}>{busy ? <Spinner label="Refunding…" /> : "Refund via PayPal Braintree"}</button>
        </form>
      )}
    </section>
  );
}
