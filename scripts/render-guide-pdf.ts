#!/usr/bin/env tsx
/**
 * Prints docs/pdf/*.html to a committed PDF with headless Chromium.
 *
 * The alpha testing guide is handed to testers as a designed PDF, not a markdown dump, so the
 * source of the *look* is the hand-authored HTML in docs/pdf/ — `docs/alpha-testing-guide.md`
 * carries the same content for reading in the repo and on GitBook. The two are kept in sync by
 * hand; edit both.
 *
 * This previously lived in a session scratchpad and was lost when the scratchpad was cleaned,
 * which is why the committed PDF drifted behind its source. It lives here now.
 *
 * Usage:
 *   pnpm docs:pdf                                # docs/pdf/alpha-testing-guide.html
 *   pnpm docs:pdf docs/pdf/alpha-testing-guide-lite.html   # group B's quick test
 */
import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const DEFAULT_PAGE = "docs/pdf/alpha-testing-guide.html";

async function render(): Promise<void> {
  const input = resolve(process.argv[2] ?? DEFAULT_PAGE);
  if (!input.endsWith(".html")) {
    throw new Error(`expected an .html file, got ${input}`);
  }
  if (!existsSync(input)) {
    throw new Error(`${input} does not exist`);
  }
  const output = resolve("docs", `${basename(input, ".html")}.pdf`);

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    // networkidle so the @font-face woff2 files are fetched before fonts.ready is awaited.
    await page.goto(pathToFileURL(input).href, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);

    // A silent fallback to a system font is the failure mode that looks fine locally and wrong
    // everywhere else, so surface what actually loaded.
    const fonts = await page.evaluate(() =>
      [...document.fonts].map((font) => `${font.family}:${font.status}`),
    );
    console.log(`fonts: ${fonts.join(" ")}`);
    const unloaded = fonts.filter((font) => !font.endsWith(":loaded"));
    if (unloaded.length > 0) {
      throw new Error(`fonts failed to load: ${unloaded.join(" ")}`);
    }

    // preferCSSPageSize so the document's own @page rules win over the format argument.
    await page.pdf({ path: output, format: "A4", printBackground: true, preferCSSPageSize: true });
  } finally {
    await browser.close();
  }
  console.log(`wrote ${output}`);
}

render().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
