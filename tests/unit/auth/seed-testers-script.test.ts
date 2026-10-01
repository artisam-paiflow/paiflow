import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildTesterSeedSql } from "@/lib/auth/tester-seed-sql";

vi.mock("node:fs/promises", () => ({ mkdir: vi.fn(), writeFile: vi.fn() }));
vi.mock("argon2", () => ({
  default: {
    argon2id: 2,
    hash: vi.fn().mockResolvedValue("stored-hash"),
    verify: vi.fn().mockResolvedValue(true),
  },
}));
vi.mock("@/lib/auth/tester-seed-sql", async () => ({
  testerUsernames: (await import("@/lib/auth/tester-usernames")).testerUsernames,
  buildTesterSeedSql: vi.fn().mockReturnValue("seed SQL"),
}));

const argv = process.argv;
afterEach(() => {
  process.argv = argv;
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

async function run(credentialsDir?: string) {
  vi.resetModules();
  process.argv = [
    "node",
    "seed-testers.ts",
    "--prefix",
    "team",
    "--from",
    "1",
    "--to",
    "1",
    "--pad",
    "2",
    ...(credentialsDir ? ["--credentials-dir", credentialsDir] : []),
  ];
  const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
  await import("@/scripts/seed-testers");
  await vi.waitFor(() =>
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining("a username missing from the result"),
    ),
  );
  const accounts = vi.mocked(buildTesterSeedSql).mock.calls[0]![0];
  return {
    stdout,
    stderr: stderr.mock.calls.map(([line]) => String(line)).join("\n"),
    account: accounts[0]!,
  };
}

const md5 = createHash("md5").update("stored-hash").digest("hex");

describe("seed-testers output", () => {
  it("writes a clean private handout and keeps verification hashes on stderr", async () => {
    const { stdout, stderr, account } = await run("private-handouts");
    const content = vi.mocked(writeFile).mock.calls[0]![1] as string;
    const password = content.match(/Password: (\S+)/)![1]!;
    expect(content).toBe(
      `# team01\n\nUsername: team01\nPassword: ${password}\n\nLog in at https://beta.app.paiflow.xyz\n`,
    );
    expect(account).toMatchObject({ username: "team01", passwordHash: "stored-hash" });
    expect(mkdir).toHaveBeenCalledWith("private-handouts", { recursive: true, mode: 0o700 });
    expect(writeFile).toHaveBeenCalledWith("private-handouts/team01.md", content, {
      mode: 0o600,
      flag: "wx",
    });
    expect(stderr).toContain(`team01      ${md5}`);
    expect(stderr).not.toContain(password);
    expect(stdout).toHaveBeenCalledExactlyOnceWith("seed SQL");
  });

  it("still prints credentials and matching hashes to stderr without a directory", async () => {
    const { stdout, stderr } = await run();
    expect(writeFile).not.toHaveBeenCalled();
    expect(stderr).toMatch(new RegExp(`team01\\s+\\S+\\s+${md5}`));
    expect(stdout).toHaveBeenCalledExactlyOnceWith("seed SQL");
  });
});
