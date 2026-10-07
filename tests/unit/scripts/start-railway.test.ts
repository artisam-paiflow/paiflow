import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const startup = resolve("scripts/start-railway.sh");
let fixture: string;

beforeEach(() => {
  fixture = mkdtempSync(join(tmpdir(), "paiflow-startup-"));
  // Stand in for the migration CLI and server without touching a database.
  writeFileSync(
    join(fixture, "node"),
    `#!/bin/sh
if [ "$1" = "node_modules/prisma/build/index.js" ]; then
  exit "$MIGRATION_EXIT"
fi
if [ "$1" != "node_modules/next/dist/bin/next" ]; then exit 99; fi
trap 'exit 0' TERM
printf '{"pid":%s,"port":"%s"}\\n' "$$" "$4"
while :; do sleep 1; done
`,
    { mode: 0o755 },
  );
});

afterEach(() => {
  rmSync(fixture, { recursive: true, force: true });
});

function environment(port?: string): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    MIGRATION_EXIT: "0",
    PATH: `${fixture}${delimiter}${process.env.PATH ?? ""}`,
    ...(port === undefined ? {} : { PORT: port }),
  };
}

describe("Railway startup", () => {
  it("does not start the server when migrations fail", () => {
    const result = spawnSync("sh", [startup], {
      env: { ...environment(), MIGRATION_EXIT: "17" },
      encoding: "utf8",
    });

    expect(result.status).toBe(17);
    expect(result.stdout).toBe("");
  });

  it.each([
    { configured: undefined, expected: "3000" },
    { configured: "4277", expected: "4277" },
  ])("passes port $expected and delivers SIGTERM directly to the server", async (port) => {
    const child = spawn("sh", [startup], { env: environment(port.configured) });
    const closed = new Promise<{ code: number | null; signal: string | null }>(
      (resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code, signal) => resolve({ code, signal }));
      },
    );

    try {
      const output = await new Promise<string>((resolve, reject) => {
        let text = "";
        child.once("error", reject);
        child.once("exit", () => reject(new Error("Server exited before becoming ready")));
        child.stdout.on("data", (chunk: Buffer) => {
          text += chunk.toString();
          if (text.includes("\n")) resolve(text);
        });
      });
      const server: unknown = JSON.parse(output);
      // exec preserves the shell's PID: there is no wrapper left to swallow signals.
      expect(server).toEqual({ pid: child.pid, port: port.expected });
      child.kill("SIGTERM");
      expect(await closed).toEqual({ code: 0, signal: null });
    } finally {
      child.kill("SIGKILL");
      await closed;
    }
  });
});
