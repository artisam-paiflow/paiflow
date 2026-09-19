import { describe, expect, it } from "vitest";
import { buildTesterSeedSql, testerUsernames } from "@/lib/auth/tester-seed-sql";

const HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$3Q2dJ9o0mJ8m1hQx8sC0m0m8o2m1m8o2m1m8o2m1m8o";

describe("testerUsernames", () => {
  it("expands an inclusive range", () => {
    expect(testerUsernames(6, 10)).toEqual([
      "tester6",
      "tester7",
      "tester8",
      "tester9",
      "tester10",
    ]);
  });

  it("rejects a backwards, zero or fractional range", () => {
    expect(() => testerUsernames(10, 6)).toThrow(/Bad range/);
    expect(() => testerUsernames(0, 3)).toThrow(/Bad range/);
    expect(() => testerUsernames(1.5, 3)).toThrow(/Bad range/);
    expect(() => testerUsernames(Number.NaN, 3)).toThrow(/Bad range/);
  });
});

describe("buildTesterSeedSql", () => {
  const rows = [
    { username: "tester6", passwordHash: HASH },
    { username: "tester7", passwordHash: HASH },
  ];

  it("emits one values row per account and is create-only", () => {
    const sql = buildTesterSeedSql(rows);
    expect(sql.match(/gen_random_uuid\(\), 'tester\d+'/g)).toHaveLength(2);
    expect(sql).toContain("on conflict (username) do nothing");
    expect(sql).not.toMatch(/\bupdate\b/i);
    expect(sql).not.toMatch(/\bdelete\b/i);
  });

  it("sets the columns Postgres has no default for", () => {
    const sql = buildTesterSeedSql(rows);
    expect(sql).toContain(
      `insert into "User" (id, username, "passwordHash", role, "isActive", "failedLogins", "createdAt", "updatedAt")`,
    );
    expect(sql).toContain(`'USER'::"Role"`);
  });

  it("writes the audit row raw SQL would otherwise skip, and returns a checkable digest", () => {
    const sql = buildTesterSeedSql(rows);
    expect(sql).toContain("'ADMIN_USER_CREATE'");
    expect(sql).toContain("'via', 'scripts/seed-testers.ts'");
    expect(sql).toContain(`md5("passwordHash") as hash_md5`);
  });

  it("refuses a username that could break out of the string literal", () => {
    expect(() =>
      buildTesterSeedSql([{ username: 'x\'); drop table "User"; --', passwordHash: HASH }]),
    ).toThrow(/Not a valid username/);
    expect(() => buildTesterSeedSql([{ username: "ab", passwordHash: HASH }])).toThrow(
      /Not a valid username/,
    );
  });

  it("refuses anything that is not an argon2id hash, including a plaintext password", () => {
    expect(() =>
      buildTesterSeedSql([{ username: "tester6", passwordHash: "correct horse battery" }]),
    ).toThrow(/not an argon2id hash/);
    expect(() =>
      buildTesterSeedSql([{ username: "tester6", passwordHash: `${HASH}'; select 1; --` }]),
    ).toThrow(/not an argon2id hash/);
  });

  it("refuses duplicates, an empty batch and a hostile via label", () => {
    expect(() =>
      buildTesterSeedSql([
        { username: "tester6", passwordHash: HASH },
        { username: "Tester6", passwordHash: HASH },
      ]),
    ).toThrow(/Duplicate username/);
    expect(() => buildTesterSeedSql([])).toThrow(/No accounts/);
    expect(() => buildTesterSeedSql(rows, "x'; --")).toThrow(/Bad "via"/);
  });
});
