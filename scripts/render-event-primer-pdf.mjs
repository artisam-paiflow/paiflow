/**
 * Designed event primer, using the frozen Markdown as the only content source.
 * Usage: node scripts/render-event-primer-pdf.mjs [path/to/event-primer.md] [--paginate]
 * Writes a PDF beside the source, with the alpha testing guide's local fonts.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { parsers } from "prettier/plugins/markdown";
import { render } from "./render-hackathon-guide-pdf.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const input = path.resolve(process.argv[2] ?? "docs/hackathon/feu-tech/participant-guide.md");
if (!input.endsWith(".md")) throw new Error("Expected a Markdown (.md) input file");
const output = input.replace(/\.md$/, ".pdf");
// Longer event briefs use the same design with measured, flexible page boundaries.
const paginate = process.argv.includes("--paginate");
const escape = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const font = (family, filename, weight) =>
  `@font-face{font-family:'${family}';src:url(data:font/woff2;base64,${fs.readFileSync(path.join(root, "homepage/fonts", filename)).toString("base64")}) format('woff2');font-weight:${weight};font-display:block}`;
const plain = (n) => n.value ?? (n.children ?? []).map(plain).join("");
const source = fs.readFileSync(input, "utf8");
const ast = await parsers.markdown.parse(source);
const nodes = ast.children;
const find = (title) => {
  const i = nodes.findIndex((n) => n.type === "heading" && plain(n) === title);
  if (i < 0) throw new Error(`Required heading missing: ${title}`);
  return i;
};
const glance = find("At a glance");
const program = find("Event program");
const hackathon = nodes.some((n) => n.type === "heading" && plain(n) === "Hackathon schedule")
  ? find("Hackathon schedule")
  : find("Mini hackathon");
const preparation = find("Preparation and integration timeline");
const workshop = nodes.findIndex(
  (n) => n.type === "heading" && plain(n) === "Workshop and seminar",
);
const challenge = find("The challenge");
const prizes = find("Prizes");
const coordination = nodes.findIndex(
  (n) => n.type === "heading" && plain(n) === "Event support and coordination",
);
const timelineFirst = preparation < program;
const pageCount = coordination < 0 ? 3 : 4;
const title = plain(nodes[0]);
const renderBlock = (node) => {
  if (
    node.type === "paragraph" &&
    plain(node).startsWith("Prize pool: PHP 10,000, for qualifying teams only.")
  ) {
    return `<aside class="prize-banner" aria-label="Prize pool"><div class="prize-banner-label">Prize pool</div><div class="prize-banner-amount">PHP 10,000</div><div class="prize-banner-details">${render(node).replace(/Prize pool: PHP 10,000, for qualifying teams only\./, "For qualifying teams only.")}</div></aside>`;
  }
  return render(node);
};
const body = (items) => items.map(renderBlock).join("");
const section = (start, end, number, className = "") =>
  `<section class="section ${className}"><div class="section-heading"><span class="number" aria-hidden="true">${number}</span>${render(nodes[start])}</div>${body(nodes.slice(start + 1, end))}</section>`;
const footer = (number) =>
  `<footer><span>${escape(title)}</span><span>${String(number).padStart(2, "0")} <span class="slash">/</span> ${String(pageCount).padStart(2, "0")}</span></footer>`;
const examples = nodes.findIndex((n, i) => i > challenge && i < prizes && n.type === "table");
if (examples < 0) throw new Error("Challenge examples table missing");
// Use a single reading column when the challenge includes another major section.
const challengeSubsection = nodes.findIndex(
  (n, i) => i > examples && i < prizes && n.type === "heading" && n.depth === 2,
);
const notesSplit = challengeSubsection < 0 ? examples + 5 : challengeSubsection;
const challengeHtml = `<section class="section challenge"><div class="section-heading"><span class="number" aria-hidden="true">04</span>${render(nodes[challenge])}</div>${body(nodes.slice(challenge + 1, examples + 1))}<div class="challenge-notes${challengeSubsection < 0 ? "" : " challenge-notes-stacked"}"><div>${body(nodes.slice(examples + 1, notesSplit))}</div><div>${body(nodes.slice(notesSplit, prizes))}</div></div></section>`;
const majorSections = nodes.flatMap((node, index) =>
  node.type === "heading" && node.depth === 2 ? [index] : [],
);
const flowingContent = majorSections
  .map((start, index) => {
    const className =
      start === glance
        ? "overview"
        : start === preparation
          ? "preparation"
          : start === challenge
            ? "challenge"
            : start === program
              ? "program"
              : "";
    return section(
      start,
      majorSections[index + 1] ?? nodes.length,
      String(index + 1).padStart(2, "0"),
      className,
    );
  })
  .join("");
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escape(title)}</title><style>
${font("Space Grotesk", "space-grotesk-latin.woff2", "300 700")}
${font("Geist", "geist-latin.woff2", "100 900")}
${font("JetBrains Mono", "jetbrains-mono-latin.woff2", "100 800")}
@page{size:A4;margin:0}
*{box-sizing:border-box}html,body{margin:0;padding:0}
body{font-family:Geist,sans-serif;font-size:9.5pt;line-height:1.45;color:#17151a;print-color-adjust:exact;-webkit-print-color-adjust:exact}
.sheet{width:210mm;height:297mm;padding:16mm 17mm 19mm;position:relative;break-after:page;overflow:hidden}
.sheet:last-child{break-after:auto}
h1,h2,h3{font-family:'Space Grotesk',sans-serif;letter-spacing:-.025em}
h1{font-size:34pt;line-height:1.06;margin:0 0 9pt;font-weight:700}
h2{font-size:19pt;line-height:1.1;margin:0;break-after:avoid}
h3{font-size:12pt;line-height:1.2;margin:13pt 0 7pt;break-after:avoid}
p{margin:0 0 8pt}strong{font-weight:650}
a{color:#0079c2;text-decoration:none;border-bottom:1px solid #acd7ef}
code{font-family:'JetBrains Mono',monospace;font-size:7.5pt;color:#5b1641;overflow-wrap:anywhere}
.hero{margin:-16mm -17mm 15pt;padding:${title.length > 30 ? "12mm 17mm 9mm" : "18mm 17mm 12mm"};background-color:#111013;color:#fff;background-image:radial-gradient(ellipse at 100% 0%,rgba(224,0,95,.22),transparent 70%),linear-gradient(rgba(255,177,196,.045) 1px,transparent 1px),linear-gradient(90deg,rgba(255,177,196,.045) 1px,transparent 1px);background-size:auto,24px 24px,24px 24px;border-bottom:3pt solid #ffb1c4}
.hero h1{max-width:${title.length > 30 ? "176mm" : "145mm"};font-size:${title.length > 30 ? "26pt" : "34pt"};color:#ffb1c4}
.hero .updated{font-family:'JetBrains Mono',monospace;font-size:7.3pt;color:#b9acb3;margin-bottom:15pt;letter-spacing:.025em}
.hero .intro{font-size:10.2pt;line-height:1.55;color:#e3dde0;max-width:153mm}
.hero .intro p{margin:0}
.section{margin:0 0 15pt}
.section-heading{display:flex;align-items:baseline;gap:10pt;border-bottom:1.5pt solid #17151a;padding-bottom:7pt;margin:0 0 9pt;break-after:avoid}
.number{font-family:'Space Grotesk',sans-serif;font-size:20pt;font-weight:700;color:#e0005f;line-height:1}
table{width:100%;border-collapse:collapse;table-layout:auto;font-size:8.8pt;line-height:1.4;margin:8pt 0 10pt;border:1px solid #ece6e9}
th,td{padding:7pt 8pt;text-align:left;vertical-align:top;border-bottom:1px solid #ece6e9}
th{background:#17151a;color:#fff;font-size:7.3pt;letter-spacing:.04em;font-weight:600}
tr:nth-child(even){background:#f7f5f6}tr{break-inside:avoid}thead{display:table-header-group}
.overview table td:first-child{width:31%;font-weight:650;color:#65545e}
.overview table td{padding:6.2pt 8pt}
.program h3{margin-top:11pt}
.program h3+p{background:#eef7ff;border-left:3pt solid #0079c2;padding:9pt 11pt;border-radius:0 6pt 6pt 0;font-size:9pt}
.program table td:first-child{width:35%;font-weight:600;font-variant-numeric:tabular-nums}
.program table td{padding:6pt 8pt}
.program>p:last-child{font-size:9pt;color:#5d5660;margin-top:9pt}
.track-heading{display:flex;align-items:baseline;gap:10pt;border-bottom:1.5pt solid #17151a;padding-bottom:8pt;margin-bottom:9pt}
.track-heading h3{font-size:21pt;margin:0}
.hackathon>p:first-of-type{font-size:8.3pt;color:#65545e}
.hackathon table{font-size:9pt;margin-bottom:15pt}
.hackathon table td:first-child{width:29%;white-space:nowrap;font-size:8.4pt;font-weight:650;font-variant-numeric:tabular-nums;color:#5b1641}
.hackathon table td:nth-child(2){width:22%;font-weight:600}
.hackathon table td{padding:8pt}
.workshop{background:#f7f5f6;border:1px solid #ece6e9;border-radius:7pt;padding:11pt 13pt;margin:0 0 20pt}
.workshop h3{margin:0 0 7pt}.workshop p{margin:0 0 5pt}.workshop p:last-child{margin:0}
.preparation p{border-left:2pt solid #ffb1c4;padding:0 0 0 10pt;margin-bottom:12pt;font-size:9.4pt}
.overview-page .preparation p{margin-bottom:10pt}
.preparation p:last-child{background:#fff0f5;border-left-color:#e0005f;padding:9pt 11pt;border-radius:0 5pt 5pt 0}
.challenge-page{font-size:8.9pt;line-height:1.35;padding-top:14mm;padding-left:15mm;padding-right:15mm}
.challenge-page .section-heading{padding-bottom:6pt;margin-bottom:7pt}
.challenge{margin-bottom:8pt}
.challenge p{margin-bottom:5pt}
.challenge-notes{display:grid;grid-template-columns:1fr 1fr;gap:10pt;margin-top:7pt;font-size:8.7pt}
.challenge-notes>div:last-child{border-left:1px solid #ece6e9;padding-left:10pt}
.challenge-notes-stacked{display:block}
.challenge-notes-stacked>div:last-child{border-left:0;padding-left:0;margin-top:13pt}
.challenge-notes-stacked h2{font-size:17pt;margin-bottom:8pt}
.challenge-notes-stacked ol{margin:7pt 0;padding-left:19pt}
.challenge-notes-stacked li{padding-left:3pt}
.challenge-notes-stacked li p{background:none!important;border-left:0!important;padding:0!important;margin-bottom:6pt}
.challenge table{font-size:8pt!important;line-height:1.3;margin:7pt 0}
.challenge table th,.challenge table td{padding:4.5pt 6pt!important}
.challenge table td:first-child{width:22%;font-weight:650}
.challenge table td:nth-child(2){width:44%}
.challenge table code{font-size:7pt}
.challenge p:has(>strong:first-child){background:#eef7ff;padding:6pt 9pt;border-left:2pt solid #0079c2}
.prize-banner{margin:10pt 0 9pt;padding:9pt 13pt;border:1.5pt solid #e0005f;border-radius:6pt;break-inside:avoid;background-color:#17151a;background-image:radial-gradient(ellipse at 100% 0%,rgba(224,0,95,.38),transparent 70%),linear-gradient(115deg,#17151a,#301321);color:#fff;box-shadow:0 2pt 0 #ffb1c4}
.prize-banner-label{font-family:'JetBrains Mono',monospace;font-size:7.5pt;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#ffb1c4;margin-bottom:4pt}
.prize-banner-amount{font-family:'Space Grotesk',sans-serif;font-size:24pt;font-weight:700;line-height:1.05;letter-spacing:-.035em;color:#ffb1c4;margin-bottom:6pt}
.prize-banner-details{font-size:8.5pt;line-height:1.4;color:#f2e8ed;max-width:145mm}
.prize-banner-details p{margin:0}.prize-banner-details strong{color:#fff}
.prizes{margin:0;break-inside:avoid}
.coordination-page .prizes{margin-bottom:22pt}
.prizes .section-heading{margin-bottom:7pt}
.prizes table{font-size:8.4pt;margin:7pt 0 0}
.prizes td,.prizes th{padding:4.5pt 7pt}
.prizes td:nth-child(2){font-family:'Space Grotesk',sans-serif;font-size:10pt;font-weight:700;color:#e0005f;white-space:nowrap}
.prizes td:first-child{font-weight:600;width:31%}
footer{position:absolute;bottom:10mm;left:17mm;right:17mm;padding-top:7pt;border-top:1px solid #d9d0d5;display:flex;justify-content:space-between;font-family:'JetBrains Mono',monospace;font-size:6.5pt;letter-spacing:.06em;text-transform:uppercase;color:#65545e}
footer .slash{color:#e0005f;margin:0 5pt}
.paginated .section{margin-bottom:17pt}
.paginated ul,.paginated ol{padding-left:19pt;margin:8pt 0}
.paginated li{margin-bottom:5pt}
.paginated li p{margin-bottom:4pt}
.paginated .preparation li p{border:0;background:none;padding:0}
.paginated .section>h3{margin-top:12pt}
.paginated .continued h2{font-size:16pt}
.paginated .continued .number{font-size:17pt}
</style></head><body>
${
  paginate
    ? `<div id="source" hidden>${flowingContent}</div><article class="sheet overview-page paginated"><header class="hero">${render(nodes[0])}<div class="updated">${body(nodes.slice(1, 2))}</div><div class="intro">${body(nodes.slice(2, glance))}</div></header>${footer(1)}</article>`
    : `
<article class="sheet overview-page"><header class="hero">${render(nodes[0])}<div class="updated">${body(nodes.slice(1, 2))}</div><div class="intro">${body(nodes.slice(2, glance))}</div></header>${section(glance, timelineFirst ? preparation : program, "01", "overview")}${timelineFirst ? section(preparation, program, "02", "preparation") : section(program, hackathon, "02", "program")}${footer(1)}</article>
<article class="sheet">${timelineFirst ? section(program, hackathon, "03", "program") : ""}<section class="hackathon"><div class="track-heading">${timelineFirst ? "" : '<span class="number" aria-hidden="true">02</span>'}${render(nodes[hackathon])}</div>${body(nodes.slice(hackathon + 1, workshop < 0 ? (timelineFirst ? challenge : preparation) : workshop))}</section>${workshop < 0 ? "" : `<section class="workshop">${body(nodes.slice(workshop, preparation))}</section>`}${timelineFirst ? "" : section(preparation, challenge, "03", "preparation")}${footer(2)}</article>
<article class="sheet challenge-page">${challengeHtml}${coordination < 0 ? section(prizes, nodes.length, "05", "prizes") : ""}${footer(3)}</article>
${coordination < 0 ? "" : `<article class="sheet coordination-page">${section(prizes, coordination, "05", "prizes")}${section(coordination, nodes.length, "06", "coordination")}${footer(4)}</article>`}`
}
</body></html>`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  const fonts = await page.evaluate(() =>
    [...document.fonts].map((f) => ({ family: f.family, status: f.status })),
  );
  if (fonts.some((f) => f.status !== "loaded"))
    throw new Error(`Font loading failed: ${JSON.stringify(fonts)}`);
  if (paginate) {
    await page.evaluate(() => {
      const source = document.querySelector("#source");
      let sheet = document.querySelector(".sheet");
      const footerTemplate = sheet.querySelector("footer").cloneNode(true);
      const newSheet = () => {
        sheet = document.createElement("article");
        sheet.className = "sheet paginated";
        sheet.append(footerTemplate.cloneNode(true));
        document.body.append(sheet);
      };
      const fits = () => {
        const bottom = sheet.querySelector("footer").getBoundingClientRect().top - 8;
        return [...sheet.children].every(
          (child) => child.tagName === "FOOTER" || child.getBoundingClientRect().bottom <= bottom,
        );
      };
      for (const original of [...source.children]) {
        const heading = original.firstElementChild;
        let section;
        const openSection = (continued = false) => {
          section = document.createElement("section");
          section.className = original.className + (continued ? " continued" : "");
          section.append(heading.cloneNode(true));
          sheet.insertBefore(section, sheet.querySelector("footer"));
        };
        openSection();
        const blocks = [...original.children].slice(1);
        for (let i = 0; i < blocks.length; i++) {
          const block = blocks[i];
          section.append(block);
          // Keep subsection headings with their first content block.
          const next = /^H[23]$/.test(block.tagName) ? blocks[i + 1] : null;
          // Keep a subsection's introductory sentence with its table or checklist.
          const detail =
            next && /^(TABLE|UL|OL)$/.test(blocks[i + 2]?.tagName) ? blocks[i + 2] : null;
          if (next) section.append(next);
          if (detail) section.append(detail);
          if (!fits()) {
            block.remove();
            next?.remove();
            detail?.remove();
            if (section.children.length === 1) section.remove();
            newSheet();
            openSection(i > 0);
            section.append(block);
            if (next) section.append(next);
            if (detail) section.append(detail);
            if (!fits())
              throw new Error(`Content block exceeds a page: ${block.textContent.slice(0, 100)}`);
          }
          if (next) i++;
          if (detail) i++;
        }
      }
      source.remove();
      const sheets = [...document.querySelectorAll(".sheet")];
      sheets.forEach((current, i) => {
        current.querySelector("footer>span:last-child").innerHTML =
          `${String(i + 1).padStart(2, "0")} <span class="slash">/</span> ${String(sheets.length).padStart(2, "0")}`;
      });
    });
  }
  // Fixed page boundaries must never silently crop prose or tables.
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
  console.log(`Wrote ${output}; all three fonts loaded; page bounds checked.`);
} finally {
  await browser.close();
}
