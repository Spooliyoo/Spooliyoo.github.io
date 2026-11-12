// Renders PNG app icons from the SVGs in public/icons (run after changing them): node scripts/render-icons.mjs
//   icon.svg          – the full app icon (dark rounded tile)
//   mark-on-dark.svg  – the spool mark alone, used for full-bleed icons (maskable / Apple / GitHub avatar)
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const icon = readFileSync("public/icons/icon.svg", "utf8");
const mark = readFileSync("public/icons/mark-on-dark.svg", "utf8");
const BG = "#0E1116";
const fit = (svg) => svg.replace(/<svg ([^>]*?)width="\d+" height="\d+"/, '<svg $1width="100%" height="100%"');

const browser = await chromium.launch();
const page = await browser.newPage();
// [file, size, kind]: "rounded" = icon.svg on transparent; "bleed" = mark on a full dark square.
const shots = [
  ["public/icons/icon-192.png", 192, "rounded"],
  ["public/icons/icon-512.png", 512, "rounded"],
  ["public/icons/maskable-512.png", 512, "bleed"],
  ["public/icons/apple-touch-icon.png", 180, "bleed"],
  [process.argv[2] ?? "spooliyoo-avatar.png", 512, "bleed"],
];
for (const [file, size, kind] of shots) {
  await page.setViewportSize({ width: size, height: size });
  // Maskable icons must keep the artwork inside the central 80%; 62% leaves comfortable room.
  const inner = kind === "bleed" ? Math.round(size * 0.62) : size;
  await page.setContent(
    `<html><body style="margin:0;background:${kind === "bleed" ? BG : "transparent"}">` +
      `<div style="width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center">` +
      `<div style="width:${inner}px;height:${inner}px">${fit(kind === "bleed" ? mark : icon)}</div></div></body></html>`,
  );
  await page.screenshot({ path: file, omitBackground: kind !== "bleed" });
}
await browser.close();
console.log("Icons rendered");
