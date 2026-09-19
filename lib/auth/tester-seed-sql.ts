// Same rule as CreateSchema in app/api/admin/users/route.ts. It is also what makes it safe to
// build the statement as a string: a username that passes cannot carry a quote.
const USERNAME = /^[a-zA-Z0-9_.-]{3,32}$/;

// PHC string for argon2id. No quote, backslash or whitespace can appear in one.
const ARGON2ID_HASH = /^\$argon2id\$v=\d+\$m=\d+,t=\d+,p=\d+\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/;

export type TesterSeedRow = { username: string; passwordHash: string };

export function testerUsernames(from: number, to: number, prefix = "tester"): string[] {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from) {
    throw new Error(`Bad range: --from ${from} --to ${to}`);
  }
  return Array.from({ length: to - from + 1 }, (_, i) => `${prefix}${from + i}`);
}

/**
 * One create-only statement for the accounts a tester round needs. The staging database is not
 * reachable from a laptop, so this is run by hand in the Railway console rather than through
 * Prisma — which is why it spells out what Prisma would otherwise fill in:
 *
 * - `id` and `"updatedAt"` have no database default; `@default(uuid())` and `@updatedAt` are
 *   applied by the client.
 * - `on conflict do nothing` means a re-run can never reset the password of an account a tester
 *   already holds.
 * - Raw SQL skips the `ADMIN_USER_CREATE` audit row the admin route writes, so it is inserted
 *   here. `userId` stays null: no admin session performed this.
 *
 * It returns md5 of each stored hash so the result can be checked against what was generated
 * without logging in as the tester.
 */
export function buildTesterSeedSql(rows: TesterSeedRow[], via = "scripts/seed-testers.ts"): string {
  if (rows.length === 0) throw new Error("No accounts to seed.");

  const seen = new Set<string>();
  for (const r of rows) {
    if (!USERNAME.test(r.username)) throw new Error(`Not a valid username: ${r.username}`);
    if (!ARGON2ID_HASH.test(r.passwordHash)) {
      throw new Error(`${r.username}: passwordHash is not an argon2id hash.`);
    }
    const key = r.username.toLowerCase();
    if (seen.has(key)) throw new Error(`Duplicate username: ${r.username}`);
    seen.add(key);
  }
  if (!/^[a-zA-Z0-9_./-]+$/.test(via)) throw new Error(`Bad "via" label: ${via}`);

  const values = rows
    .map(
      (r) =>
        `    (gen_random_uuid(), '${r.username}', '${r.passwordHash}', 'USER'::"Role", true, 0, now(), now())`,
    )
    .join(",\n");

  return [
    `with new_users as (`,
    `  insert into "User" (id, username, "passwordHash", role, "isActive", "failedLogins", "createdAt", "updatedAt")`,
    `  values`,
    values,
    `  on conflict (username) do nothing`,
    `  returning id, username, "passwordHash"`,
    `), audited as (`,
    `  insert into "AuditLog" (id, action, metadata, "createdAt")`,
    `  select gen_random_uuid(), 'ADMIN_USER_CREATE',`,
    `         jsonb_build_object('newUserId', id, 'role', 'USER', 'via', '${via}'), now()`,
    `  from new_users`,
    `)`,
    `select username, id, md5("passwordHash") as hash_md5 from new_users order by username;`,
    ``,
  ].join("\n");
}
