/**
 * Generate the SQL that seeds a batch of alpha-tester accounts.
 *
 * This never connects to a database. The staging Postgres has no public proxy, so the statement
 * is pasted into the Railway data console by hand; this script only makes that repeatable and
 * keeps the hashing parameters the app's own.
 *
 * stdout is the SQL (hashes only — safe to paste anywhere). stderr is the one-time credential
 * list: username, generated password, and md5 of the stored hash to compare with the `hash_md5`
 * column the statement returns. With --credentials-dir, passwords go only to private handouts;
 * the username/hash_md5 verification list still prints to stderr.
 *
 * A password printed here is only a candidate until the statement returns that username with a
 * matching `hash_md5`. A username that already existed is skipped by `on conflict do nothing`,
 * is absent from the result, and keeps its old password — the one printed for it never applies.
 *
 * Usage:
 *   pnpm testers:seed-sql --from 6 --to 10            # tester6 … tester10
 *   pnpm testers:seed-sql --from 6 --to 10 > seed.sql # SQL to a file, credentials to the terminal
 */
import { createHash, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
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
    console.error(
      "Usage: pnpm testers:seed-sql --from <n> --to <n> [--prefix tester] [--pad <n>] [--credentials-dir <dir>]",
    );
    process.exit(1);
  }

  const accounts = [];
  for (const username of testerUsernames(from, to, prefix, Number(arg("pad") ?? "0"))) {
    const password = generatePassword(username);
    const passwordHash = await argon2.hash(password, ARGON_OPTS);
    if (!(await argon2.verify(passwordHash, password))) {
      throw new Error(`${username}: generated hash does not verify.`);
    }
    accounts.push({ username, password, passwordHash });
  }

  const sql = buildTesterSeedSql(accounts);
  const credentialsDir = arg("credentials-dir");
  if (credentialsDir) {
    await mkdir(credentialsDir, { recursive: true, mode: 0o700 });
    for (const a of accounts) {
      await writeFile(
        join(credentialsDir, `${a.username}.md`),
        `# ${a.username}\n\nUsername: ${a.username}\nPassword: ${a.password}\n\nLog in at https://beta.app.paiflow.xyz\n`,
        { mode: 0o600, flag: "wx" },
      );
    }
  }
  process.stdout.write(sql);

  console.error(
    credentialsDir
      ? "\nusername    hash_md5"
      : "\nusername    password                    hash_md5",
  );
  for (const a of accounts) {
    const md5 = createHash("md5").update(a.passwordHash).digest("hex");
    console.error(`${a.username.padEnd(12)}${credentialsDir ? "" : a.password.padEnd(28)}${md5}`);
  }
  console.error(
    "\nHand out a password only for a username the SQL returns with this hash_md5:\n" +
      "a username missing from the result already existed, was skipped, and keeps its old password.",
  );
})().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
