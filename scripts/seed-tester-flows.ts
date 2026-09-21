/**
 * Generate the SQL that gives existing alpha-tester accounts the "Swap XLM to USDC" starter flow
 * the alpha testing guide opens on.
 *
 * Like scripts/seed-testers.ts this never connects to a database: the statement goes to stdout to
 * be pasted into the Railway data console. It returns one row per account that received the flow;
 * an account that already had it, or does not exist, is absent from the result.
 *
 * Usage:
 *   pnpm testers:seed-flow-sql --from 7 --to 10
 */
import { buildTesterStarterFlowSql, testerUsernames } from "@/lib/auth/tester-seed-sql";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = process.argv.find((a) => a.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const idx = process.argv.indexOf(`--${name}`);
  const next = process.argv[idx + 1];
  if (idx !== -1 && next && !next.startsWith("--")) {
    return next;
  }
  return undefined;
}

try {
  if (!arg("from") || !arg("to")) {
    console.error("Usage: pnpm testers:seed-flow-sql --from <n> --to <n> [--prefix tester]");
    process.exit(1);
  }
  const usernames = testerUsernames(
    Number(arg("from")),
    Number(arg("to")),
    arg("prefix") ?? "tester",
  );
  process.stdout.write(buildTesterStarterFlowSql(usernames));
  console.error(
    `\nStarter flow for: ${usernames.join(", ")}\n` +
      "Expect one row per username. A missing one already had the flow or does not exist.",
  );
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
