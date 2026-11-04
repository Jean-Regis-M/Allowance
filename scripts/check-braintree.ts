try { process.loadEnvFile(".env.local"); } catch {}
const keys = ["BRAINTREE_MERCHANT_ID","BRAINTREE_PUBLIC_KEY","BRAINTREE_PRIVATE_KEY","GEMINI_API_KEY","GEMINI_MODEL"];
for (const k of keys) console.log(k.padEnd(22), process.env[k] ? `set (${process.env[k]!.length} chars)` : "MISSING");
const t = setTimeout(() => { console.log("Braintree: TIMEOUT after 30s"); process.exit(2); }, 30000);
import("../src/lib/braintree").then(async (bt) => {
  try { const tok = await bt.clientToken(); console.log("PayPal Braintree (sandbox): OK, client token", tok.length, "chars"); }
  catch (e) { console.log("PayPal Braintree (sandbox): FAILED ->", (e as Error).name, (e as Error).message.slice(0, 200)); }
  clearTimeout(t); process.exit(0);
});
export {};
