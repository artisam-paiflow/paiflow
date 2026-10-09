/**
 * Render a hackathon participant guide using the shared JRU document styling.
 * Usage: node scripts/render-hackathon-guide-pdf.mjs [path/to/participant-guide.md]
 * Writes the PDF alongside the Markdown source.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";
import { parsers } from "prettier/plugins/markdown";

const input = path.resolve(process.argv[2] ?? "docs/hackathon/participant-guide.md");
if (!input.endsWith(".md")) throw new Error("Expected a Markdown (.md) input file");
const output = input.replace(/\.md$/, ".pdf");
const parser = parsers.markdown;
const escape = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
export function render(n) {
  const children = () => (n.children || []).map(render).join("");
  switch (n.type) {
    case "root": {
      const blocks = [];
      for (let i = 0; i < n.children.length; i += 1) {
        const child = n.children[i];
        const heading =
          child.type === "heading" && (child.depth === 2 || child.depth === 3)
            ? child.children.map((text) => text.value ?? "").join("")
            : "";
        if (heading === "Pitching" || heading === "Prizes" || heading === "Mini hackathon") {
          // Keep each short section together, including its heading and instructions.
          let end = i + 1;
          while (
            end < n.children.length &&
            !(n.children[end].type === "heading" && n.children[end].depth <= child.depth)
          ) {
            end += 1;
          }
          blocks.push(
            '<section style="break-inside:avoid">' +
              n.children.slice(i, end).map(render).join("") +
              "</section>",
          );
          i = end - 1;
        } else {
          blocks.push(render(child));
        }
      }
      return blocks.join("");
    }
    case "text":
      return escape(n.value);
    case "heading":
      return `<h${n.depth}>${children()}</h${n.depth}>`;
    case "paragraph":
      return `<p>${children()}</p>`;
    case "strong":
      return `<strong>${children()}</strong>`;
    case "emphasis":
      return `<em>${children()}</em>`;
    case "inlineCode":
      return `<code>${escape(n.value)}</code>`;
    case "link":
      // Companion files travel with the PDF; avoid machine-local file links.
      return /^https?:\/\/|^mailto:/i.test(n.url)
        ? `<a href="${escape(n.url)}">${children()}</a>`
        : children();
    case "list":
      return `<${n.ordered ? "ol" : "ul"}>${children()}</${n.ordered ? "ol" : "ul"}>`;
    case "listItem": {
      let content = children();
      if (n.checked !== null && n.checked !== undefined) content = content.replace("<p>", "<p>☐ ");
      return `<li>${content}</li>`;
    }
    case "table": {
      // Slightly tighter example cells keep all ideas on the same page.
      const isExamples = n.children[0]?.children[0]?.children.some(
        (cell) => cell.type === "text" && cell.value === "Idea",
      );
      const cellStyle = isExamples ? ' style="padding:5pt"' : "";
      const rows = n.children.map(
        (row, i) =>
          `<tr>${row.children.map((c) => `<${i ? "td" : "th"}${cellStyle}>${render(c)}</${i ? "td" : "th"}>`).join("")}</tr>`,
      );
      const style = isExamples ? ' style="break-inside:avoid;font-size:8.7pt"' : "";
      return `<table${style}><thead>${rows[0]}</thead><tbody>${rows.slice(1).join("")}</tbody></table>`;
    }
    case "tableCell":
      return children();
    default:
      throw Error(`Unhandled markdown node ${n.type}`);
  }
}
async function main() {
  const ast = await parser.parse(fs.readFileSync(input, "utf8"));
  const title =
    ast.children
      .find((n) => n.type === "heading" && n.depth === 1)
      ?.children.map((n) => n.value ?? "")
      .join("") || "Paiflow Hackathon Mechanics";
  const footer = /Event Primer$/.test(title)
    ? title.toUpperCase()
    : title.replace(/\s+Hackathon Mechanics$/, "").toUpperCase() + " HACKATHON · Mechanics";
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escape(title)}</title><style>
 @page{size:A4}*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;font-size:10pt;line-height:1.45;color:#29262e;margin:0}h1{font-size:24pt;line-height:1.2;margin:0 0 6pt}h1+p{color:#756778;font-size:9pt;margin:0 0 18pt}h2{font-size:16pt;line-height:1.25;margin:19pt 0 9pt;padding-bottom:5pt;border-bottom:1px solid #ddc7df;break-after:avoid}h3{break-after:avoid}p{margin:8pt 0}a{color:#e60075;text-decoration:underline}ul,ol{padding-left:19pt;margin:8pt 0}li{margin:4pt 0}li p{margin:0}li::marker{color:#e60075}table{width:100%;border-collapse:collapse;font-size:9.2pt;line-height:1.4;margin:10pt 0;table-layout:auto}th,td{padding:6pt;border-bottom:1px solid #ddc7df;text-align:left;vertical-align:top}th{font-weight:bold;background:#faf6fa}tr:nth-child(even){background:#faf6fa}tr{break-inside:avoid}thead{display:table-header-group}code{font-family:monospace;font-size:8.5pt;overflow-wrap:anywhere}table:first-of-type td:first-child{font-weight:bold;min-width:120pt}
 </style></head><body>${render(ast)}</body></html>`;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await page.pdf({
      path: output,
      format: "A4",
      tagged: true,
      printBackground: true,
      margin: { top: "17mm", bottom: "19mm", left: "16mm", right: "16mm" },
      displayHeaderFooter: true,
      headerTemplate: "<div></div>",
      footerTemplate: `<div style="width:100%;margin:0 16mm;border-top:1px solid #ddc7df;padding-top:5px;font-size:6px;color:#756778;display:flex;justify-content:space-between"><span>${escape(footer)}</span><span><span class="pageNumber"></span>/<span class="totalPages"></span></span></div>`,
    });
  } finally {
    await browser.close();
  }
  console.log(`Wrote ${output}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
