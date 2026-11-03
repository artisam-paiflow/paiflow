import { createHash } from "node:crypto";
import type { Prisma, TemplateKind } from "@prisma/client";
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { describe, expect, it, vi } from "vitest";
import {
  contentHash,
  pinTemplateArtifacts,
  assertPinnedTemplateArtifacts,
} from "@/lib/flow-templates/artifacts";
import { FlowGraphSchema } from "@/lib/flows/schema";
import {
  EXECUTION_V1_WASM_HASHES,
  MUTATION_V1_WASM_HASHES,
} from "@/lib/stellar/execution-artifacts";
const A = Keypair.random().publicKey();
const factory = StrKey.encodeContract(Buffer.alloc(32, 1));
const graph = () =>
  FlowGraphSchema.parse({
    nodes: [
      { id: "t", type: "on_receive", config: { asset: { kind: "native" } } },
      {
        id: "p",
        type: "pay",
        config: {
          asset: { kind: "native" },
          recipient: A,
          mode: "fixed",
          fullAmount: false,
          amountStroops: "100",
        },
      },
    ],
    edges: [{ id: "e", source: "t", target: "p" }],
  });
function registry(policy = false) {
  const factoryDeployment = {
    findUnique: vi.fn().mockResolvedValue({ address: factory, wasmHash: "c".repeat(64) }),
  };
  const rows = ["DEPOSIT_TRIGGER", "PAYER"].map((kind) => ({
    kind: kind as TemplateKind,
    wasmHash: policy
      ? EXECUTION_V1_WASM_HASHES[kind as "DEPOSIT_TRIGGER" | "PAYER"]
      : "a".repeat(64),
    abiJson: { functions: ["constructor"] },
  }));
  const contractTemplate = { findMany: vi.fn().mockResolvedValue(rows) };
  return {
    rows,
    factoryDeployment,
    contractTemplate,
    tx: { factoryDeployment, contractTemplate } as unknown as Prisma.TransactionClient,
  };
}
describe("template artifact evidence", () => {
  it("uses canonical deterministic digests for nested values while retaining array order", () => {
    expect(contentHash({ x: 1 })).toBe(createHash("sha256").update('{"x":1}').digest("hex"));
    expect(contentHash({ b: { z: 3, a: 4 }, a: [2, 1] })).toBe(
      contentHash({ a: [2, 1], b: { a: 4, z: 3 } }),
    );
    expect(contentHash([1, 2])).not.toBe(contentHash([2, 1]));
    expect(contentHash({ a: 1 })).not.toBe(contentHash({ a: "1" }));
  });
  it("pins actual compiled nodes and exact registry ABI digests", async () => {
    const r = registry();
    const pins = await pinTemplateArtifacts(graph(), "testnet", r.tx);
    expect(pins.factoryAddress).toBe(factory);
    expect(pins.factoryWasmHash).toBe("c".repeat(64));
    expect(pins.nodes).toEqual([
      {
        nodeId: "t",
        templateKind: "DEPOSIT_TRIGGER",
        wasmHash: "a".repeat(64),
        abiHash: contentHash(r.rows[0]!.abiJson),
        policyVersion: 0,
      },
      {
        nodeId: "p",
        templateKind: "PAYER",
        wasmHash: "a".repeat(64),
        abiHash: contentHash(r.rows[1]!.abiJson),
        policyVersion: 0,
      },
    ]);
    expect(await assertPinnedTemplateArtifacts(graph(), "testnet", pins, r.tx)).toEqual(pins);
  });
  it("refuses another environment, missing registry evidence, unknown policy WASMs and cutovers", async () => {
    const r = registry();
    await expect(pinTemplateArtifacts(graph(), "mainnet", r.tx)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    const pins = await pinTemplateArtifacts(graph(), "testnet", r.tx);
    r.contractTemplate.findMany.mockResolvedValueOnce(r.rows.slice(0, 1));
    await expect(pinTemplateArtifacts(graph(), "testnet", r.tx)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    r.factoryDeployment.findUnique.mockResolvedValueOnce({ address: factory, wasmHash: null });
    await expect(pinTemplateArtifacts(graph(), "testnet", r.tx)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    r.contractTemplate.findMany.mockResolvedValueOnce(
      r.rows.map((row) => ({ ...row, abiJson: { updated: true } })),
    );
    await expect(
      assertPinnedTemplateArtifacts(graph(), "testnet", pins, r.tx),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const g = graph();
    g.fieldPolicies = {
      version: 1,
      nodes: [{ nodeId: "p", kind: "pay", recipient: "constant", payoutValue: "constant" }],
    };
    await expect(pinTemplateArtifacts(g, "testnet", r.tx)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    const reviewed = registry(true);
    expect(
      (await pinTemplateArtifacts(g, "testnet", reviewed.tx)).nodes.every(
        (node) => node.policyVersion === 1,
      ),
    ).toBe(true);
  });
  it("pins scheduled standard implementation kinds rather than visual trigger IDs", async () => {
    const g = graph();
    g.nodes[0] = FlowGraphSchema.parse({
      nodes: [
        {
          id: "t",
          type: "on_schedule",
          config: {
            intervalAmount: 1,
            intervalUnit: "day",
            startsAt: "2035-01-01T00:00:00Z",
            occurrences: 2,
          },
        },
      ],
      edges: [],
    }).nodes[0]!;
    const r = registry();
    r.contractTemplate.findMany.mockResolvedValue([
      { kind: "STREAMER", wasmHash: "d".repeat(64), abiJson: {} },
    ]);
    const pins = await pinTemplateArtifacts(g, "testnet", r.tx);
    expect(pins.nodes).toEqual([
      {
        nodeId: "p",
        templateKind: "STREAMER",
        wasmHash: "d".repeat(64),
        abiHash: contentHash({}),
        policyVersion: 0,
      },
    ]);
  });
});

it("requires new guarded artifacts throughout a mutable template before publishing or preparing", async () => {
  const value = graph();
  value.fieldPolicies = {
    version: 1,
    nodes: [{ kind: "pay", nodeId: "p", recipient: "mutable", payoutValue: "constant" }],
  };
  const old = registry(true);
  await expect(pinTemplateArtifacts(value, "testnet", old.tx)).rejects.toMatchObject({
    code: "CONFLICT",
  });
  const current = registry(true);
  current.rows.forEach((row) => {
    row.wasmHash = MUTATION_V1_WASM_HASHES[row.kind as "DEPOSIT_TRIGGER" | "PAYER"];
  });
  const pins = await pinTemplateArtifacts(value, "testnet", current.tx);
  expect(
    pins.nodes.every((node) =>
      Object.values(MUTATION_V1_WASM_HASHES).some((hash) => hash === node.wasmHash),
    ),
  ).toBe(true);
  await expect(assertPinnedTemplateArtifacts(value, "testnet", pins, old.tx)).rejects.toMatchObject(
    { code: "CONFLICT" },
  );
});
