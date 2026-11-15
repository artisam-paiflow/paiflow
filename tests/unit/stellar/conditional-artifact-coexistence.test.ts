import { randomUUID } from "node:crypto";
import type { PrismaClient, Prisma } from "@prisma/client";
import { beforeAll, afterAll, expect, it, vi } from "vitest";
import { scratchDatabase } from "@/tests/helpers/scratch-database";
const m = vi.hoisted(() => ({ client: null as unknown as PrismaClient }));
vi.mock("@/lib/prisma", () => ({
  db: new Proxy(
    {},
    {
      get(_t, key) {
        const value = Reflect.get(m.client, key);
        return typeof value === "function" ? value.bind(m.client) : value;
      },
    },
  ),
}));
import { db } from "@/lib/prisma";
import {
  getConditionalWasmHashes,
  readConditionalArtifactSet,
  conditionalArtifactSetDigest,
  configureConditionalArtifacts,
} from "@/lib/stellar/conditional-artifact-config";
import { getWasmHash, getWasmHashes, clearStellarConfigCache } from "@/lib/stellar/config";
import { EXECUTION_V1_WASM_HASHES } from "@/lib/stellar/execution-artifacts";
import { CONDITIONAL_V2_WASM_HASHES } from "@/lib/stellar/conditional-artifacts";
import { setWasmHash } from "@/lib/stellar/template-db";
import {
  pinTemplateArtifacts,
  assertPinnedTemplateArtifacts,
  contentHash,
} from "@/lib/flow-templates/artifacts";
import { FlowGraphSchema } from "@/lib/flows/schema";
import { conditionalPreparedFixture } from "@/tests/fixtures/conditional-deploy";
import { preparedDeploymentRecovery } from "@/lib/stellar/deployment-recovery";
const scratch = scratchDatabase();
beforeAll(async () => {
  m.client = await scratch.start();
});
afterAll(async () => {
  await scratch.stop();
});
it("separately activates/disables conditional pins with absent-row CAS while retaining legacy registry/template/original evidence", async () => {
  const f = conditionalPreparedFixture(),
    owner = await db.user.create({ data: { username: `coexist-${randomUUID()}` } });
  const graph = FlowGraphSchema.parse({
    nodes: [
      { id: "t", type: "on_receive", config: { asset: { kind: "native" } } },
      {
        id: "p",
        type: "pay",
        config: { asset: { kind: "native" }, recipient: f.owner, fullAmount: true },
      },
    ],
    edges: [{ id: "e", source: "t", target: "p" }],
    fieldPolicies: {
      version: 1,
      nodes: [{ kind: "pay", nodeId: "p", recipient: "constant", payoutValue: "constant" }],
    },
  });
  const flow = await db.flow.create({
    data: { ownerId: owner.id, name: "Retained", templateKind: "PAYER", graph, parameters: {} },
  });
  for (const [kind, wasmHash] of Object.entries(EXECUTION_V1_WASM_HASHES))
    await setWasmHash(kind as "DEPOSIT_TRIGGER" | "PAYER" | "SPLITTER", "testnet", wasmHash, {
      specEntriesXdr: ["synthetic-retained-ABI-evidence"],
    });
  await db.factoryDeployment.create({
    data: { network: "testnet", address: f.factory, wasmHash: "c".repeat(64) },
  });
  clearStellarConfigCache();
  const registry = await db.contractTemplate.findMany({ orderBy: { kind: "asc" } }),
    factory = await db.factoryDeployment.findUniqueOrThrow({ where: { network: "testnet" } }),
    pins = await pinTemplateArtifacts(graph, "testnet", db);
  const template = await db.flowTemplate.create({
      data: { ownerId: owner.id, name: "Published fixture", draft: {} },
    }),
    published = await db.flowTemplateVersion.create({
      data: {
        templateId: template.id,
        version: 1,
        network: "testnet",
        definition: { graph },
        artifacts: pins as unknown as Prisma.InputJsonValue,
        contentHash: contentHash(pins),
      },
    });
  const original = await db.deployment.create({
    data: {
      ownerId: owner.id,
      flowId: flow.id,
      network: "testnet",
      status: "PENDING_SIGNATURE",
      sourceAccount: f.owner,
      graphSnapshot: f.graph,
      paramsSnapshot: f.envelope,
      pipelineSnapshot: f.pipeline,
      unsignedXdr: f.xdr,
      preparedTxHash: f.txHash,
      idempotencyKey: `conditional-deploy:${randomUUID()}`,
    },
  });
  const before = await preparedDeploymentRecovery(original);
  expect(before).toMatchObject({ status: "RESUMABLE", txHash: f.txHash });
  const plan = await configureConditionalArtifacts({ network: "testnet", enabled: true });
  expect(plan.mode).toBe("dry-run");
  expect(await db.conditionalArtifactSet.count()).toBe(0);
  expect(await db.auditLog.count({ where: { action: "CONDITIONAL_ARTIFACT_CONFIGURATION" } })).toBe(
    0,
  );
  const results = await Promise.allSettled([
    configureConditionalArtifacts(
      { network: "testnet", enabled: true, expectedCurrentDigest: plan.currentDigest },
      true,
    ),
    configureConditionalArtifacts(
      { network: "testnet", enabled: false, expectedCurrentDigest: plan.currentDigest },
      true,
    ),
  ]);
  expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((x) => x.status === "rejected")).toHaveLength(1);
  expect(await db.conditionalArtifactSet.count()).toBe(1);
  expect(await db.auditLog.count({ where: { action: "CONDITIONAL_ARTIFACT_CONFIGURATION" } })).toBe(
    1,
  );
  const current = await readConditionalArtifactSet("testnet");
  await configureConditionalArtifacts(
    {
      network: "testnet",
      enabled: true,
      expectedCurrentDigest: conditionalArtifactSetDigest(current),
    },
    true,
  );
  expect(Object.fromEntries(await getConditionalWasmHashes("testnet"))).toEqual(
    CONDITIONAL_V2_WASM_HASHES,
  );
  expect(await getConditionalWasmHashes("mainnet")).toEqual(new Map());
  expect(await getWasmHash("PAYER", "testnet")).toBe(EXECUTION_V1_WASM_HASHES.PAYER);
  expect((await getWasmHashes("testnet")).get("PAYER")).toBe(EXECUTION_V1_WASM_HASHES.PAYER);
  await expect(
    setWasmHash("PAYER", "testnet", CONDITIONAL_V2_WASM_HASHES.PAYER, { specEntriesXdr: [] }),
  ).rejects.toThrow(/separate conditional/);
  await configureConditionalArtifacts(
    {
      network: "testnet",
      enabled: false,
      expectedCurrentDigest: conditionalArtifactSetDigest(
        await readConditionalArtifactSet("testnet"),
      ),
    },
    true,
  );
  expect(await getConditionalWasmHashes("testnet")).toEqual(new Map());
  expect(await preparedDeploymentRecovery(original)).toEqual(before);
  expect(await db.deployment.findUniqueOrThrow({ where: { id: original.id } })).toEqual(original);
  expect(await db.contractTemplate.findMany({ orderBy: { kind: "asc" } })).toEqual(registry);
  expect(await db.factoryDeployment.findUniqueOrThrow({ where: { network: "testnet" } })).toEqual(
    factory,
  );
  expect(await assertPinnedTemplateArtifacts(graph, "testnet", pins, db)).toEqual(pins);
  expect(await db.flowTemplateVersion.findUniqueOrThrow({ where: { id: published.id } })).toEqual(
    published,
  );
});
