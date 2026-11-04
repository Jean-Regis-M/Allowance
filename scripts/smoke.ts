/**
 * Connectivity smoke test. Prints only whether each variable is set, never values.
 * Usage: npx tsx scripts/smoke.ts
 */
try {
  process.loadEnvFile(".env.local");
} catch {
  console.log("No .env.local found; using process environment.");
}

const KEYS = ["BRAINTREE_MERCHANT_ID", "BRAINTREE_PUBLIC_KEY", "BRAINTREE_PRIVATE_KEY", "GEMINI_API_KEY", "GEMINI_MODEL", "APP_URL"];
for (const k of KEYS) console.log(`${k.padEnd(22)} ${process.env[k] ? "set" : "MISSING"}`);

async function main() {
  const bt = await import("../src/lib/braintree");
  try {
    await bt.clientToken();
    console.log("PayPal Braintree (sandbox): OK");
  } catch (e) {
    console.log("PayPal Braintree (sandbox): FAILED", (e as Error).message.slice(0, 200));
  }

  const { genai, MODEL } = await import("../src/lib/ai/llm");
  try {
    const pager = await genai().models.list();
    const names: string[] = [];
    for await (const m of pager) if (m.name?.includes("gemini") && m.supportedActions?.includes("generateContent")) names.push(m.name.replace("models/", ""));
    console.log(`Gemini models available to this key (${names.length}):`, names.filter((n) => /flash|pro/.test(n)).slice(0, 15).join(", "));
    const r = await genai().models.generateContent({ model: MODEL, contents: "Reply with the single word: ready" });
    console.log(`Gemini (${MODEL}): OK ->`, r.text?.trim());
  } catch (e) {
    console.log("Gemini: FAILED", (e as Error).message.slice(0, 300));
  }
}
main();
