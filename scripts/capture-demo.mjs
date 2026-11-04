/**
 * Drives the REAL running app end to end with Playwright and saves genuine screenshots
 * plus a screen recording. Nothing is mocked: Gemini and the Braintree sandbox are live.
 *
 * Usage:  BASE_URL=http://localhost:3100 node scripts/capture-demo.mjs
 * Output: docs/screenshots/*.png and .capture/video/*.webm, plus .capture/timeline.json (scene timestamps)
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync, renameSync, readdirSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const SHOTS = "docs/screenshots";
const OUT = ".capture";
mkdirSync(SHOTS, { recursive: true });
mkdirSync(`${OUT}/video`, { recursive: true });

const REQUEST = "Restock oat milk, cups and lids for next week. Under $180. Only our usual suppliers. Needs to arrive within 3 days.";
const t0 = Date.now();
const timeline = [];
const mark = (scene) => {
  const t = (Date.now() - t0) / 1000;
  timeline.push({ scene, t });
  console.log(`[${t.toFixed(1)}s] ${scene}`);
};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1600, height: 900 },
  deviceScaleFactor: 1,
  recordVideo: { dir: `${OUT}/video`, size: { width: 1600, height: 900 } },
});
const page = await context.newPage();
page.setDefaultTimeout(240_000);

async function shot(name, locator) {
  const path = `${SHOTS}/${name}.png`;
  if (locator) {
    // Element shots: un-stick the header so it cannot overlap the captured element.
    const style = await page.addStyleTag({ content: "header{position:static!important}" });
    await locator.screenshot({ path });
    await style.evaluate((el) => el.remove());
  } else await page.screenshot({ path });
  console.log(`   saved ${path}`);
}

// Hi-DPI stills come from a second page so the recording stays smooth. It must share the
// owner cookie (mandates are owner-bound), so it is created after the first page load.
let still;

try {
  // 1. Home
  mark("home");
  await page.goto(BASE, { waitUntil: "networkidle" });
  still = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, storageState: await context.storageState() })).newPage();
  await pause(2500);
  await still.goto(BASE, { waitUntil: "networkidle" });
  await still.screenshot({ path: `${SHOTS}/01-home.png` });

  // 2. Describe → compile mandate (live Gemini)
  mark("describe");
  await page.getByLabel("What should your agent buy?").click();
  await page.keyboard.type(REQUEST, { delay: 18 });
  await pause(600);
  await page.getByRole("button", { name: /Draft mandate/ }).click();
  mark("compiling");
  await page.waitForURL(/\/m\/md_/, { timeout: 240_000 });
  await page.getByText("Your agent CAN", { exact: true }).waitFor();
  mark("mandate");
  await pause(3500);
  const mandateUrl = page.url();
  await still.goto(mandateUrl, { waitUntil: "networkidle" });
  await still.getByText("Your agent CAN", { exact: true }).waitFor();
  await still.screenshot({ path: `${SHOTS}/02-mandate.png` });

  // 3. Fund: Braintree Drop-in with Braintree's published sandbox test card
  mark("fund");
  const number = page.frameLocator('iframe[id^="braintree-hosted-field-number"]').locator("input#credit-card-number");
  await number.waitFor();
  await number.scrollIntoViewIfNeeded();
  await pause(800);
  await number.pressSequentially("4111111111111111", { delay: 35 });
  await page.frameLocator('iframe[id^="braintree-hosted-field-expirationDate"]').locator("input:not(.autofill-field)").pressSequentially("1230", { delay: 60 });
  await pause(700);
  await page.getByRole("button", { name: /Authorize .* hold/ }).click();
  await page.getByText("PayPal Braintree authorization hold").waitFor();
  mark("funded");
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  await pause(3000);
  await still.goto(mandateUrl, { waitUntil: "networkidle" });
  await still.getByText("PayPal Braintree authorization hold").waitFor();
  await still.screenshot({ path: `${SHOTS}/03-funded.png` });

  // 4. Red-team: simulated compromised agent vs the firewall
  mark("redteam");
  await page.getByRole("button", { name: "Run attack simulation" }).click();
  await page.getByText("Attack simulation — live").waitFor().catch(() => {});
  await page.getByRole("button", { name: "Run attack simulation" }).waitFor({ state: "visible" });
  await page.waitForFunction(() => (document.body.innerText.match(/Firewall blocked this cart/gi) ?? []).length >= 3 && !/Attacking/.test(document.body.innerText), null, { timeout: 60_000 });
  mark("redteam-done");
  const feed = page.locator('section[aria-labelledby="feed-h"]');
  await feed.scrollIntoViewIfNeeded();
  await pause(1500);
  await page.mouse.wheel(0, 500);
  await pause(2500);
  await page.mouse.wheel(0, 600);
  await pause(2500);
  await shot("04-firewall-blocked", feed);

  // 5. Real Gemini agent (listing shield active)
  mark("agent");
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  await pause(800);
  await page.getByRole("button", { name: /Let the agent shop/ }).click();
  await page.waitForFunction(() => /Your approval needed|Paid · verified|Agent finished without/i.test(document.body.innerText) && !/Agent is shopping/i.test(document.body.innerText), null, { timeout: 300_000 });
  mark("agent-done");
  await feed.scrollIntoViewIfNeeded();
  await pause(2500);
  await page.mouse.wheel(0, 500);
  await pause(2500);
  await shot("05-agent-approved", feed);

  // 6. Step-up approval → settlement verified with Braintree
  if (await page.getByText(/Your approval needed/i).isVisible().catch(() => false)) {
    mark("approval");
    const panel = page.locator("aside");
    await page.getByRole("button", { name: /Approve & pay/ }).scrollIntoViewIfNeeded();
    await pause(1500);
    await shot("06-approval", panel);
    await page.getByRole("button", { name: /Approve & pay/ }).click();
  }
  await page.getByText(/Paid · verified with PayPal Braintree/i).waitFor();
  mark("paid");
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  await pause(3500);
  await still.goto(mandateUrl, { waitUntil: "networkidle" });
  await still.getByText(/Paid · verified with PayPal Braintree/i).waitFor();
  await still.screenshot({ path: `${SHOTS}/07-paid.png` });

  // 7. Audit ledger (AG Grid) with chain verification
  mark("ledger");
  await page.getByRole("link", { name: "Audit ledger" }).click();
  await page.getByText(/Verified ·/).waitFor();
  await pause(1500);
  await page.getByPlaceholder(/Filter/).click();
  await page.keyboard.type("blocked", { delay: 60 });
  await pause(2500);
  await page.getByPlaceholder(/Filter/).fill("");
  await pause(2000);
  mark("end");
  await still.goto(`${BASE}/ledger`, { waitUntil: "networkidle" });
  await still.getByText(/Verified ·/).waitFor();
  await pause(800);
  await still.screenshot({ path: `${SHOTS}/08-ledger.png` });

  // 8. Mobile home
  const mobile = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true })).newPage();
  await mobile.goto(BASE, { waitUntil: "networkidle" });
  await mobile.screenshot({ path: `${SHOTS}/09-mobile.png` });
} catch (e) {
  console.error("CAPTURE FAILED:", e.message);
  await page.screenshot({ path: `${OUT}/failure.png` }).catch(() => {});
  process.exitCode = 1;
} finally {
  writeFileSync(`${OUT}/timeline.json`, JSON.stringify(timeline, null, 2));
  await context.close();
  await browser.close();
  const vids = readdirSync(`${OUT}/video`).filter((f) => f.endsWith(".webm"));
  if (vids.length) {
    const latest = vids.sort().at(-1);
    renameSync(`${OUT}/video/${latest}`, `${OUT}/video/demo-raw.webm`);
    console.log(`video: ${OUT}/video/demo-raw.webm`);
  }
}
