#!/usr/bin/env tsx
/**
 * Generates the changelog table for an Instawards weekly milestone report.
 *
 * One row per merge into the target branch, with the PR title, the issues it
 * closes, and a commit link. Point --repo at the public repository so the links
 * resolve for a reader who is not a member of the private one.
 *
 * Usage:
 *   pnpm instawards:changelog --since 2026-09-07 --until 2026-09-13 \
 *     --ref mirror/develop --repo https://github.com/artisam-paiflow/paiflow
 */
import { execFileSync } from "node:child_process";

type Row = {
  date: string;
  sha: string;
  subject: string;
  title: string;
  issues: string[];
};

const SEP = "\x1f";

function arg(name: string, fallback?: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.slice(name.length + 3);
  const i = process.argv.indexOf(`--${name}`);
  const next = i === -1 ? undefined : process.argv[i + 1];
  if (next && !next.startsWith("--")) return next;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing --${name}`);
}

function git(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

/** `gh` is optional: without it, or for a commit that is not a merge, the
 *  subject line is used as the title and no issues are resolved. */
function prDetails(pr: string): { title?: string; issues: string[] } {
  try {
    const raw = execFileSync("gh", ["pr", "view", pr, "--json", "title,body"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const { title, body } = JSON.parse(raw) as { title: string; body: string | null };
    const issues = [...(body ?? "").matchAll(/\b(?:closes|fixes|resolves)\s+#(\d+)/gi)].map(
      (m) => `#${m[1]}`,
    );
    return { title, issues: [...new Set(issues)] };
  } catch {
    return { issues: [] };
  }
}

function collect(ref: string, since: string, until: string): Row[] {
  const log = git([
    "log",
    "--first-parent",
    // Both bounds carry an explicit time. Git's approxidate resolves a bare
    // YYYY-MM-DD using the current time of day, so `--since=2026-09-07` run in
    // the evening silently drops that morning's commits and the same command
    // yields a different table depending on when it runs.
    `--since=${since} 00:00:00`,
    `--until=${until} 23:59:59`,
    `--format=%H%x1f%cs%x1f%s`,
    ref,
  ]);
  if (!log) return [];

  return log.split("\n").map((line) => {
    const [sha = "", date = "", subject = ""] = line.split(SEP);
    const merge = subject.match(/^Merge pull request #(\d+)/);
    if (!merge?.[1]) return { date, sha, subject, title: subject, issues: [] };

    const pr = merge[1];
    const { title, issues } = prDetails(pr);
    return {
      date,
      sha,
      subject,
      title: title ?? subject,
      issues: issues.length ? issues : [`#${pr}`],
    };
  });
}

function table(rows: Row[], repo: string): string {
  const head = "| Date | Change | Issues | Commit |\n| --- | --- | --- | --- |";
  if (!rows.length) return `${head}\n| — | No merges in this window. | — | — |`;
  const body = rows
    .map((r) => {
      const short = r.sha.slice(0, 7);
      const link = `[\`${short}\`](${repo}/commit/${r.sha})`;
      return `| ${r.date} | ${r.title} | ${r.issues.join(", ") || "—"} | ${link} |`;
    })
    .join("\n");
  return `${head}\n${body}`;
}

function main() {
  const since = arg("since");
  const until = arg("until");
  const ref = arg("ref", "origin/develop");
  const repo = arg("repo", "https://github.com/artisam-paiflow/paiflow").replace(/\/+$/, "");

  const rows = collect(ref, since, until);
  console.log(table(rows, repo));
  console.error(`\n${rows.length} merge(s) on ${ref}, ${since}..${until}`);
}

main();
