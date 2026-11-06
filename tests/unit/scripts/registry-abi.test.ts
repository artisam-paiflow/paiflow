import { createHash } from "node:crypto";
import { xdr } from "@stellar/stellar-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
const fs = vi.hoisted(() => ({ readFileSync: vi.fn(), existsSync: vi.fn() }));
const registry = vi.hoisted(() => ({ findUnique: vi.fn(), setWasmHash: vi.fn() }));
vi.mock("node:fs", () => fs);
vi.mock("@/lib/prisma", () => ({ db: { contractTemplate: { findUnique: registry.findUnique } } }));
vi.mock("@/lib/stellar/template-db", () => ({ setWasmHash: registry.setWasmHash }));
import {
  parseAbiRepair,
  readAbiRepair,
  readBuiltWasmAbi,
  inspectOrRepairAbi,
  syncBuiltWasm,
} from "../../../scripts/registry-abi";
import { TemplateKind } from "@prisma/client";

const hash = "a".repeat(64);
const args = ["--abi-kind=SUBSCRIPTION", "--abi-wasm=/tmp/subscription.wasm", `--abi-hash=${hash}`];
beforeEach(() => vi.resetAllMocks());

function artifact() {
  const entry = xdr.ScSpecEntry.scSpecEntryFunctionV0(
    new xdr.ScSpecFunctionV0({ doc: "", name: "charge", inputs: [], outputs: [] }),
  );
  const name = Buffer.from("contractspecv0");
  const payload = Buffer.concat([Buffer.from([name.length]), name, entry.toXDR()]);
  const wasm = Buffer.concat([
    Buffer.from([0, 97, 115, 109, 1, 0, 0, 0, 0, payload.length]),
    payload,
  ]);
  return {
    wasm,
    wasmHash: createHash("sha256").update(wasm).digest("hex"),
    abiJson: { specEntriesXdr: [entry.toXDR("base64")] },
  };
}

describe("scoped registry ABI repair", () => {
  it("keeps default sync separate and defaults repair to inspection", () => {
    expect(parseAbiRepair([])).toBeUndefined();
    expect(parseAbiRepair(args)).toEqual({
      kind: "SUBSCRIPTION",
      wasmPath: "/tmp/subscription.wasm",
      wasmHash: hash,
      apply: false,
    });
    expect(parseAbiRepair([...args, "--apply"])!.apply).toBe(true);
  });

  it.each([
    ["--apply"],
    ["--network=mainnet"],
    args.slice(0, 2),
    [...args, "--abi-kind=PAYER"],
    [...args, "--unknown"],
    [...args, "--apply", "--apply"],
    ["--abi-kind=PAYROLL", ...args.slice(1)],
    ["--abi-kind=UNKNOWN", ...args.slice(1)],
    [...args.slice(0, 2), "--abi-hash=bad"],
  ])("rejects malformed/ambiguous flags without reading any artifact: %j", (...flags) => {
    expect(() => parseAbiRepair(flags)).toThrow();
    expect(fs.readFileSync).not.toHaveBeenCalled();
  });

  it("does not accept a supplied file whose bytes differ from the selected hash", () => {
    fs.readFileSync.mockReturnValue(Buffer.from("wrong-artifact"));
    expect(() => readAbiRepair(parseAbiRepair(args)!)).toThrow("do not match");
  });

  it("requires exact build output for new hash activation", () => {
    fs.existsSync.mockReturnValue(false);
    expect(() => readBuiltWasmAbi(TemplateKind.SUBSCRIPTION, hash)).toThrow("Matching local WASM");
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(Buffer.from("wrong-artifact"));
    expect(() => readBuiltWasmAbi(TemplateKind.SUBSCRIPTION, hash)).toThrow("do not match");
  });

  it("validates inspection without changing any registry metadata", async () => {
    const a = artifact();
    fs.readFileSync.mockReturnValue(a.wasm);
    registry.findUnique.mockResolvedValue({ wasmHash: a.wasmHash, abiJson: {} });
    const repair = { ...parseAbiRepair(args)!, wasmHash: a.wasmHash };
    expect(await inspectOrRepairAbi(repair, "testnet")).toEqual(a.abiJson);
    expect(registry.setWasmHash).not.toHaveBeenCalled();
  });

  it("applies only extracted exact-artifact evidence with an atomic existing-hash expectation", async () => {
    const a = artifact();
    fs.readFileSync.mockReturnValue(a.wasm);
    registry.findUnique.mockResolvedValue({ wasmHash: a.wasmHash, abiJson: {} });
    await inspectOrRepairAbi(
      { ...parseAbiRepair(args)!, wasmHash: a.wasmHash, apply: true },
      "testnet",
    );
    expect(registry.setWasmHash).toHaveBeenCalledExactlyOnceWith(
      "SUBSCRIPTION",
      "testnet",
      a.wasmHash,
      a.abiJson,
      { expectedCurrentHash: a.wasmHash },
    );
  });

  it("does not activate a missing or different registry hash through repair", async () => {
    const a = artifact();
    fs.readFileSync.mockReturnValue(a.wasm);
    registry.findUnique.mockResolvedValue({ wasmHash: hash });
    const repair = { ...parseAbiRepair(args)!, wasmHash: a.wasmHash, apply: true };
    await expect(inspectOrRepairAbi(repair, "testnet")).rejects.toThrow("expected hash");
    registry.findUnique.mockResolvedValue(null);
    await expect(inspectOrRepairAbi(repair, "testnet")).rejects.toThrow("expected hash");
    expect(registry.setWasmHash).not.toHaveBeenCalled();
  });

  it("preserves same-hash metadata without requiring local build output", async () => {
    registry.findUnique.mockResolvedValue({ wasmHash: hash, abiJson: { preserved: true } });
    await syncBuiltWasm(TemplateKind.SUBSCRIPTION, "testnet", hash);
    expect(fs.readFileSync).not.toHaveBeenCalled();
    expect(registry.setWasmHash).toHaveBeenCalledExactlyOnceWith(
      "SUBSCRIPTION",
      "testnet",
      hash,
      undefined,
    );
  });

  it("supplies exact complete ABI for new/changed hash sync and refuses a missing artifact before writing", async () => {
    const a = artifact();
    registry.findUnique.mockResolvedValue({ wasmHash: hash, abiJson: { old: true } });
    fs.existsSync.mockReturnValue(false);
    await expect(syncBuiltWasm(TemplateKind.SUBSCRIPTION, "testnet", a.wasmHash)).rejects.toThrow(
      "Matching local WASM",
    );
    expect(registry.setWasmHash).not.toHaveBeenCalled();
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(a.wasm);
    await syncBuiltWasm(TemplateKind.SUBSCRIPTION, "testnet", a.wasmHash);
    expect(registry.setWasmHash).toHaveBeenCalledExactlyOnceWith(
      "SUBSCRIPTION",
      "testnet",
      a.wasmHash,
      a.abiJson,
    );
  });
});
