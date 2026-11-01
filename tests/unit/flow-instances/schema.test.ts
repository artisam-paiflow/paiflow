import { randomUUID } from "node:crypto";
import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import {
  InstancePrepareSchema,
  InstanceSubmitSchema,
  InstanceReconcileSchema,
  InstanceListQuerySchema,
  InstanceSnapshotSchema,
  InstanceStateSchema,
  InstanceListSchema,
} from "@/lib/flow-instances/schema";
const templateId = randomUUID(),
  versionId = randomUUID(),
  ownerId = randomUUID();
const source = Keypair.random().publicKey();
const bindings = {
  version: 1,
  templateVersionId: versionId,
  values: [{ inputId: "amount", value: { type: "stroops", value: "9007199254740993" } }],
};
const input = { sourceAccount: source, bindings, idempotencyKey: randomUUID() };
describe("instance request/receipt schemas", () => {
  it("accepts realistic exact creation values above floating-point precision", () =>
    expect(InstancePrepareSchema.parse(input)).toEqual(input));
  it.each([
    { ...input, sourceAccount: "invalid" },
    { ...input, ownerId },
    { ...input, network: "mainnet" },
    { ...input, graph: {} },
    { ...input, idempotencyKey: "tiny" },
    { ...input, idempotencyKey: "key with spaces 123456" },
    { ...input, bindings: { ...bindings, values: [...bindings.values, ...bindings.values] } },
    {
      ...input,
      bindings: {
        ...bindings,
        values: [{ inputId: "amount", value: { type: "stroops", value: 1 } }],
      },
    },
    {
      ...input,
      bindings: {
        ...bindings,
        values: [{ inputId: "amount", value: { type: "stroops", value: "01" } }],
      },
    },
    {
      ...input,
      bindings: {
        ...bindings,
        values: [
          {
            inputId: "amount",
            value: { type: "stroops", value: "170141183460469231731687303715884105728" },
          },
        ],
      },
    },
  ])("rejects hostile instance preparation %#", (value) =>
    expect(InstancePrepareSchema.safeParse(value).success).toBe(false),
  );
  it("does not accept signed body overrides or invented reconcile controls", () => {
    expect(InstanceSubmitSchema.parse({ signedXdr: "synthetic-envelope" })).toEqual({
      signedXdr: "synthetic-envelope",
    });
    expect(
      InstanceSubmitSchema.safeParse({ signedXdr: "synthetic-envelope", sourceAccount: source })
        .success,
    ).toBe(false);
    expect(InstanceSubmitSchema.safeParse({ signedXdr: "x".repeat(200001) }).success).toBe(false);
    expect(InstanceReconcileSchema.parse({})).toEqual({});
    expect(InstanceReconcileSchema.safeParse({ retry: true }).success).toBe(false);
  });
  it("bounds cursor pages and refuses unknown query fields", () => {
    expect(InstanceListQuerySchema.parse({})).toEqual({ limit: 20 });
    expect(InstanceListQuerySchema.parse({ limit: "100", cursor: randomUUID() }).limit).toBe(100);
    for (const value of [{ limit: 101 }, { limit: 0 }, { cursor: "wrong" }, { ownerId }])
      expect(InstanceListQuerySchema.safeParse(value).success).toBe(false);
  });
  it("requires complete typed pinned admission evidence", () => {
    const artifacts = {
      version: 1,
      compilerAbi: 1,
      factoryAddress: "C".repeat(56),
      factoryWasmHash: "a".repeat(64),
      nodes: [
        {
          nodeId: "pay",
          templateKind: "PAYER",
          wasmHash: "a".repeat(64),
          abiHash: "b".repeat(64),
          policyVersion: 0,
        },
      ],
    };
    // Invalid StrKeys do not become trusted artifact evidence.
    expect(
      InstanceSnapshotSchema.safeParse({
        version: 1,
        templateId,
        templateVersionId: versionId,
        templateVersion: 1,
        contentHash: "a".repeat(64),
        ownerId,
        sourceAccount: source,
        network: "testnet",
        bindings,
        artifacts,
        maxTime: 2000000000,
      }).success,
    ).toBe(false);
    expect(InstanceSnapshotSchema.safeParse({ version: 1, templateId }).success).toBe(false);
    expect(
      InstanceStateSchema.safeParse({
        deploymentId: randomUUID(),
        templateId,
        templateVersionId: versionId,
      }).success,
    ).toBe(false);
    expect(InstanceListSchema.parse({ items: [], nextCursor: null })).toEqual({
      items: [],
      nextCursor: null,
    });
    expect(InstanceListSchema.safeParse({ items: [], nextCursor: "not-a-cursor" }).success).toBe(
      false,
    );
  });
});
