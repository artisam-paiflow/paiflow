import { xdr } from "@stellar/stellar-sdk";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  disconnect: vi.fn(),
  write: vi.fn(),
  envWrite: vi.fn(),
  server: vi.fn(),
  signer: vi.fn(),
  sync: vi.fn(),
  abi: vi.fn(),
  payerHash: "58af309f7af9d912b309e078a9db4c8df7cef89cc44a4f49829f74af545d9fd8",
}));
vi.mock("@/lib/prisma", () => ({
  db: { $disconnect: m.disconnect, contractTemplate: { findUnique: vi.fn(async () => null) } },
}));
vi.mock("@/lib/stellar/template-db", () => ({ setWasmHash: m.write, setFactoryAddress: m.write }));
vi.mock("@/lib/stellar/wasm-abi", () => ({ extractWasmAbi: m.abi }));
vi.mock("../../../scripts/env-file", () => ({ writeEnvLocal: m.envWrite }));
vi.mock("../../../scripts/registry-abi", async (original) => ({
  ...(await original<typeof import("../../../scripts/registry-abi")>()),
  applyBuiltWasmPlan: m.sync,
}));
vi.mock("node:fs", async (original) => ({
  ...(await original<typeof import("node:fs")>()),
  existsSync: () => true,
  readdirSync: () => ["paiflow_streamer.wasm", "paiflow_payer.wasm"],
  readFileSync: (path: unknown) =>
    Buffer.from(String(path).includes("payer.wasm") ? "conditional" : "legacy"),
}));
vi.mock("@stellar/stellar-sdk", async (original) => ({
  ...(await original<typeof import("@stellar/stellar-sdk")>()),
  hash: (bytes: Uint8Array) =>
    Buffer.from(
      Buffer.from(bytes).toString() === "conditional" ? m.payerHash : "a".repeat(64),
      "hex",
    ),
  rpc: { Server: m.server },
  Keypair: { fromSecret: m.signer },
}));
import { CONDITIONAL_V2_WASM_HASHES } from "@/lib/stellar/conditional-artifacts";
let argv: string[];
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  m.payerHash = CONDITIONAL_V2_WASM_HASHES.PAYER;
  m.abi.mockImplementation(() => ({ specEntriesXdr: [] }));
  argv = process.argv;
  process.argv = ["node", "operator-script"]; // Prevent the mocked operator entrypoint from terminating the unit-test process.
  vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  process.exitCode = 0;
});
afterEach(() => {
  process.argv = argv;
  delete process.env.UPLOADER_SECRET;
  delete process.env.STELLAR_WASM_HASH_SPLITTER_TESTNET;
  delete process.env.STELLAR_WASM_HASH_PAYER_TESTNET;
  delete process.env.STELLAR_WASM_HASH_STREAMER_TESTNET;
  process.exitCode = 0;
  vi.restoreAllMocks();
});
it("legacy uploader checks all files before network/signer/registry/env writes", async () => {
  process.env.UPLOADER_SECRET = "synthetic-not-a-secret";
  await import("../../../scripts/upload-wasm");
  await vi.waitFor(() => expect(m.disconnect).toHaveBeenCalled());
  expect(m.server).not.toHaveBeenCalled();
  expect(m.signer).not.toHaveBeenCalled();
  expect(m.write).not.toHaveBeenCalled();
  expect(m.envWrite).not.toHaveBeenCalled();
  expect(String(vi.mocked(console.error).mock.calls[0]![0])).toContain("separate conditional");
});
it("legacy sync checks every proposed hash before syncing even earlier legacy rows", async () => {
  process.env.STELLAR_WASM_HASH_SPLITTER_TESTNET = "a".repeat(64);
  process.env.STELLAR_WASM_HASH_PAYER_TESTNET = CONDITIONAL_V2_WASM_HASHES.PAYER.toUpperCase();
  await import("../../../scripts/update-hashes");
  await vi.waitFor(() => expect(m.disconnect).toHaveBeenCalled());
  expect(m.sync).not.toHaveBeenCalled();
  expect(m.write).not.toHaveBeenCalled();
  expect(String(vi.mocked(console.error).mock.calls[0]![0])).toContain("separate conditional");
});

