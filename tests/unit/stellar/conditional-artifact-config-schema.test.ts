import { xdr } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { CONDITIONAL_V2_WASM_HASHES } from "@/lib/stellar/conditional-artifacts";
import {
  ConditionalArtifactHashesSchema,
  ConditionalArtifactSetSchema,
  canonicalConditionalArtifactSet,
  assertLegacyArtifactRegistryHash,
} from "@/lib/stellar/conditional-artifact-config-schema";
const set = {
  network: "testnet" as const,
  version: 2 as const,
  enabled: false,
  hashes: { ...CONDITIONAL_V2_WASM_HASHES },
};
describe("conditional-only artifact configuration schema", () => {
  it("accepts exact reviewed families without emitting runtime supported capability", () => {
    const parsed = ConditionalArtifactSetSchema.parse(set);
    expect(parsed).toEqual(set);
    expect(parsed).not.toHaveProperty("supported");
    expect(ConditionalArtifactHashesSchema.parse(set.hashes)).toEqual(CONDITIONAL_V2_WASM_HASHES);
  });
  it.each(["DEPOSIT_TRIGGER", "PAYER", "SPLITTER", "ROUTER"] as const)(
    "rejects substituted, missing, uppercase and wrongly assigned %s pins",
    (kind) => {
      for (const value of [
        "aa".repeat(32),
        undefined,
        set.hashes[kind].toUpperCase(),
        Object.values(set.hashes).find((hash) => hash !== set.hashes[kind]),
      ])
        expect(
          ConditionalArtifactSetSchema.safeParse({
            ...set,
            hashes: { ...set.hashes, [kind]: value },
          }).success,
        ).toBe(false);
    },
  );
  it("does not strip unknown metadata or reinterpret old/future versions and networks", () => {
    for (const changed of [
      { version: 1 },
      { version: 3 },
      { network: "future" },
      { enabled: "true" },
      { factoryAddress: "private" },
      { ownerEmail: "private@example.test" },
    ])
      expect(ConditionalArtifactSetSchema.safeParse({ ...set, ...changed }).success).toBe(false);
    expect(
      ConditionalArtifactSetSchema.safeParse({
        ...set,
        hashes: { ...set.hashes, WEBHOOK: "ab".repeat(32) },
      }).success,
    ).toBe(false);
  });
  it("canonical identities bind network, enablement and the explicit version while ignoring object key insertion order", () => {
    const canonical = canonicalConditionalArtifactSet(set);
    expect(canonical).toBe(
      canonicalConditionalArtifactSet({
        hashes: {
          ROUTER: set.hashes.ROUTER,
          SPLITTER: set.hashes.SPLITTER,
          PAYER: set.hashes.PAYER,
          DEPOSIT_TRIGGER: set.hashes.DEPOSIT_TRIGGER,
        },
        enabled: false,
        version: 2,
        network: "testnet",
      }),
    );
    expect(canonicalConditionalArtifactSet({ ...set, enabled: true })).not.toBe(canonical);
    expect(canonicalConditionalArtifactSet({ ...set, network: "mainnet" })).not.toBe(canonical);
    expect(canonicalConditionalArtifactSet(null)).toBe("null");
  });
  it("prevents every known conditional binary from entering any legacy slot even with uppercase hex", () => {
    for (const hash of Object.values(CONDITIONAL_V2_WASM_HASHES))
      for (const input of [hash, hash.toUpperCase()])
        expect(() => assertLegacyArtifactRegistryHash(input)).toThrow(
          "separate conditional configuration",
        );
    expect(() => assertLegacyArtifactRegistryHash("00".repeat(32))).not.toThrow();
  });
});

it("rejects unpinned conditional build variants by actual spec without granting any capability", () => {
  const abi = (name: string) => ({
    specEntriesXdr: [
      xdr.ScSpecEntry.scSpecEntryFunctionV0(
        new xdr.ScSpecFunctionV0({ doc: "", name, inputs: [], outputs: [] }),
      ).toXDR("base64"),
    ],
  });
  for (const name of [
    "capabilities_v2",
    "graph_manifest_v2",
    "execute_v2",
    "execute_step_v2",
    "mutate_v2",
    "mutate_step_v2",
  ])
    expect(() => assertLegacyArtifactRegistryHash("fe".repeat(32), abi(name))).toThrow(
      "separate conditional configuration",
    );
  expect(() => assertLegacyArtifactRegistryHash("fe".repeat(32), abi("execute_v1"))).not.toThrow();
  expect(() =>
    assertLegacyArtifactRegistryHash("fe".repeat(32), { opaqueRetainedMetadata: true }),
  ).not.toThrow();
});
