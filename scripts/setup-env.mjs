#!/usr/bin/env node
/**
 * Interactive setup: asks for your sandbox / API keys and writes .env.local.
 * Run it yourself:  npm run setup
 * Keys never leave your machine; .env.local is git-ignored.
 * Tip: copy keys with the copy icon in the Braintree / AI Studio dashboards instead of retyping them.
 */
import { createInterface } from "node:readline/promises";
import { chmodSync, existsSync, writeFileSync } from "node:fs";
import { stdin as input, stdout as output } from "node:process";

const rl = createInterface({ input, output });
rl.on("SIGINT", () => {
  console.log("\n\nCancelled. Nothing was saved. Run `npm run setup` again when ready.");
  process.exit(130);
});

const ask = async (label, def = "") => {
  const a = (await rl.question(`${label}${def ? ` [press Enter for ${def}]` : ""}: `)).trim();
  return a || def;
};

console.log("\nAllowance setup. Paste each value and press Enter.\n");
if (existsSync(".env.local")) {
  const ok = await ask("A .env.local already exists. Overwrite it? (y/N)", "N");
  if (!/^y/i.test(ok)) {
    console.log("Left .env.local unchanged.");
    rl.close();
    process.exit(0);
  }
}

const v = {
  BRAINTREE_ENVIRONMENT: "sandbox",
  BRAINTREE_MERCHANT_ID: await ask("1/4 Braintree Merchant ID"),
  BRAINTREE_PUBLIC_KEY: await ask("2/4 Braintree Public Key"),
  BRAINTREE_PRIVATE_KEY: await ask("3/4 Braintree Private Key"),
  GEMINI_API_KEY: await ask("4/4 Gemini API key"),
  GEMINI_MODEL: "gemini-flash-latest",
  APP_URL: "http://localhost:3000",
};
rl.close();

const missing = Object.entries(v).filter(([, val]) => !val).map(([k]) => k);
// Owner-only permissions (0600) on POSIX systems; tighten an existing file before overwriting it.
if (existsSync(".env.local")) chmodSync(".env.local", 0o600);
writeFileSync(
  ".env.local",
  `# LOCAL ONLY. Git-ignored. Written by scripts/setup-env.mjs on ${new Date().toISOString()}\n` +
    Object.entries(v).map(([k, val]) => `${k}=${val}`).join("\n") +
    "\n",
  { mode: 0o600 },
);
console.log(`\n✔ Saved .env.local${missing.length ? ` (still empty: ${missing.join(", ")})` : ""}.`);
console.log("You can close this tab and tell Claude the keys are saved.");