function methodAbi(name: string) {
  return {
    specEntriesXdr: [
      xdr.ScSpecEntry.scSpecEntryFunctionV0(
        new xdr.ScSpecFunctionV0({ doc: "", name, inputs: [], outputs: [] }),
      ).toXDR("base64"),
    ],
  };
}
it("unknown fresh conditional ABI after an earlier legacy file refuses all upload side effects", async () => {
  m.payerHash = "b".repeat(64);
  m.abi.mockImplementation((bytes: Uint8Array) =>
    methodAbi(Buffer.from(bytes).toString() === "conditional" ? "execute_v2" : "execute_v1"),
  );
  process.env.UPLOADER_SECRET = "synthetic-not-a-secret";
  await import("../../../scripts/upload-wasm");
  await vi.waitFor(() => expect(m.disconnect).toHaveBeenCalled());
  expect(m.abi).toHaveBeenCalledTimes(2);
  expect(m.server).not.toHaveBeenCalled();
  expect(m.signer).not.toHaveBeenCalled();
  expect(m.write).not.toHaveBeenCalled();
  expect(m.envWrite).not.toHaveBeenCalled();
  expect(String(vi.mocked(console.error).mock.calls[0]![0])).toContain("artifact ABI");
});
it("unknown fresh conditional ABI in a later sync plan refuses earlier legacy row writes", async () => {
  process.env.STELLAR_WASM_HASH_SPLITTER_TESTNET = "a".repeat(64);
  process.env.STELLAR_WASM_HASH_PAYER_TESTNET = "b".repeat(64);
  m.abi.mockImplementation((bytes: Uint8Array) =>
    methodAbi(Buffer.from(bytes).toString() === "conditional" ? "mutate_v2" : "execute_v1"),
  );
  await import("../../../scripts/update-hashes");
  await vi.waitFor(() => expect(m.disconnect).toHaveBeenCalled());
  expect(m.abi).toHaveBeenCalledTimes(2);
  expect(m.sync).not.toHaveBeenCalled();
  expect(m.write).not.toHaveBeenCalled();
  expect(m.envWrite).not.toHaveBeenCalled();
  expect(String(vi.mocked(console.error).mock.calls[0]![0])).toContain("artifact ABI");
});
it("valid v1 ABI plans still synchronize after complete preflight", async () => {
  process.env.STELLAR_WASM_HASH_SPLITTER_TESTNET = "a".repeat(64);
  process.env.STELLAR_WASM_HASH_PAYER_TESTNET = "b".repeat(64);
  m.abi.mockImplementation(() => methodAbi("execute_v1"));
  m.sync.mockImplementation(async () => {
    expect(m.abi).toHaveBeenCalledTimes(2);
  });
  await import("../../../scripts/update-hashes");
  await vi.waitFor(() => expect(m.disconnect).toHaveBeenCalled());
  expect(m.sync).toHaveBeenCalledTimes(2);
  expect(vi.mocked(console.error)).not.toHaveBeenCalled();
});

it("valid unchanged v1 uploads inspect all ABI before constructing network clients and preserve slots", async () => {
  m.payerHash = "b".repeat(64);
  m.abi.mockImplementation(() => methodAbi("execute_v1"));
  process.env.UPLOADER_SECRET = "synthetic-not-a-secret";
  process.env.STELLAR_WASM_HASH_STREAMER_TESTNET = "a".repeat(64);
  process.env.STELLAR_WASM_HASH_PAYER_TESTNET = "b".repeat(64);
  m.server.mockImplementation(function () {
    expect(m.abi).toHaveBeenCalledTimes(2);
    return {};
  });
  m.signer.mockReturnValue({});
  await import("../../../scripts/upload-wasm");
  await vi.waitFor(() => expect(m.disconnect).toHaveBeenCalled());
  expect(m.server).toHaveBeenCalledOnce();
  expect(m.abi).toHaveBeenCalledTimes(2);
  expect(m.write).not.toHaveBeenCalled();
  expect(m.envWrite).not.toHaveBeenCalled();
  expect(vi.mocked(console.error)).not.toHaveBeenCalled();
});
