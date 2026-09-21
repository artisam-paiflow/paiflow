import { SANDBOX_STARTER_GRAPH, SANDBOX_STARTER_NAME } from "@/lib/flows/starter";
import { flowToPipeline } from "@/lib/flows/to-params";
import { validateFlow } from "@/lib/flows/validate";

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

  assertUsernames(rows.map((r) => r.username));
  for (const r of rows) {
    if (!ARGON2ID_HASH.test(r.passwordHash)) {
      throw new Error(`${r.username}: passwordHash is not an argon2id hash.`);
    }
  }
  assertVia(via);

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

function assertUsernames(usernames: string[]): void {
  const seen = new Set<string>();
  for (const u of usernames) {
    if (!USERNAME.test(u)) throw new Error(`Not a valid username: ${u}`);
    const key = u.toLowerCase();
    if (seen.has(key)) throw new Error(`Duplicate username: ${u}`);
    seen.add(key);
  }
}

function assertVia(via: string): void {
  if (!/^[a-zA-Z0-9_./-]+$/.test(via)) throw new Error(`Bad "via" label: ${via}`);
}

function dollarQuoted(tag: string, body: string): string {
  if (body.includes(`$${tag}$`)) throw new Error(`Body contains its own quote tag $${tag}$.`);
  return `$${tag}$${body}$${tag}$`;
}

/**
 * Gives existing tester accounts the starter flow the alpha testing guide opens on ("One flow is
 * already there: Swap XLM to USDC"). The graph, `parameters` and `templateKind` are exactly what
 * `POST /api/auth/sandbox` stores for the same flow.
 *
 * Create-only, like `buildTesterSeedSql`: an account that already has a flow of that name is
 * skipped and missing from the result, so a re-run never duplicates or overwrites a tester's
 * edited copy. Only `USER`-role rows are touched.
 *
 * The `FLOW_CREATE` audit row keeps `userId` null — the tester did not create it, and the alpha
 * metrics read `AuditLog.userId` as tester activity.
 */
export function buildTesterStarterFlowSql(
  usernames: string[],
  via = "scripts/seed-tester-flows.ts",
): string {
  if (usernames.length === 0) throw new Error("No accounts to seed.");
  assertUsernames(usernames);
  assertVia(via);

  const v = validateFlow(SANDBOX_STARTER_GRAPH);
  if (!v.ok) throw new Error("SANDBOX_STARTER_GRAPH no longer passes validateFlow.");
  const graph = dollarQuoted("graph", JSON.stringify(v.graph));
  const parameters = dollarQuoted("params", JSON.stringify(flowToPipeline(v.graph)));
  // Checked like a username: nothing here may need escaping inside '…'.
  if (!/^[A-Za-z0-9 ]+$/.test(SANDBOX_STARTER_NAME)) throw new Error("Unsafe flow name.");
  const name = `'${SANDBOX_STARTER_NAME}'`;
  const list = usernames.map((u) => `'${u}'`).join(", ");

  return [
    `with seeded as (`,
    `  insert into "Flow" (id, "ownerId", name, "templateKind", graph, parameters, version, "createdAt", "updatedAt")`,
    `  select gen_random_uuid(), u.id, ${name}, '${v.templateKind}'::"TemplateKind",`,
    `         ${graph}::jsonb,`,
    `         ${parameters}::jsonb,`,
    `         1, now(), now()`,
    `  from "User" u`,
    `  where u.username in (${list})`,
    `    and u.role = 'USER'`,
    `    and not exists (select 1 from "Flow" f where f."ownerId" = u.id and f.name = ${name})`,
    `  returning id, "ownerId"`,
    `), audited as (`,
    `  insert into "AuditLog" (id, action, metadata, "createdAt")`,
    `  select gen_random_uuid(), 'FLOW_CREATE',`,
    `         jsonb_build_object('flowId', id, 'ownerId', "ownerId", 'via', '${via}'), now()`,
    `  from seeded`,
    `)`,
    `select u.username, s.id as flow_id from seeded s join "User" u on u.id = s."ownerId" order by u.username;`,
    ``,
  ].join("\n");
}
