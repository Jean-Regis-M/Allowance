/** Renders the video cards and the YouTube thumbnail from cards.html. */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const url = pathToFileURL(resolve("scripts/video/cards.html")).href;
mkdirSync(".capture/cards", { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
for (const id of ["hook", "problem", "solution", "architecture", "close"]) {
  await page.goto(`${url}?card=${id}`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `.capture/cards/${id}.png` });
  console.log("card", id);
}
// Thumbnail: render at 1920x1080 then downscale to 1280x720 (YouTube recommended size).
const thumb = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 / 3 });
await thumb.goto(`${url}?card=thumb`, { waitUntil: "networkidle" });
await thumb.evaluate(() => document.fonts.ready);
await thumb.screenshot({ path: ".capture/cards/thumbnail.png" });
console.log("thumbnail");
await browser.close();
