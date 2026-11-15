import { xdr } from "@stellar/stellar-sdk";
import { createHash } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  conditionalArtifactSet: { findUnique: vi.fn(), upsert: vi.fn() },
  auditLog: { create: vi.fn() },
  $transaction: vi.fn(),
  $executeRaw: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ db: m }));
import {
  getConditionalWasmHashes,
  readConditionalArtifactSet,
  conditionalArtifactSetDigest,
  configureConditionalArtifacts,
} from "@/lib/stellar/conditional-artifact-config";
import { parseConditionalArtifactConfigurationArgs } from "@/lib/stellar/conditional-artifact-config-command";
import { CONDITIONAL_V2_WASM_HASHES as pins } from "@/lib/stellar/conditional-artifacts";
import { setWasmHash } from "@/lib/stellar/template-db";
function row(enabled = true) {
  return {
    network: "testnet",
    version: 2,
    enabled,
    receiveWasmHash: pins.DEPOSIT_TRIGGER,
    payerWasmHash: pins.PAYER,
    splitterWasmHash: pins.SPLITTER,
    routerWasmHash: pins.ROUTER,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  m.conditionalArtifactSet.findUnique.mockResolvedValue(null);
  m.$transaction.mockImplementation(async (callback) => callback(m));
});
it("missing/disabled set returns fresh empty maps and never consults legacy/env fallback", async () => {
  process.env.STELLAR_WASM_HASH_PAYER_TESTNET = pins.PAYER;
  expect(await getConditionalWasmHashes("testnet")).toEqual(new Map());
  m.conditionalArtifactSet.findUnique.mockResolvedValue(row(false));
  const a = await getConditionalWasmHashes("testnet"),
    b = await getConditionalWasmHashes("testnet");
  expect(a).not.toBe(b);
  expect(a.size).toBe(0);
  delete process.env.STELLAR_WASM_HASH_PAYER_TESTNET;
  expect(m.$transaction).not.toHaveBeenCalled();
});
it("validates exact reviewed family pins and network/version, with no mutable shared cache", async () => {
  m.conditionalArtifactSet.findUnique.mockResolvedValue(row());
  const map = await getConditionalWasmHashes("testnet");
  expect(Object.fromEntries(map)).toEqual(pins);
  map.clear();
  expect((await getConditionalWasmHashes("testnet")).size).toBe(4);
  for (const patch of [
    { network: "mainnet" },
    { version: 3 },
    { payerWasmHash: pins.SPLITTER },
    { receiveWasmHash: "a".repeat(64) },
  ]) {
    m.conditionalArtifactSet.findUnique.mockResolvedValue({ ...row(), ...patch });
    await expect(readConditionalArtifactSet("testnet")).rejects.toThrow();
  }
});
it("default dry-run produces strict public plan with zero writes and hash(null) CAS identity", async () => {
  const plan = await configureConditionalArtifacts({ network: "testnet", enabled: true });
  expect(plan.mode).toBe("dry-run");
  expect(plan.currentDigest).toBe(createHash("sha256").update("null").digest("hex"));
  expect(plan.proposed).toEqual({ network: "testnet", version: 2, enabled: true, hashes: pins });
  expect(m.$transaction).not.toHaveBeenCalled();
  expect(m.conditionalArtifactSet.upsert).not.toHaveBeenCalled();
  expect(m.auditLog.create).not.toHaveBeenCalled();
  expect(conditionalArtifactSetDigest(plan.proposed)).toBe(plan.proposedDigest);
});
it("apply requires CAS under absent-row advisory lock and audits only conditional configuration", async () => {
  await expect(
    configureConditionalArtifacts({ network: "testnet", enabled: true }, true),
  ).rejects.toThrow(/expect/);
  expect(m.$transaction).not.toHaveBeenCalled();
  const digest = conditionalArtifactSetDigest(null);
  const result = await configureConditionalArtifacts(
    { network: "testnet", enabled: true, expectedCurrentDigest: digest },
    true,
  );
  expect(result.mode).toBe("applied");
  expect(m.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
    m.conditionalArtifactSet.findUnique.mock.invocationCallOrder[0]!,
  );
  expect(m.conditionalArtifactSet.upsert).toHaveBeenCalledOnce();
  expect(m.auditLog.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ action: "CONDITIONAL_ARTIFACT_CONFIGURATION" }),
    }),
  );
  m.conditionalArtifactSet.findUnique.mockResolvedValue(row());
  m.conditionalArtifactSet.upsert.mockClear();
  m.auditLog.create.mockClear();
  await expect(
    configureConditionalArtifacts(
      { network: "testnet", enabled: false, expectedCurrentDigest: digest },
      true,
    ),
  ).rejects.toThrow(/changed/);
  expect(m.conditionalArtifactSet.upsert).not.toHaveBeenCalled();
  expect(m.auditLog.create).not.toHaveBeenCalled();
});
it("strict operator flags have no network override or implicit apply", () => {
  expect(parseConditionalArtifactConfigurationArgs([])).toEqual({ apply: false, enabled: true });
  expect(parseConditionalArtifactConfigurationArgs(["--disable"])).toEqual({
    apply: false,
    enabled: false,
  });
  expect(
    parseConditionalArtifactConfigurationArgs(["--apply", "--expect", "a".repeat(64)]),
  ).toEqual({ apply: true, enabled: true, expectedCurrentDigest: "a".repeat(64) });
  for (const flags of [
    ["--apply"],
    ["--network=testnet"],
    ["--apply", "--apply"],
    ["--expect"],
    ["--expect", "invalid"],
    ["--disable", "--disable"],
    ["--unknown"],
  ])
    expect(() => parseConditionalArtifactConfigurationArgs(flags)).toThrow();
});
it("legacy writer refuses any known conditional hash case-insensitively before transaction", async () => {
  for (const hash of Object.values(pins)) {
    await expect(
      setWasmHash("PAYER", "testnet", hash.toUpperCase(), { functions: [] }),
    ).rejects.toThrow(/separate conditional/);
  }
  expect(m.$transaction).not.toHaveBeenCalled();
});

it("legacy writer refuses unknown rebuilt conditional spec before transaction", async () => {
  const abi = {
    specEntriesXdr: [
      xdr.ScSpecEntry.scSpecEntryFunctionV0(
        new xdr.ScSpecFunctionV0({ doc: "", name: "execute_v2", inputs: [], outputs: [] }),
      ).toXDR("base64"),
    ],
  };
  await expect(setWasmHash("PAYER", "testnet", "b".repeat(64), abi)).rejects.toThrow(
    "artifact ABI",
  );
  expect(m.$transaction).not.toHaveBeenCalled();
});
