/**
 * Default: read-only expiry inspection. --execute explicitly invokes the
 * budgeted 1-XLM recovery/payment only after both fixture instances expired.
 * pnpm exec tsx --conditions=react-server scripts/recover-ttl-rehearsal.ts FIXTURE.json NEW-OUTPUT.json [--execute]
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { config } from "dotenv";

async function main() {
  config({ path: resolve(".env.local") });
  config({ path: resolve(".env") });
  const { recoverTtlFixture } = await import("@/lib/stellar/ttl-recovery");
  const { db } = await import("@/lib/db");
  const [input, output, execute] = process.argv.slice(2);
  if (
    !input ||
    !output ||
    resolve(input) === resolve(output) ||
    (execute !== undefined && execute !== "--execute") ||
    process.argv.length > 5
  )
    throw new Error("Fixture and distinct new output required");
  let created = false;
  try {
    await recoverTtlFixture(
      JSON.parse(await readFile(input, "utf8")) as unknown,
      execute === "--execute",
      async (report) => {
        await writeFile(output, JSON.stringify(report, null, 2) + "\n", {
          flag: created ? "w" : "wx",
          mode: 0o600,
        });
        created = true;
      },
    );
  } finally {
    await db.$disconnect();
  }
}
main().catch(() => {
  process.stderr.write(
    "TTL recovery rehearsal failed; reconcile public output and budget, never retry payment blindly.\n",
  );
  process.exitCode = 1;
});
