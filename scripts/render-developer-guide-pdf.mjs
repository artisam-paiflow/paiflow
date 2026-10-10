/** Render the beginner developer walkthrough with the event proposal styling. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { parsers } from "prettier/plugins/markdown";
import { render } from "./render-hackathon-guide-pdf.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
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
const groups = starts.map(
  (start, i) =>
    `<section class="section"><div class="section-heading"><span class="number">${String(i + 1).padStart(2, "0")}</span>${render(nodes[start])}</div>${body(nodes.slice(start + 1, starts[i + 1] ?? nodes.length))}</section>`,
);
const pageGroups = [[0], [1], [2, 3], [4, 5], [6, 7], [8], [9], [10, 11]];
const count = pageGroups.length;
const footer = (i) =>
  `<footer><span>${escape(title)}</span><span>${String(i).padStart(2, "0")} <span class="slash">/</span> ${String(count).padStart(2, "0")}</span></footer>`;
const sheets = Array.from(
  { length: count },
  (_, i) =>
    `<article class="sheet">${i === 0 ? `<header class="hero">${render(nodes[0])}<div class="updated">${body(nodes.slice(1, 2))}</div><div class="intro">${body(nodes.slice(2, starts[0]))}</div></header>` : ""}${pageGroups[i].map((index) => groups[index]).join("")}${footer(i + 1)}</article>`,
).join("");
const font = (family, filename, weight) =>
  `@font-face{font-family:'${family}';src:url(data:font/woff2;base64,${fs.readFileSync(path.join(root, "homepage/fonts", filename)).toString("base64")}) format('woff2');font-weight:${weight};font-display:block}`;
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escape(title)}</title><style>
${font("Space Grotesk", "space-grotesk-latin.woff2", "300 700")}
${font("Geist", "geist-latin.woff2", "100 900")}
${font("JetBrains Mono", "jetbrains-mono-latin.woff2", "100 800")}
@page{size:A4;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0}
body{font-family:Geist,sans-serif;font-size:9.5pt;line-height:1.45;color:#17151a;print-color-adjust:exact;-webkit-print-color-adjust:exact}
.sheet{width:210mm;height:297mm;padding:16mm 17mm 19mm;position:relative;break-after:page;overflow:hidden}.sheet:last-child{break-after:auto}
h1,h2,h3{font-family:'Space Grotesk',sans-serif;letter-spacing:-.025em}h1{font-size:30pt;line-height:1.06;margin:0 0 8pt}h2{font-size:19pt;line-height:1.1;margin:0}h3{font-size:12pt;margin:12pt 0 7pt}
p{margin:0 0 8pt}strong{font-weight:650}a{color:#0079c2;text-decoration:none;border-bottom:1px solid #acd7ef}
.hero{margin:-16mm -17mm 18pt;padding:12mm 17mm 9mm;background-color:#111013;color:#fff;background-image:radial-gradient(ellipse at 100% 0%,rgba(224,0,95,.22),transparent 70%),linear-gradient(rgba(255,177,196,.045) 1px,transparent 1px),linear-gradient(90deg,rgba(255,177,196,.045) 1px,transparent 1px);background-size:auto,24px 24px,24px 24px;border-bottom:3pt solid #ffb1c4}
.hero h1{color:#ffb1c4}.updated{font-family:'JetBrains Mono',monospace;font-size:7.3pt;color:#b9acb3;margin-bottom:12pt}.intro{font-size:10.2pt;color:#e3dde0}.intro p{margin:0}
.section{margin-bottom:16pt}.section-heading{display:flex;align-items:baseline;gap:10pt;border-bottom:1.5pt solid #17151a;padding-bottom:7pt;margin-bottom:9pt}.number{font-family:'Space Grotesk',sans-serif;font-size:20pt;font-weight:700;color:#e0005f;line-height:1}
ul,ol{padding-left:18pt;margin:8pt 0 12pt}li{margin-bottom:4pt}li p{margin:0}li::marker{color:#e0005f;font-weight:600}
table{width:100%;border-collapse:collapse;font-size:8.5pt;line-height:1.35;margin:10pt 0 12pt;border:1px solid #ece6e9}th,td{padding:4.5pt 7pt;text-align:left;vertical-align:top;border-bottom:1px solid #ece6e9}th{background:#17151a;color:#fff;font-size:7.5pt}tr:nth-child(even){background:#f7f5f6}td:first-child{font-weight:600;width:31%}tr{break-inside:avoid}
code{font-family:'JetBrains Mono',monospace;font-size:8pt;color:#5b1641;overflow-wrap:anywhere}pre{margin:11pt 0 14pt;padding:9pt;background:#f7f5f6;border:1px solid #ece6e9;border-left:3pt solid #e0005f;border-radius:0 6pt 6pt 0;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.6}pre code{color:#17151a}
 .section>p:has(>strong:first-child){background:#eef7ff;border-left:3pt solid #0079c2;padding:7pt 10pt;border-radius:0 6pt 6pt 0}
.warning{background:#fff4cc;border-left:3pt solid #d49a00;padding:9pt 10pt;margin:10pt 0 12pt;border-radius:0 6pt 6pt 0;color:#4a3500}.warning p{margin:0}
footer{position:absolute;bottom:10mm;left:17mm;right:17mm;padding-top:7pt;border-top:1px solid #d9d0d5;display:flex;justify-content:space-between;font-family:'JetBrains Mono',monospace;font-size:6.5pt;letter-spacing:.06em;text-transform:uppercase;color:#65545e}.slash{color:#e0005f;margin:0 5pt}
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
