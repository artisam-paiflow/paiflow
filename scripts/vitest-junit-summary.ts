#!/usr/bin/env tsx
/**
 * Prints a markdown pass/fail/skip table from vitest's junit report, one row
 * per vitest project, for CI's job summary.
 *
 * The junit reporter does not record the project, so files are grouped the
 * way vitest.config.ts splits them: `.test.tsx` is the `dom` project and
 * `.test.ts` the `node` project (tests/unit/test-config.test.ts keeps the two
 * in step). A missing report is a failure to state, not a reason to exit
 * non-zero: the test step has already failed the job if tests did not run.
 *
 * Usage:
 *   pnpm test:ci; tsx scripts/vitest-junit-summary.ts [reports/vitest-junit.xml]
 */
import { existsSync, readFileSync } from "node:fs";

type Counts = { files: number; tests: number; failed: number; skipped: number };

const file = process.argv[2] ?? "reports/vitest-junit.xml";

function attr(tag: string, name: string): string | undefined {
  return new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
}

function summarise(xml: string): Map<string, Counts> {
  const byProject = new Map<string, Counts>();
  for (const [tag] of xml.matchAll(/<testsuite\s[^>]*>/g)) {
    const suite = attr(tag, "name") ?? "";
    const project = suite.endsWith(".tsx") ? "dom" : "node";
    const c = byProject.get(project) ?? { files: 0, tests: 0, failed: 0, skipped: 0 };
    c.files += 1;
    c.tests += Number(attr(tag, "tests") ?? 0);
    c.failed += Number(attr(tag, "failures") ?? 0) + Number(attr(tag, "errors") ?? 0);
    c.skipped += Number(attr(tag, "skipped") ?? 0);
    byProject.set(project, c);
  }
  return byProject;
}

if (!existsSync(file)) {
  console.log(
    `### Unit tests\n\nNo junit report at \`${file}\`: the test step did not produce one.`,
  );
  process.exit(0);
}

const rows = [...summarise(readFileSync(file, "utf8"))].sort(([a], [b]) => a.localeCompare(b));
const lines = [
  "### Unit tests",
  "",
  "| Project | Files | Passed | Failed | Skipped |",
  "| --- | ---: | ---: | ---: | ---: |",
];
for (const [project, c] of rows) {
  const passed = c.tests - c.failed - c.skipped;
  const mark = c.failed > 0 ? "❌" : "✅";
  lines.push(`| ${mark} \`${project}\` | ${c.files} | ${passed} | ${c.failed} | ${c.skipped} |`);
}
lines.push("", `Full report: the \`vitest-junit\` artifact on this run.`);
console.log(lines.join("\n"));
