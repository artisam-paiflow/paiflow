import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadSnapshotEnvironment, posthogReportConfig } from "@/lib/env";
import { snapshotOptions } from "@/lib/analytics/snapshot-options";

describe("snapshot command defaults", () => {
  it("defaults to the existing staging series with PostHog enabled", () => {
    expect(snapshotOptions([])).toMatchObject({
      network: "testnet",
      audience: "EXTERNAL",
      dir: "reports/analytics-staging",
      posthog: true,
      "app-env": "beta",
      "app-host": "beta.app.paiflow.xyz",
    });
  });
  it("accepts an explicit environment file and overrides without changing the defaults", () => {
    expect(snapshotOptions(["--env-file", ".env.analytics.local"])).toMatchObject({
      "env-file": ".env.analytics.local",
      posthog: true,
    });
    expect(
      snapshotOptions([
        "--network",
        "mainnet",
        "--audience",
        "INTERNAL",
        "--dir",
        "reports/other",
        "--app-env",
        "staging",
        "--app-host",
        "other.example",
        "--no-posthog",
      ]),
    ).toMatchObject({
      network: "mainnet",
      audience: "INTERNAL",
      dir: "reports/other",
      "app-env": "staging",
      "app-host": "other.example",
      posthog: false,
    });
  });
  it.each([
    ["--network", "other"],
    ["--audience", "all"],
    ["--dir", ""],
    ["--env-file", ""],
    ["--app-host", "https://example.com"],
    ["--start", "yesterday"],
    ["--unknown"],
  ])("rejects invalid options %j", (...args) => {
    expect(() => snapshotOptions(args)).toThrow();
  });
});

describe("snapshot credential source", () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "snapshot-env-test-"));
    vi.stubEnv("DATABASE_URL", "postgresql://shell-user:shell-password@localhost/shell-db");
    vi.stubEnv("POSTHOG_PERSONAL_API_KEY", "shell-read-key");
    vi.stubEnv("POSTHOG_PROJECT_ID", "999");
    vi.stubEnv("POSTHOG_API_HOST", "https://eu.posthog.com");
    vi.stubEnv("AUTH_SECRET", undefined);
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });
  async function file(contents: string) {
    const path = join(directory, "analytics.env");
    await writeFile(path, contents);
    return path;
  }
  it("uses the selected file's credentials, clears unrelated source overrides, and needs no app auth", async () => {
    const path = await file(
      'DATABASE_URL="postgresql://reader:file-password@127.0.0.1:15432/railway"\nPOSTHOG_PERSONAL_API_KEY="file-read-key"\nAUTH_SECRET=must-not-load\n',
    );
    loadSnapshotEnvironment(path, true);
    expect(process.env.DATABASE_URL).toBe(
      "postgresql://reader:file-password@127.0.0.1:15432/railway",
    );
    expect(posthogReportConfig()).toEqual({
      apiKey: "file-read-key",
      projectId: "610680",
      apiHost: "https://us.posthog.com",
    });
    expect(process.env.AUTH_SECRET).toBeUndefined();
  });
  it("honors optional source settings in the same explicit file", async () => {
    loadSnapshotEnvironment(
      await file(
        "DATABASE_URL=postgresql://reader@localhost/db\nPOSTHOG_PERSONAL_API_KEY=file-key\nPOSTHOG_PROJECT_ID=42\nPOSTHOG_API_HOST=https://eu.posthog.com\n",
      ),
      true,
    );
    expect(posthogReportConfig()).toMatchObject({
      projectId: "42",
      apiHost: "https://eu.posthog.com",
    });
  });
  it.each([
    "",
    "DATABASE_URL=postgresql://reader@localhost/db\n",
    "POSTHOG_PERSONAL_API_KEY=file-key\n",
  ])(
    "does not fall back to valid shell credentials when the selected file is incomplete",
    async (contents) => {
      expect(() => loadSnapshotEnvironment(join(directory, "absent.env"), true)).toThrow(
        "Cannot read --env-file",
      );
      const path = await file(contents);
      expect(() => loadSnapshotEnvironment(path, true)).toThrow("must define DATABASE_URL");
    },
  );
  it("supports explicit database-only mode without reusing an inherited PostHog key", async () => {
    loadSnapshotEnvironment(await file("DATABASE_URL=postgresql://reader@localhost/db\n"), false);
    expect(process.env.POSTHOG_PERSONAL_API_KEY).toBeUndefined();
    expect(process.env.DATABASE_URL).toBe("postgresql://reader@localhost/db");
  });
  it("preserves shell configuration when no environment file is explicitly selected", () => {
    loadSnapshotEnvironment(undefined, true);
    expect(posthogReportConfig()).toMatchObject({ apiKey: "shell-read-key", projectId: "999" });
    expect(process.env.DATABASE_URL).toContain("shell-db");
  });
  it("sanitizes malformed URL and key diagnostics", async () => {
    const path = await file(
      "DATABASE_URL=invalid-private-value\nPOSTHOG_PERSONAL_API_KEY=file-key\n",
    );
    expect(() => loadSnapshotEnvironment(path, true)).toThrow(
      "requires a nonempty PostgreSQL DATABASE_URL",
    );
  });
});
