/** Render the beginner developer walkthrough with the event proposal styling. */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { parsers } from "prettier/plugins/markdown";
import { render } from "./render-hackathon-guide-pdf.mjs";
import { guideTheme } from "./pdf-guide-theme.mjs";

const input = path.resolve(process.argv[2] ?? "docs/hackathon/developer-guide.md");
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
const block = (n) => {
  if (n.type === "code") return `<pre><code>${escape(n.value)}</code></pre>`;
  if (n.type === "paragraph" && plain(n).startsWith("Keep wallet secrets in Freighter.")) {
    return `<aside class="warning" role="note">${render(n)}</aside>`;
  }
  return render(n);
};
const body = (items) => items.map(block).join("");
const starts = nodes.flatMap((n, i) => (n.type === "heading" && n.depth === 2 ? [i] : []));
if (starts.length !== 12) throw new Error("Expected twelve walkthrough sections");
const title = plain(nodes[0]);
const contentsStart = nodes.findIndex(
  (n) => n.type === "heading" && n.depth === 3 && plain(n) === "Contents",
);
const resourcesStart = nodes.findIndex(
  (n) => n.type === "heading" && n.depth === 3 && plain(n) === "Choose the right resource",
);
const introEnd =
  resourcesStart >= 0 ? resourcesStart : contentsStart < 0 ? starts[0] : contentsStart;
const resources =
  resourcesStart < 0
    ? ""
    : `<div class="resources">${body(nodes.slice(resourcesStart, contentsStart < 0 ? starts[0] : contentsStart))}</div>`;
const contents =
  contentsStart < 0
    ? ""
    : `<nav class="contents" aria-label="Table of contents">${body(nodes.slice(contentsStart, starts[0]))}</nav>`;
const slug = (text) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_\s-]/gu, "")
    .replace(/\s/g, "-");
const groups = starts.map(
  (start, i) =>
    `<section class="section" id="${escape(slug(plain(nodes[start])))}"><div class="section-heading"><span class="number">${String(i + 1).padStart(2, "0")}</span>${render(nodes[start])}</div>${body(nodes.slice(start + 1, starts[i + 1] ?? nodes.length))}</section>`,
);
const pageGroups = [[0], [1], [2, 3], [4, 5], [6, 7], [8], [9], [10, 11]];
if (resourcesStart >= 0) pageGroups.unshift([]);
const count = pageGroups.length;
const footer = (i) =>
  `<footer><span>${escape(title)}</span><span>${String(i).padStart(2, "0")} <span class="slash">/</span> ${String(count).padStart(2, "0")}</span></footer>`;
const sheets = Array.from(
  { length: count },
  (_, i) =>
    `<article class="sheet">${i === 0 ? `<header class="hero">${render(nodes[0])}<div class="updated">${body(nodes.slice(1, 2))}</div><div class="intro">${body(nodes.slice(2, introEnd))}</div></header>${resources}${contents}` : ""}${pageGroups[i].map((index) => groups[index]).join("")}${footer(i + 1)}</article>`,
).join("");
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escape(title)}</title><style>
${guideTheme}
</style></head><body>${sheets}</body></html>`;
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  const fonts = await page.evaluate(() =>
    [...document.fonts].map((f) => ({ family: f.family, status: f.status })),
  );
  if (fonts.some((f) => f.status !== "loaded")) throw new Error("Font loading failed");
  const overflow = await page.evaluate(() =>
    [...document.querySelectorAll(".sheet")].flatMap((sheet, i) => {
      const bottom = sheet.querySelector("footer").getBoundingClientRect().top - 8;
      return [...sheet.children]
        .filter((n) => n.tagName !== "FOOTER" && n.getBoundingClientRect().bottom > bottom)
        .map((n) => ({
          page: i + 1,
          element: n.className,
          overflow: Math.ceil(n.getBoundingClientRect().bottom - bottom),
        }));
    }),
  );
  if (overflow.length) throw new Error(`Content exceeds page bounds: ${JSON.stringify(overflow)}`);
  await page.pdf({
    path: output,
    format: "A4",
    preferCSSPageSize: true,
    printBackground: true,
    tagged: true,
  });
  if (fs.readFileSync(input, "utf8") !== source)
    throw new Error("Markdown changed during rendering");
  console.log(`Wrote ${output}; ${count} pages; fonts loaded and page bounds checked.`);
} finally {
  await browser.close();
}
