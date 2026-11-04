/**
 * Live end-to-end run: real Gemini + real PayPal Braintree sandbox, separate database.
 * Usage: npx tsx scripts/e2e-live.ts
 */
import { writeFileSync, mkdirSync } from "node:fs";

try {
  process.loadEnvFile(".env.local");
} catch {
  /* env from process */
}
process.env.DB_PATH = ".data/e2e-live.db";

const REQUEST = "Restock oat milk, cups and lids for next week. Under $180. Only our usual suppliers. Needs to arrive within 3 days.";

async function main() {
  const svc = await import("../src/lib/service");
  const store = await import("../src/lib/store");
  const { activeModel } = await import("../src/lib/ai/llm");
  const t0 = Date.now();
  const ms = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

  const { mandate, questions } = await svc.draftMandate(REQUEST, { ownerId: "e2e" });
  console.log(`[${ms()}] compiled by ${activeModel()}:`, JSON.stringify({ title: mandate.title, rules: mandate.rules, preferences: mandate.preferences, questions }));

  const funded = await svc.fundMandate(mandate.id, "fake-valid-visa-nonce");
  console.log(`[${ms()}] funded: hold ${funded.holdId} ${funded.authorizedAmount} cents, status ${funded.status}`);

  const done = await svc.runMandate(mandate.id, (e) => {
    if (e.kind === "thought") console.log(`[${ms()}] 💭 ${e.text.slice(0, 200)}`);
    if (e.kind === "tool") console.log(`[${ms()}] 🔧 ${e.name}: ${e.summary} ${JSON.stringify(e.input).slice(0, 160)}`);
    if (e.kind === "policy") console.log(`[${ms()}] ${e.decision.allowed ? "✅ APPROVED" : "⛔ BLOCKED"} total=${e.decision.total} ${e.decision.violations.map((v) => v.code).join(",")}`);
    if (e.kind === "error") console.log(`[${ms()}] ⚠ ${e.message}`);
  });
  console.log(`[${ms()}] final status: ${done.status}`, done.order ? `paid ${done.order.total} txn ${done.order.transactionId} (${done.order.gatewayStatus})` : "", done.pendingCart ? `pending ${done.pendingCart.total}` : "");

  if (done.status === "NEEDS_APPROVAL") {
    const ap = await svc.approvePending(mandate.id);
    console.log(`[${ms()}] approved → ${ap.status} paid ${ap.order?.total} (${ap.order?.gatewayStatus})`);
  }

  const v = store.verifyLedger();
  console.log(`[${ms()}] ledger: ${store.getLedger(mandate.id).length} entries, chain ok=${v.ok}`);
  mkdirSync("../../REAL_PRODUCT_EVIDENCE", { recursive: true });
  writeFileSync(
    `../../REAL_PRODUCT_EVIDENCE/e2e-live-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
    JSON.stringify({ model: activeModel(), mandate: store.getMandate(mandate.id), ledger: store.getLedger(mandate.id) }, null, 2),
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("✘ FAILED:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
export {};
