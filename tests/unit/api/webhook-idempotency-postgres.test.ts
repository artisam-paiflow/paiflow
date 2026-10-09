/** Opt-in integration test: only a dedicated local scratch PostgreSQL database is accepted. */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PrismaClient, type Deployment } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const holder = vi.hoisted(() => ({
  db: null as PrismaClient | null,
  submit: vi.fn(),
  status: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  get db() {
    return holder.db!;
  },
}));
vi.mock("@/lib/stellar/trigger", () => ({ submitWebhookExecuteTx: holder.submit }));
vi.mock("@/lib/api/v1/transaction-status", () => ({ getTransactionStatus: holder.status }));
import { executeKeyedWebhook } from "@/lib/webhook-idempotency";
const url = process.env.WEBHOOK_IDEMPOTENCY_TEST_DATABASE_URL;
const schema = `webhook_idem_${randomUUID().replaceAll("-", "")}`;
let admin: PrismaClient;
const deployment = {
  id: randomUUID(),
  network: "testnet",
  flow: { ownerId: randomUUID() },
} as Deployment & { flow: { ownerId: string } };
const hash = "a".repeat(64);
describe.skipIf(!url)("webhook claims on real PostgreSQL", () => {
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (
      !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
      parsed.pathname !== "/webhook_idempotency_test"
    )
      throw new Error("Use a dedicated local webhook_idempotency_test database");
    admin = new PrismaClient({ datasourceUrl: url });
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    parsed.searchParams.set("schema", schema);
    holder.db = new PrismaClient({ datasourceUrl: parsed.toString() });
    await holder.db.$executeRawUnsafe('CREATE TABLE "Deployment" ("id" UUID PRIMARY KEY)');
    await holder.db.$executeRawUnsafe(`CREATE TABLE "AuditLog" (
      "id" UUID PRIMARY KEY, "userId" UUID, "action" TEXT NOT NULL,
      "ip" TEXT, "userAgent" TEXT, "metadata" JSONB,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    const migration = readFileSync(
      "prisma/migrations/20261007141000_webhook_idempotency/migration.sql",
      "utf8",
    );
    for (const statement of migration
      .replace(/^--.*$/gm, "")
      .split(";")
      .filter((s) => s.trim()))
      await holder.db.$executeRawUnsafe(statement);
    await holder.db.$executeRaw`INSERT INTO "Deployment" ("id") VALUES (${deployment.id}::uuid)`;
    holder.status.mockResolvedValue({ txHash: hash, network: "testnet", status: "PENDING" });
  });
  afterAll(async () => {
    await holder.db?.$disconnect();
    if (admin) {
      await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.$disconnect();
    }
  });
  it("only one of 24 simultaneous requests prepares/submits; retries retain the same attempt", async () => {
    holder.submit.mockImplementation(async ({ submissionHooks }) => {
      await submissionHooks.beforeSend(hash);
      await submissionHooks.afterSend(true);
      return { status: "PENDING", txHash: hash };
    });
    const body = { escrow: true, amount: "100" };
    const call = () => executeKeyedWebhook(deployment, "contract", "event-42", body);
    const results = await Promise.all(Array.from({ length: 24 }, call));
    expect(new Set(results.map((r) => r.attemptId)).size).toBe(1);
    expect(holder.submit).toHaveBeenCalledOnce();
    expect(await holder.db!.webhookAttempt.count()).toBe(1);
    expect(await holder.db!.auditLog.count()).toBe(1);
    const attemptId = results[0]!.attemptId;
    expect(await holder.db!.auditLog.findUnique({ where: { id: attemptId } })).toMatchObject({
      action: "DEPLOY_TRIGGER",
      userId: deployment.flow.ownerId,
      metadata: { deploymentId: deployment.id, txHash: hash },
    });
    // Simulate a crash between durable acceptance and its audit, then race repair callbacks.
    await holder.db!.auditLog.delete({ where: { id: attemptId } });
    await Promise.all(Array.from({ length: 24 }, call));
    expect(await holder.db!.auditLog.count()).toBe(1);
    expect(holder.submit).toHaveBeenCalledOnce();
    await expect(
      executeKeyedWebhook(deployment, "contract", "event-42", { escrow: true, amount: "200" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await call();
    expect(holder.submit).toHaveBeenCalledOnce();
  });
  it("retains a pre-send hash when acceptance persistence is interrupted", async () => {
    holder.submit.mockImplementationOnce(async ({ submissionHooks }) => {
      await submissionHooks.beforeSend(hash);
      throw new Error("transport timeout");
    });
    const call = () =>
      executeKeyedWebhook(deployment, "contract", "event-43", { escrow: true, amount: "50" });
    const first = await call();
    expect(first).toMatchObject({ status: "UNKNOWN", txHash: hash });
    const before = holder.submit.mock.calls.length;
    await call();
    expect(holder.submit.mock.calls.length).toBe(before);
  });
});
