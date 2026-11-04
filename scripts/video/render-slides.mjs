/** Renders the pitch deck (SUBMISSION_DELIVERABLES/presentation/slides.html) to PDF + a PNG preview. */
import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
const src = resolve("../../SUBMISSION_DELIVERABLES/presentation/slides.html");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto(pathToFileURL(src).href, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
await page.pdf({ path: resolve("../../SUBMISSION_DELIVERABLES/presentation/Allowance-pitch-deck.pdf"), width: "1920px", height: "1080px", printBackground: true });
await page.screenshot({ path: resolve("../../SUBMISSION_DELIVERABLES/presentation/preview-slide1.png") });
await browser.close();
console.log("deck rendered");
