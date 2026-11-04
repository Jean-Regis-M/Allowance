/** Append-only audit ledger with a SHA-256 hash chain (tamper evidence). */
import { createHash } from "node:crypto";

export type LedgerActor = "owner" | "agent" | "policy" | "paypal" | "system";

export interface LedgerEntry {
  seq: number;
  mandateId: string;
  at: string;
  actor: LedgerActor;
  type: string;
  summary: string;
  data: unknown;
  prevHash: string;
  hash: string;
}

export const GENESIS = "0".repeat(64);

/** Canonical JSON: sorted keys, so the hash is reproducible. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .filter((k) => obj[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`)
    .join(",")}}`;
}

export function hashEntry(e: Omit<LedgerEntry, "hash">): string {
  return createHash("sha256")
    .update(canonical({ seq: e.seq, mandateId: e.mandateId, at: e.at, actor: e.actor, type: e.type, summary: e.summary, data: e.data, prevHash: e.prevHash }))
    .digest("hex");
}

export function verifyChain(entries: LedgerEntry[]): { ok: boolean; brokenAt?: number } {
  let prev = GENESIS;
  for (const e of entries) {
    if (e.prevHash !== prev || hashEntry(e) !== e.hash) return { ok: false, brokenAt: e.seq };
    prev = e.hash;
  }
  return { ok: true };
}
