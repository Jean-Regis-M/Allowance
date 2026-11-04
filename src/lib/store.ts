/**
 * Persistence: SQLite via Node's built-in node:sqlite (no native build step).
 * Mandates are stored as JSON documents; the audit ledger is a single global
 * append-only hash chain across all mandates.
 */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Mandate, MandateStatus } from "./domain";
import { GENESIS, hashEntry, verifyChain, type LedgerActor, type LedgerEntry } from "./ledger";

let db: DatabaseSync | null = null;

export function database(): DatabaseSync {
  if (db) return db;
  const path = process.env.DB_PATH ?? ".data/allowance.db";
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS mandates (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      doc TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ledger (
      seq INTEGER PRIMARY KEY,
      mandate_id TEXT NOT NULL,
      at TEXT NOT NULL,
      actor TEXT NOT NULL,
      type TEXT NOT NULL,
      summary TEXT NOT NULL,
      data TEXT NOT NULL,
      prev_hash TEXT NOT NULL,
      hash TEXT NOT NULL UNIQUE
    );
    CREATE INDEX IF NOT EXISTS ledger_mandate ON ledger(mandate_id);
  `);
  return db;
}

/** Test helper: point at a fresh database. */
export function resetDatabaseForTests(path = ":memory:") {
  db?.close();
  db = null;
  process.env.DB_PATH = path;
}

export function saveMandate(m: Mandate) {
  const now = new Date().toISOString();
  database()
    .prepare(
      `INSERT INTO mandates (id, status, doc, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET status = excluded.status, doc = excluded.doc, updated_at = excluded.updated_at`,
    )
    .run(m.id, m.status, JSON.stringify(m), m.createdAt, now);
}

export function getMandate(id: string): Mandate | null {
  const row = database().prepare("SELECT doc FROM mandates WHERE id = ?").get(id) as { doc: string } | undefined;
  return row ? (JSON.parse(row.doc) as Mandate) : null;
}

export function listMandates(ownerId?: string): Mandate[] {
  const all = (database().prepare("SELECT doc FROM mandates ORDER BY created_at DESC").all() as Array<{ doc: string }>).map((r) => JSON.parse(r.doc) as Mandate);
  return ownerId === undefined ? all : all.filter((m) => m.ownerId === ownerId);
}

/** Atomic compare-and-set on status, so two concurrent requests can't both settle. */
export function transition(id: string, from: MandateStatus[], to: MandateStatus): Mandate {
  const d = database();
  d.exec("BEGIN IMMEDIATE");
  try {
    const m = getMandate(id);
    if (!m) throw new Error(`Mandate ${id} not found`);
    if (!from.includes(m.status)) throw new Error(`Mandate is ${m.status}; expected ${from.join(" or ")}`);
    m.status = to;
    saveMandate(m);
    d.exec("COMMIT");
    return m;
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
}

interface LedgerRow {
  seq: number;
  mandate_id: string;
  at: string;
  actor: LedgerActor;
  type: string;
  summary: string;
  data: string;
  prev_hash: string;
  hash: string;
}

const toEntry = (r: LedgerRow): LedgerEntry => ({
  seq: r.seq,
  mandateId: r.mandate_id,
  at: r.at,
  actor: r.actor,
  type: r.type,
  summary: r.summary,
  data: JSON.parse(r.data),
  prevHash: r.prev_hash,
  hash: r.hash,
});

export function appendLedger(mandateId: string, actor: LedgerActor, type: string, summary: string, data: unknown = {}): LedgerEntry {
  const d = database();
  d.exec("BEGIN IMMEDIATE");
  try {
    const last = d.prepare("SELECT seq, hash FROM ledger ORDER BY seq DESC LIMIT 1").get() as { seq: number; hash: string } | undefined;
    const base = { seq: (last?.seq ?? 0) + 1, mandateId, at: new Date().toISOString(), actor, type, summary, data: JSON.parse(JSON.stringify(data ?? {})), prevHash: last?.hash ?? GENESIS };
    const entry: LedgerEntry = { ...base, hash: hashEntry(base) };
    d.prepare("INSERT INTO ledger (seq, mandate_id, at, actor, type, summary, data, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      entry.seq, entry.mandateId, entry.at, entry.actor, entry.type, entry.summary, JSON.stringify(entry.data), entry.prevHash, entry.hash,
    );
    d.exec("COMMIT");
    return entry;
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
}

export function getLedger(mandateId?: string): LedgerEntry[] {
  const rows = mandateId
    ? (database().prepare("SELECT * FROM ledger WHERE mandate_id = ? ORDER BY seq").all(mandateId) as unknown as LedgerRow[])
    : (database().prepare("SELECT * FROM ledger ORDER BY seq").all() as unknown as LedgerRow[]);
  return rows.map(toEntry);
}

/** Ledger entries for one owner's mandates (the chain itself is verified globally). */
export function getLedgerForOwner(ownerId: string): LedgerEntry[] {
  const ids = new Set(listMandates(ownerId).map((m) => m.id));
  return getLedger().filter((e) => ids.has(e.mandateId));
}

export function verifyLedger() {
  const all = getLedger();
  return { ...verifyChain(all), entries: all.length };
}
