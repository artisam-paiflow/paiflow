import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { scratchDatabase } from "@/tests/helpers/scratch-database";
import { conditionalPreparedFixture } from "@/tests/fixtures/conditional-deploy";
import {
  ConditionalDeployPrepareSchema,
  conditionalDeploymentKey,
} from "@/lib/deployments/conditional-prepare-schema";

const scratch = scratchDatabase();
let client: PrismaClient;
let ownerId: string, flowId: string;
const json = (value: unknown) => value as Prisma.InputJsonValue;
beforeAll(async () => {
  client = await scratch.start();
  const owner = await client.user.create({ data: { username: `evidence-${randomUUID()}` } });
  ownerId = owner.id;
  const flow = await client.flow.create({
    data: {
      ownerId,
      name: "Evidence",
      templateKind: "ROUTER",
      graph: json(conditionalPreparedFixture().graph),
      parameters: { generation: "conditional-v2", version: 2, draft: true },
    },
  });
  flowId = flow.id;
});
afterAll(async () => {
  await scratch.stop();
});
function data() {
  const f = conditionalPreparedFixture();
  return {
    ownerId,
    flowId,
    network: "testnet",
    status: "PENDING_SIGNATURE" as const,
    sourceAccount: f.owner,
    graphSnapshot: json(f.graph),
    paramsSnapshot: json(f.envelope),
    pipelineSnapshot: json(f.pipeline),
    unsignedXdr: f.xdr,
    preparedTxHash: f.txHash,
    idempotencyKey: conditionalDeploymentKey(randomUUID()),
  };
}

describe("sealed ordinary conditional deployment evidence", () => {
  it("requires complete conditional hash/key evidence, preserving old ordinary restrictions", async () => {
    const legacy = await client.deployment.create({
      data: { ownerId, flowId, network: "testnet", graphSnapshot: {}, paramsSnapshot: [] },
    });
    await expect(
      client.deployment.update({
        where: { id: legacy.id },
        data: { preparedTxHash: "ab".repeat(32) },
      }),
    ).rejects.toThrow(/Deployment_instance_evidence/);
    for (const patch of [
      { idempotencyKey: null },
      { idempotencyKey: "other" },
      { unsignedXdr: null },
      { sourceAccount: null },
      { pipelineSnapshot: Prisma.DbNull },
      { paramsSnapshot: json({ version: 2, generation: "conditional-v2" }) },
      { graphSnapshot: json({ nodes: [], edges: [] }) },
      { preparedTxHash: "invalid" },
    ])
      await expect(client.deployment.create({ data: { ...data(), ...patch } })).rejects.toThrow(
        /Deployment_instance_evidence/,
      );
    const saved = await client.deployment.create({ data: data() });
    expect(saved.preparedTxHash).toMatch(/^[a-f0-9]{64}$/);
  });
  it.each([
    "graphSnapshot",
    "paramsSnapshot",
    "pipelineSnapshot",
    "unsignedXdr",
    "preparedTxHash",
    "idempotencyKey",
    "sourceAccount",
    "network",
    "ownerId",
    "flowId",
    "instanceSnapshot",
    "instanceRequestDigest",
  ])("cannot change sealed %s", async (field) => {
    const saved = await client.deployment.create({ data: data() });
    let replacement: unknown = field.endsWith("Snapshot") ? {} : "changed";
    if (field === "ownerId" || field === "flowId") replacement = randomUUID();
    const patch = { [field]: replacement } as Prisma.DeploymentUpdateInput;
    await expect(
      client.deployment.update({ where: { id: saved.id }, data: patch }),
    ).rejects.toThrow(/Prepared conditional deployment evidence is immutable/);
    expect(await client.deployment.findUniqueOrThrow({ where: { id: saved.id } })).toEqual(saved);
  });
  it("retains sealed evidence on delete while allowing normal status/hosted/service lifecycle", async () => {
    const saved = await client.deployment.create({ data: data() });
    const confirmed = await client.deployment.update({
      where: { id: saved.id },
      data: { status: "CONFIRMED", confirmedAt: new Date(), hostedExecutionEnabled: true },
    });
    expect(confirmed.preparedTxHash).toBe(saved.preparedTxHash);
    const retiring = await client.deployment.update({
      where: { id: saved.id },
      data: { serviceState: "RETIRING", retirementRequestedAt: new Date() },
    });
    expect(retiring.paramsSnapshot).toEqual(saved.paramsSnapshot);
    await expect(client.deployment.delete({ where: { id: saved.id } })).rejects.toThrow(
      /Prepared conditional deployment evidence must be retained/,
    );
  });
  it("preserves the retained template SQL admission branch and existing immutable trigger", async () => {
    const template = await client.flowTemplate.create({
      data: { ownerId, name: "Retained", draft: {} },
    });
    const version = await client.flowTemplateVersion.create({
      data: {
        templateId: template.id,
        version: 1,
        definition: {},
        network: "testnet",
        artifacts: {},
        contentHash: "ab".repeat(32),
      },
    });
    const base = data();
    const saved = await client.deployment.create({
      data: {
        ...base,
        templateVersionId: version.id,
        graphSnapshot: {},
        paramsSnapshot: [],
        instanceSnapshot: { version: 1 },
        instanceRequestDigest: "cd".repeat(32),
        idempotencyKey: "retained-template-key",
      },
    });
    await expect(
      client.deployment.update({
        where: { id: saved.id },
        data: { paramsSnapshot: { changed: true } },
      }),
    ).rejects.toThrow(/Template instance admission evidence is immutable/);
    await expect(
      client.deployment.update({
        where: { id: saved.id },
        data: { preparedTxHash: "ef".repeat(32) },
      }),
    ).rejects.toThrow(/Prepared template instance transaction is immutable/);
    expect(
      (await client.deployment.findUniqueOrThrow({ where: { id: saved.id } })).preparedTxHash,
    ).toBe(saved.preparedTxHash);
  });
});

describe("conditional deployment preparation identity", () => {
  it("requires strict version2 key before admission and canonicalizes UUID key identity only", () => {
    const key = "ABCDEFAB-1234-4234-8234-ABCDEFABCDEF";
    const value = {
      version: 2,
      flowId: randomUUID(),
      sourceAccount: conditionalPreparedFixture().owner,
      preparationKey: key,
    };
    expect(ConditionalDeployPrepareSchema.parse(value)).toEqual(value);
    expect(conditionalDeploymentKey(key)).toBe(`conditional-deploy:${key.toLowerCase()}`);
    for (const invalid of [
      { ...value, version: 1 },
      { ...value, preparationKey: "" },
      { ...value, unknown: true },
      { ...value, sourceAccount: "invalid" },
    ])
      expect(ConditionalDeployPrepareSchema.safeParse(invalid).success).toBe(false);
    for (const field of Object.keys(value)) {
      const missing: Record<string, unknown> = { ...value };
      delete missing[field];
      expect(ConditionalDeployPrepareSchema.safeParse(missing).success).toBe(false);
    }
  });
});
