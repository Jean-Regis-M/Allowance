"use client";

import { useEffect, useState } from "react";
import type { LedgerEntry } from "@/lib/ledger";
import { LedgerGrid } from "@/components/LedgerGrid";
import { Spinner } from "@/components/ui";

interface Verification {
  ok: boolean;
  brokenAt?: number;
  entries: number;
}

export default function LedgerPage() {
  const [entries, setEntries] = useState<LedgerEntry[] | null>(null);
  const [v, setV] = useState<Verification | null>(null);
  const [checking, setChecking] = useState(false);

  async function load() {
    setChecking(true);
    const j = await fetch("/api/ledger").then((r) => r.json());
    setEntries(j.entries);
    setV(j.verification);
    setChecking(false);
  }
  useEffect(() => {
    load();
  }, []);

  const blocked = entries?.filter((e) => e.type === "policy.blocked").length ?? 0;
  const paid = entries?.filter((e) => e.type === "payment.verified").length ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="display text-4xl">Audit ledger</h1>
        <p className="text-ink-2 mt-1 max-w-2xl">
          Every request, AI decision, firewall verdict and PayPal Braintree event, in one append-only log. Each entry includes the SHA-256 hash of the one
          before it, so editing any past entry breaks the chain.
        </p>
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        <div className={`panel p-4 ${v && !v.ok ? "border-[#e3b9b0] bg-block-bg" : ""}`}>
          <p className="text-xs text-ink-3">Chain integrity</p>
          {v ? (
            <p className={`font-semibold mt-1 ${v.ok ? "text-allow" : "text-block"}`}>
              {v.ok ? `✓ Verified · ${v.entries} entries` : `✕ Broken at entry #${v.brokenAt}`}
            </p>
          ) : (
            <Spinner />
          )}
          <button className="text-xs underline text-ink-2 mt-2" onClick={load} disabled={checking}>Re-verify now</button>
        </div>
        <div className="panel p-4">
          <p className="text-xs text-ink-3">Carts blocked by the firewall</p>
          <p className="display text-3xl num text-block">{blocked}</p>
        </div>
        <div className="panel p-4">
          <p className="text-xs text-ink-3">Payments verified with PayPal Braintree</p>
          <p className="display text-3xl num text-allow">{paid}</p>
        </div>
      </div>

      {entries ? <LedgerGrid entries={entries} height={560} showMandate /> : <Spinner label="Loading ledger…" />}
    </div>
  );
}
