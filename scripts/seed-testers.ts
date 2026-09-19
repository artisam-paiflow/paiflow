/**
 * Generate the SQL that seeds a batch of alpha-tester accounts.
 *
 * This never connects to a database. The staging Postgres has no public proxy, so the statement
 * is pasted into the Railway data console by hand; this script only makes that repeatable and
 * keeps the hashing parameters the app's own.
 *
 * stdout is the SQL (hashes only — safe to paste anywhere). stderr is the one-time credential
 * list: username, generated password, and md5 of the stored hash to compare with the `hash_md5`
 * column the statement returns. Nothing is written to disk; save the passwords yourself.
 *
 * Usage:
 *   pnpm testers:seed-sql --from 6 --to 10            # tester6 … tester10
 *   pnpm testers:seed-sql --from 6 --to 10 > seed.sql # SQL to a file, credentials to the terminal
 */
import { createHash, randomBytes } from "node:crypto";
import argon2 from "argon2";
import { buildTesterSeedSql, testerUsernames } from "@/lib/auth/tester-seed-sql";

// Keep in step with argonOpts() in lib/auth.ts, which is server-only and cannot be imported
// from a script. prisma/seed.ts carries the same copy for the same reason.
const ARGON_OPTS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

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

function generatePassword(username: string): string {
  for (;;) {
    const pw = randomBytes(18).toString("base64url");
    // The admin route refuses a password containing the username; hold seeded ones to the same.
    if (!pw.toLowerCase().includes(username.toLowerCase())) return pw;
  }
}

(async () => {
  const from = Number(arg("from"));
  const to = Number(arg("to"));
  const prefix = arg("prefix") ?? "tester";
  if (!arg("from") || !arg("to")) {
    console.error("Usage: pnpm testers:seed-sql --from <n> --to <n> [--prefix tester]");
    process.exit(1);
  }

  const accounts = [];
  for (const username of testerUsernames(from, to, prefix)) {
    const password = generatePassword(username);
    const passwordHash = await argon2.hash(password, ARGON_OPTS);
    if (!(await argon2.verify(passwordHash, password))) {
      throw new Error(`${username}: generated hash does not verify.`);
    }
    accounts.push({ username, password, passwordHash });
  }

  process.stdout.write(buildTesterSeedSql(accounts));

  console.error("\nusername    password                    hash_md5");
  for (const a of accounts) {
    const md5 = createHash("md5").update(a.passwordHash).digest("hex");
    console.error(`${a.username.padEnd(12)}${a.password.padEnd(28)}${md5}`);
  }
  console.error("\nShown once. Existing usernames are skipped by the SQL and keep their password.");
})().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
