/** Render the API walkthrough with the shared developer-guide theme. */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";
import { parsers } from "prettier/plugins/markdown";
import { render } from "./render-hackathon-guide-pdf.mjs";
import { guideTheme } from "./pdf-guide-theme.mjs";

export async function renderApiQuickstart(inputPath) {
  const input = path.resolve(inputPath);
  if (!input.endsWith(".md")) throw new Error("Expected a Markdown input");
  const output = input.replace(/\.md$/, ".pdf");
  const source = fs.readFileSync(input, "utf8");
  const nodes = (await parsers.markdown.parse(source)).children;
  const plain = (n) => n.value ?? (n.children ?? []).map(plain).join("");
  const escape = (s) =>
    String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  const title = plain(nodes[0]);
  let section = 0;
  const body = nodes
    .slice(3)
    .map((node) => {
      if (
        node.type === "paragraph" &&
        node.children?.[0]?.type === "strong" &&
        plain(node) !== "Choose your integration path."
      ) {
        return `<aside class="api-callout">${render(node)}</aside>`;
      }
      if (node.type !== "heading" || node.depth !== 2) return render(node);
      section += 1;
      const text = plain(node).replace(/^\d+\s+/, "");
      return `<div class="section-heading"><span class="number">${String(section).padStart(2, "0")}</span><h2>${escape(text)}</h2></div>`;
    })
    .join("");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escape(title)}</title><style>
${guideTheme}
@page{size:A4;margin:16mm 0 19mm}
@page:first{margin-top:0}
.hero{margin:0 0 18pt;padding:12mm 17mm 9mm}
.content{margin:0 17mm}
.section-heading{margin-top:18pt;break-after:avoid;break-inside:avoid}
h3{break-after:avoid}thead{display:table-header-group}
pre,pre code{font-size:7.3pt}pre{line-height:1.35;break-inside:avoid}.long-code{break-inside:auto}
.api-callout{break-inside:avoid;background:#eef7ff;border-left:3pt solid #0079c2;padding:7pt 10pt;border-radius:0 6pt 6pt 0;margin:0 0 8pt}.api-callout p{margin:0}
</style></head><body><header class="hero">${render(nodes[0])}<div class="updated">${render(nodes[1])}</div><div class="intro">${render(nodes[2])}</div></header><main class="content">${body}</main></body></html>`;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    const fonts = await page.evaluate(() =>
      [...document.fonts].map((font) => ({ family: font.family, status: font.status })),
    );
    if (fonts.some((font) => font.status !== "loaded")) throw new Error("Font loading failed");
    const overflow = await page.evaluate(() =>
      [...document.querySelectorAll("body>*")]
        .filter(
          (node) =>
            node.getBoundingClientRect().right > document.body.getBoundingClientRect().right + 1,
        )
        .map((node) => node.tagName),
    );
    // The full-width cover deliberately extends into the page margins.
    if (overflow.some((tag) => tag !== "HEADER"))
      throw new Error(`Content exceeds width: ${overflow}`);
    await page.pdf({
      path: output,
      format: "A4",
      preferCSSPageSize: true,
      printBackground: true,
      tagged: true,
      displayHeaderFooter: true,
      headerTemplate: "<div></div>",
      footerTemplate: `<div style="width:100%;margin:0 17mm;padding-top:7px;border-top:1px solid #d9d0d5;display:flex;justify-content:space-between;font-family:monospace;font-size:8px;color:#65545e;text-transform:uppercase"><span>${escape(title)}</span><span><span class="pageNumber"></span> <span style="color:#e0005f">/</span> <span class="totalPages"></span></span></div>`,
    });
    if (fs.readFileSync(input, "utf8") !== source)
      throw new Error("Markdown changed during rendering");
    console.log(`Wrote ${output}; fonts loaded and content width checked.`);
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await renderApiQuickstart(process.argv[2] ?? "docs/hackathon/developer-api-quickstart.md");
}
