// Render a self-contained HTML document to PDF via Playwright's bundled Chromium.
//
//   node scripts/render-pdf.mjs docs/instawards-phase-1-onepager.html
//
// Output path defaults to the input with a .pdf extension. Page size comes from
// the document's own @page rule, so the HTML stays the single source of truth.
//
// Also reports how the content measures against one A4 page, which is what you
// want when the document is meant to *be* a one-pager: tuning type and padding
// against a number beats re-rendering and eyeballing the page count.

import { chromium } from "@playwright/test";
import { pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";

const input = process.argv[2];
if (!input) {
  console.error("usage: node scripts/render-pdf.mjs <input.html> [output.pdf]");
  process.exit(1);
}

const src = path.resolve(input);
const out = path.resolve(process.argv[3] ?? src.replace(/\.html?$/i, ".pdf"));

// A4 minus the @page margins declared in the document.
const MM = 96 / 25.4;
const css = fs.readFileSync(src, "utf8");
const margin = css.match(/@page\s*{[^}]*margin:\s*([\d.]+)mm\s+([\d.]+)mm/);
const [mv, mh] = margin ? [Number(margin[1]), Number(margin[2])] : [10, 10];
const availH = 297 - mv * 2;
const availW = 210 - mh * 2;

const browser = await chromium.launch();
try {
  // Correct width, deliberately over-tall: body height is then content-driven
  // rather than clamped to the viewport, so the headroom number is real.
  const page = await browser.newPage({
    viewport: { width: Math.round(availW * MM), height: Math.round(availH * MM * 2) },
  });
  await page.goto(pathToFileURL(src).href, { waitUntil: "networkidle" });

  const contentH = (await page.evaluate(() => document.body.getBoundingClientRect().height)) / MM;
  const delta = contentH - availH;
  const fit =
    delta > 0
      ? `OVERFLOWS by ${delta.toFixed(1)}mm (${((contentH / availH - 1) * 100).toFixed(1)}% too tall)`
      : `fits with ${(-delta).toFixed(1)}mm to spare`;
  console.log(`content ${contentH.toFixed(1)}mm / ${availH}mm available — ${fit}`);

  await page.pdf({ path: out, printBackground: true, preferCSSPageSize: true });
  console.log(`${path.relative(process.cwd(), src)} → ${path.relative(process.cwd(), out)}`);
} finally {
  await browser.close();
}
