// Renders PNG app icons from public/icons/icon.svg (run once after changing the SVG): node scripts/render-icons.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const svg = readFileSync("public/icons/icon.svg", "utf8");
const browser = await chromium.launch();
const page = await browser.newPage();
const shots = [
  ["icon-192.png", 192, false],
  ["icon-512.png", 512, false],
  ["maskable-512.png", 512, true],
  ["apple-touch-icon.png", 180, true],
];
for (const [name, size, full] of shots) {
  await page.setViewportSize({ width: size, height: size });
  // Maskable icons need a full-bleed background and the artwork inside the 80% safe zone.
  const inner = full ? svg.replace(/rx="112"/, 'rx="0"') : svg;
  await page.setContent(
    `<html><body style="margin:0;background:${full ? "#1f57e0" : "transparent"}">` +
      `<div style="width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center">` +
      `<div style="width:${full ? size * 0.8 : size}px;height:${full ? size * 0.8 : size}px">${inner.replace("<svg ", '<svg width="100%" height="100%" ')}</div></div></body></html>`,
  );
  await page.screenshot({ path: `public/icons/${name}`, omitBackground: !full });
}
await browser.close();
console.log("Icons rendered");
