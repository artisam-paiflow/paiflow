/** Render a Windows setup guide. Usage: node scripts/render-setup-guide-pdf.mjs [path/to/guide.md] */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { parsers } from "prettier/plugins/markdown";
import { render } from "./render-hackathon-guide-pdf.mjs";
import { guideTheme } from "./pdf-guide-theme.mjs";

const input = path.resolve(process.argv[2] ?? "docs/hackathon/setup-guide.md");
if (!input.endsWith(".md")) throw new Error("Expected a Markdown input");
const source = fs.readFileSync(input, "utf8");
const nodes = (await parsers.markdown.parse(source)).children;
const title = nodes[0].children.map((node) => node.value ?? "").join("");
const escapedTitle = title
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");
const brand = "Paiflow";
const starts = nodes.flatMap((n, i) => (n.type === "heading" && n.depth === 2 ? [i] : []));
if (starts.length !== 8) throw new Error("Expected eight setup sections");
const screenshots = new Map(
  [
    [
      "images/git-download-windows.png",
      "Git for Windows download page with the x64 download link circled in red",
    ],
    [
      "images/nvm-download-windows.png",
      "NVM for Windows download table with the amd64 installer circled in red",
    ],
  ].map(([url, alt]) => [
    url,
    { alt, data: fs.readFileSync(path.resolve("docs/hackathon", url)).toString("base64") },
  ]),
);
const renderBlock = (node) => {
  const picture = node.type === "paragraph" && node.children.length === 1 && node.children[0];
  if (picture?.type === "image" && screenshots.has(picture.url)) {
    const screenshot = screenshots.get(picture.url);
    return `<figure${picture.url === "images/nvm-download-windows.png" ? ' class="nvm-download"' : ""}><img src="data:image/png;base64,${screenshot.data}" alt="${screenshot.alt}"></figure>`;
  }
  return render(node);
};
const sheets = starts
  .map((start, i) => {
    const content = nodes
      .slice(start, starts[i + 1] ?? nodes.length)
      .map(renderBlock)
      .join("");
    return `<article class="sheet">${i === 0 ? `<header class="hero">${nodes.slice(0, starts[0]).map(render).join("")}</header>` : ""}<section class="section">${content}</section><footer><span>${brand} · Windows setup</span><span>${i + 1} / ${starts.length}</span></footer></article>`;
  })
  .join("");
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapedTitle}</title><style>${guideTheme}
h2{margin:0 0 12pt;padding-bottom:7pt;border-bottom:2pt solid #e0005f}
.hero p{color:#e3dde0}.hero p:first-of-type{font-size:8pt;color:#b9acb3}
pre{margin:8pt 0 10pt;line-height:1.5}h3{margin-top:10pt}
td:first-child{width:30%}table{font-size:8.2pt}li{margin-bottom:5pt}
figure{margin:12pt 0}figure img{display:block;width:auto;max-width:100%;max-height:75mm;height:auto;margin:auto;border:1px solid #d9d0d5}
.nvm-download img{max-height:80mm}
</style></head><body>${sheets}</body></html>`;
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(async () => {
    await Promise.all([...document.images].map((img) => img.decode()));
  });
  const issues = await page.evaluate(() => {
    const failures = [];
    for (const [i, sheet] of [...document.querySelectorAll(".sheet")].entries()) {
      const footer = sheet.querySelector("footer").getBoundingClientRect();
      const bounds = sheet.getBoundingClientRect();
      for (const el of sheet.querySelectorAll("h1,h2,h3,p,pre,li,table,figure,img")) {
        const rect = el.getBoundingClientRect();
        if (rect.bottom > footer.top - 8 || rect.right > bounds.right || rect.left < bounds.left) {
          failures.push({ page: i + 1, text: el.textContent.slice(0, 65) });
        }
      }
    }
    for (const font of document.fonts) {
      if (font.status !== "loaded") failures.push({ font: font.family, status: font.status });
    }
    return failures;
  });
  if (issues.length) throw new Error(`PDF layout check failed: ${JSON.stringify(issues)}`);
  await page.pdf({
    path: input.replace(/\.md$/, ".pdf"),
    format: "A4",
    preferCSSPageSize: true,
    printBackground: true,
    tagged: true,
  });
  if (source !== fs.readFileSync(input, "utf8")) throw new Error("Source changed during rendering");
  console.log(
    `Wrote ${input.replace(/\.md$/, ".pdf")}; ${starts.length} pages; images, fonts and page bounds checked.`,
  );
} finally {
  await browser.close();
}
