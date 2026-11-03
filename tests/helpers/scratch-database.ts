import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { env } from "@/lib/env";

/** Real concurrency needs committed rows. Keep immutable financial fixtures intact
 * and destroy only a new, process-owned database, never tables in the caller DB. */
export function scratchDatabase() {
  const url = new URL(env().DATABASE_URL);
  if (env().NODE_ENV !== "test" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    throw new Error("Scratch database tests require loopback PostgreSQL in test mode");
  const name = `qa_instances_${process.pid}_${randomUUID().replaceAll("-", "")}`;
  const args = [
    "-h",
    url.hostname,
    "-p",
    url.port || "5432",
    "-U",
    decodeURIComponent(url.username),
    "-d",
    "postgres",
    "-X",
    "-q",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
  ];
  const childEnv = { ...process.env, PGPASSWORD: decodeURIComponent(url.password) };
  let created = false;
  let client: PrismaClient | undefined;
  return {
    async start() {
      execFileSync("psql", [...args, `CREATE DATABASE "${name}"`], {
        env: childEnv,
        stdio: "pipe",
      });
      created = true;
      url.pathname = `/${name}`;
      url.searchParams.set("schema", "public");
      execFileSync(
        process.execPath,
        [resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"],
        { env: { ...childEnv, DATABASE_URL: url.toString() }, stdio: "pipe", timeout: 90000 },
      );
      client = new PrismaClient({ datasourceUrl: url.toString() });
      return client;
    },
    async stop() {
      await client?.$disconnect();
      if (created)
        execFileSync("psql", [...args, `DROP DATABASE "${name}" WITH (FORCE)`], {
          env: childEnv,
          stdio: "pipe",
        });
    },
  };
}
