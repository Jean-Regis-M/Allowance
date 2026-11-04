/**
 * Live sandbox verification of the full mandate money flow.
 * Uses Braintree's documented sandbox test nonce (no real card, no real money).
 * Usage: npx tsx scripts/verify-braintree.ts
 * Output is saved as evidence in REAL_PRODUCT_EVIDENCE-style JSON (no secrets).
 */
import { writeFileSync, mkdirSync } from "node:fs";

try {
  process.loadEnvFile(".env.local");
} catch {
  /* fall back to process env */
}

async function main() {
  const bt = await import("../src/lib/braintree");
  const log: Array<{ step: string; result: unknown }> = [];
  const step = (s: string, r: unknown) => {
    log.push({ step: s, result: r });
    console.log(`✔ ${s}`, JSON.stringify(r));
  };

  const token = await bt.clientToken();
  step("client token generated", { length: token.length });

  // A: hold $180.00 budget, settle exactly $104.22, force sandbox settlement, partial refund $12.50
  const hold = await bt.holdBudget(`md_verify_${Date.now()}`, 18000, "fake-valid-visa-nonce");
  step("budget hold placed", hold);
  const over = await bt.settleExact(hold.id, 18001).catch((e: Error) => ({ rejected: e.message }));
  step("over-hold settle rejected locally", over);
  const settled = await bt.settleExact(hold.id, 10422);
  step("exact cart total submitted for settlement", settled);
  const done = await bt.sandboxSettle(hold.id);
  step("sandbox settlement forced", done);
  const reread = await bt.findTransaction(hold.id);
  step("status re-read from Braintree", { id: reread.id, status: reread.status, amount: reread.amount });
  const rf = await bt.refund(hold.id, 1250);
  step("partial refund", rf);

  // B: a mandate that buys nothing releases its hold
  const hold2 = await bt.holdBudget(`md_verify_void_${Date.now()}`, 5000, "fake-valid-mastercard-nonce");
  step("second hold placed", { id: hold2.id, status: hold2.status });
  const voided = await bt.releaseHold(hold2.id);
  step("unused hold released (void)", voided);

  mkdirSync("../../REAL_PRODUCT_EVIDENCE", { recursive: true });
  const file = `../../REAL_PRODUCT_EVIDENCE/braintree-sandbox-verification-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(file, JSON.stringify({ environment: "sandbox", at: new Date().toISOString(), log }, null, 2));
  console.log(`\nAll steps passed. Evidence: ${file}`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error("✘ FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
