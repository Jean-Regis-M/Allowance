"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Mandate } from "@/lib/domain";
import { ErrorNote, Spinner, StatusPill, usd } from "@/components/ui";
import { SpendMeter } from "@/components/SpendMeter";

const EXAMPLES = [
  "Restock oat milk, cups and lids for next week. Under $180. Only our usual suppliers. Needs to arrive within 3 days.",
  "Reorder house espresso beans and a decaf bag, keep it under $130, needs to arrive within 3 days.",
  "Buy food-safe sanitiser for the kitchen, max $60, any verified supplier.",
];

export default function Home() {
  const router = useRouter();
  const [request, setRequest] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mandates, setMandates] = useState<Mandate[] | null>(null);

  useEffect(() => {
    fetch("/api/mandates")
      .then((r) => r.json())
      .then((j) => setMandates(j.mandates ?? []))
      .catch(() => setMandates([]));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (request.trim().length < 8 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/mandates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ request }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Could not create mandate");
      router.push(`/m/${j.mandate.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="space-y-12">
      <section className="grid lg:grid-cols-[1.15fr_.85fr] gap-10 items-start pt-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.14em] text-ink-3">For small businesses delegating purchasing to AI</p>
          <h1 className="display text-5xl sm:text-6xl leading-[1.02] mt-3">
            Give your AI agent an <em className="text-allow">allowance</em>,<br className="hidden sm:block" /> not your wallet.
          </h1>
          <p className="mt-5 text-ink-2 max-w-xl leading-relaxed">
            Describe the job in plain English. Allowance turns it into hard spending rules, places a PayPal Braintree hold for the budget,
            and lets the agent shop. Every cart passes a policy firewall the AI cannot talk its way past, and you pay only the exact approved total.
          </p>

          <form onSubmit={submit} className="panel mt-7 p-4 sm:p-5 shadow-[0_1px_0_#e4ded3,0_12px_30px_-18px_rgba(28,27,24,.25)]">
            <label htmlFor="req" className="text-sm font-semibold">What should your agent buy?</label>
            <textarea
              id="req"
              value={request}
              onChange={(e) => setRequest(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="e.g. Restock oat milk, cups and lids for next week. Under $180…"
              className="mt-2 w-full resize-none rounded-lg border border-line-2 bg-paper/60 px-3 py-2.5 text-[15px] leading-relaxed outline-none focus:border-ink"
            />
            <div className="mt-3 flex flex-wrap gap-2">
              {EXAMPLES.map((ex) => (
                <button type="button" key={ex} onClick={() => setRequest(ex)} className="rounded-full border border-line px-3 py-1 text-xs text-ink-2 hover:border-ink-3 hover:text-ink text-left">
                  {ex.length > 58 ? `${ex.slice(0, 58)}…` : ex}
                </button>
              ))}
            </div>
            <div className="mt-4 flex items-center justify-between gap-3">
              <span className="text-xs text-ink-3">Gemini drafts the rules. You review them before any money is held.</span>
              <button className="btn btn-primary" disabled={busy || request.trim().length < 8}>
                {busy ? <Spinner label="Drafting rules…" /> : "Draft mandate →"}
              </button>
            </div>
          </form>
          {error && <div className="mt-3"><ErrorNote message={error} onDismiss={() => setError(null)} /></div>}
        </div>

        <ol className="space-y-3 lg:mt-10" aria-label="How it works">
          {[
            ["1", "Describe", "Plain English becomes a mandate: budget, suppliers, categories, deadline, quantity caps."],
            ["2", "Fund", "Approve once. PayPal Braintree authorizes a hold for the budget. Nothing is charged yet."],
            ["3", "Delegate", "The agent shops. A deterministic firewall checks every cart against the mandate and the hold."],
            ["4", "Settle", "Only the exact approved total is settled. The rest of the hold is released. Everything is hash-chained in the ledger."],
          ].map(([n, t, d]) => (
            <li key={n} className="panel p-4 flex gap-4">
              <span className="num text-ink-3 text-sm pt-0.5">{n}</span>
              <div>
                <p className="font-semibold">{t}</p>
                <p className="text-sm text-ink-2 mt-0.5 leading-relaxed">{d}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="mandates-h">
        <div className="flex items-end justify-between">
          <h2 id="mandates-h" className="display text-3xl">Your mandates</h2>
          <Link href="/ledger" className="text-sm text-ink-2 hover:text-ink">View audit ledger →</Link>
        </div>
        <div className="mt-4">
          {mandates === null ? (
            <div className="panel p-6 text-ink-3 text-sm"><Spinner label="Loading mandates…" /></div>
          ) : mandates.length === 0 ? (
            <div className="panel p-8 text-center">
              <p className="font-semibold">No mandates yet</p>
              <p className="text-sm text-ink-2 mt-1">Describe a purchasing task above. Your agent will not spend a cent until you fund it.</p>
            </div>
          ) : (
            <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {mandates.map((m) => (
                <li key={m.id}>
                  <Link href={`/m/${m.id}`} className="panel p-4 block hover:border-ink-3 transition-colors h-full">
                    <div className="flex items-center justify-between gap-2">
                      <StatusPill status={m.status} />
                      <span className="num text-xs text-ink-3">{new Date(m.createdAt).toLocaleDateString()}</span>
                    </div>
                    <p className="font-semibold mt-3 leading-snug">{m.title}</p>
                    <p className="text-sm text-ink-2 mt-1 line-clamp-2">{m.purpose}</p>
                    <div className="mt-4"><SpendMeter mandate={m} compact /></div>
                    <div className="mt-2 flex items-baseline justify-between text-sm">
                      <span className="text-ink-3">Budget <span className="num text-ink">{usd(m.rules.budget)}</span></span>
                      {m.order && <span className="text-ink-3">Paid <span className="num text-allow font-semibold">{usd(m.order.total)}</span></span>}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
