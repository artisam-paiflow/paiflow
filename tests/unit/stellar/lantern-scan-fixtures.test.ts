import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  Account,
  Address,
  hash,
  nativeToScVal,
  Networks,
  scValToNative,
  SorobanDataBuilder,
  StrKey,
  Transaction,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import { format, resolveConfig } from "prettier";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FlowGraphSchema } from "@/lib/flows/schema";
import { flowToPipeline } from "@/lib/flows/to-params";
import { paymentAccountResponse } from "./payment-account-fixture";

const mocks = vi.hoisted(() => ({
  getAccount: vi.fn(),
  entries: vi.fn(),
  simulate: vi.fn(),
  latest: vi.fn(),
  random: vi.fn(),
}));
vi.mock("node:crypto", async (original) => ({
  ...(await original<typeof import("node:crypto")>()),
  randomBytes: mocks.random,
}));
vi.mock("@/lib/stellar/client", () => ({
  sorobanRpc: () => ({
    getAccount: mocks.getAccount,
    _getLedgerEntries: mocks.entries,
    simulateTransaction: mocks.simulate,
    getLatestLedger: mocks.latest,
  }),
  decodeContractAddress: (address: string) => StrKey.decodeContract(address),
  horizon: () => ({}),
}));
vi.mock("@/lib/stellar/config", () => ({
  getFactoryAddress: async () => StrKey.encodeContract(Buffer.alloc(32, 5)),
}));
vi.mock("@/lib/stellar/assets", () => ({
  assetContractId: () => StrKey.encodeContract(Buffer.alloc(32, 4)),
}));
vi.mock("@/lib/deployments/service-work", () => ({ prepareServiceDeployment: vi.fn() }));
vi.mock("@/lib/analytics/outcomes", () => ({
  beginTransactionSubmission: vi.fn(),
  recordTransactionOutcome: vi.fn(),
  transactionObservation: vi.fn(),
}));
vi.mock("@/lib/stellar/relayer-channels", () => ({
  withRelayerChannel: vi.fn(),
  buildRelayerTx: vi.fn(),
}));

import { preparePipelineDeployTx } from "@/lib/stellar/deploy";
import {
  prepareDepositInvocation,
  prepareDistributeInvocation,
  prepareStreamerTopUpInvocation,
  prepareTokenApproveInvocation,
} from "@/lib/stellar/invoke";

const fixturePath = resolve("docs/testing/lantern-scan-fixtures/manifest.json");
const fixedTime = Date.parse("2026-01-01T00:00:00Z");
const source = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 0x11));
const contract = (byte: number) => StrKey.encodeContract(Buffer.alloc(32, byte));
const targets = {
  splitter: contract(1),
  deposit: contract(2),
  streamer: contract(3),
  token: contract(4),
  factory: contract(5),
  spender: contract(6),
};

function jsonValue(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Buffer.isBuffer(value) || value instanceof Uint8Array)
    return { bytesHex: Buffer.from(value).toString("hex") };
  if (Array.isArray(value)) return value.map(jsonValue);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, jsonValue(child)]));
  return value;
}
function parsed(unsignedXdr: string): Transaction {
  const tx = TransactionBuilder.fromXDR(unsignedXdr, Networks.TESTNET);
  if (!(tx instanceof Transaction))
    throw new Error("Expected an ordinary transaction, not fee-bump");
  return tx;
}
function fixture(id: string, unsignedXdr: string, amountStroops: string | null) {
  const tx = parsed(unsignedXdr);
  const operation = tx.operations[0];
  if (operation?.type !== "invokeHostFunction") throw new Error("Expected invokeHostFunction");
  const invocation = operation.func.invokeContract();
  return {
    id,
    unsignedXdr,
    transactionHashTestnet: tx.hash().toString("hex"),
    source: tx.source,
    sequence: tx.sequence,
    feeStroops: tx.fee,
    timeBounds: tx.timeBounds,
    operationType: operation.type,
    hostFunctionType: operation.func.switch().name,
    contractAddress: Address.fromScAddress(invocation.contractAddress()).toString(),
    method: invocation.functionName().toString(),
    amountStroops,
    arguments: invocation.args().map((argument) => jsonValue(scValToNative(argument))),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Date, "now").mockReturnValue(fixedTime);
  vi.stubEnv("STELLAR_NETWORK", "testnet");
  // Deterministic public bytes only. No account keypair is created or used.
  mocks.getAccount.mockImplementation(async (address: string) => new Account(address, "41"));
  mocks.entries.mockResolvedValue(paymentAccountResponse(source, "41"));
  mocks.latest.mockResolvedValue({ sequence: 1000 });
  let salt = 0x20;
  mocks.random.mockImplementation((size: number) => Buffer.alloc(size, salt++));
  mocks.simulate.mockImplementation(async (tx: Transaction) => {
    const operation = tx.operations[0];
    if (operation?.type !== "invokeHostFunction") throw new Error("Unexpected operation");
    const invocation = operation.func.invokeContract();
    return {
      _parsed: true,
      id: "offline-scan-fixture",
      latestLedger: 1000,
      events: [],
      minResourceFee: "1000",
      transactionData: new SorobanDataBuilder()
        .setResourceFee("1000")
        .setResources(100000, 1000, 1000)
        .setReadWrite([
          xdr.LedgerKey.contractData(
            new xdr.LedgerKeyContractData({
              contract: invocation.contractAddress(),
              key: xdr.ScVal.scvLedgerKeyContractInstance(),
              durability: xdr.ContractDataDurability.persistent(),
            }),
          ),
        ]),
      result: {
        retval: nativeToScVal(true),
        auth: [
          new xdr.SorobanAuthorizationEntry({
            credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
            rootInvocation: new xdr.SorobanAuthorizedInvocation({
              function:
                xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(invocation),
              subInvocations: [],
            }),
          }),
        ],
      },
    };
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

// This file is also the reproducible offline generator: vitest -u deliberately
// refreshes the raw JSON file snapshot after builder/ABI changes are reviewed.
it("reproduces five unsigned scan samples through Paiflow's actual preparation builders", async () => {
  const common = { invokerAddress: source, amount: "1000000" };
  const distribute = await prepareDistributeInvocation({
    ...common,
    contractAddress: targets.splitter,
  });
  const deposit = await prepareDepositInvocation({ ...common, contractAddress: targets.deposit });
  const topup = await prepareStreamerTopUpInvocation({
    ...common,
    contractAddress: targets.streamer,
  });
  const approve = await prepareTokenApproveInvocation({
    tokenContractAddress: targets.token,
    from: source,
    spender: targets.spender,
    amount: "10000000",
  });
  const graph = FlowGraphSchema.parse({
    nodes: [
      { id: "receive", type: "on_receive", config: { asset: { kind: "native" } } },
      {
        id: "split",
        type: "split",
        config: {
          asset: { kind: "native" },
          recipients: [
            {
              address: StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 0x22)),
              mode: "fixed",
              amountStroops: "600000",
              label: "Synthetic recipient A",
            },
            {
              address: StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 0x33)),
              mode: "fixed",
              amountStroops: "400000",
              label: "Synthetic recipient B",
            },
          ],
        },
      },
    ],
    edges: [{ id: "receive-split", source: "receive", target: "split" }],
  });
  const nodes = flowToPipeline(graph).map((node, index) => ({
    ...node,
    wasmHash: (index + 1).toString(16).repeat(64),
  }));
  const deploy = await preparePipelineDeployTx({ sourceAccount: source, graph, nodes });
  const manifest = {
    formatVersion: 1,
    purpose: "OFFLINE SCAN FIXTURES ONLY — do not sign or submit",
    network: "testnet",
    networkPassphrase: Networks.TESTNET,
    networkIdSha256: hash(Buffer.from(Networks.TESTNET)).toString("hex"),
    provenance: {
      fixedBuildTime: new Date(fixedTime).toISOString(),
      simulation: "mocked; no live RPC call or successful simulation evidence",
      addresses:
        "All public keys, contract IDs, WASM hashes and salts are synthetic deterministic bytes; no private keys exist in these fixtures",
      authorization:
        "one source-account credential for the top-level invocation; nested token/child authorization is deliberately absent",
      footprint:
        "one synthetic target contract-instance read/write entry; excludes real contract code and child/token storage",
      resources: {
        latestLedger: 1000,
        instructions: 100000,
        diskReadBytes: 1000,
        writeBytes: 1000,
        minResourceFeeStroops: "1000",
      },
      validity:
        "fixed expired time bounds; ledger 1000 and sequence 42 are synthetic; never suitable for submission",
      deploy:
        "invokeContract(factory.deploy_pipeline), not a top-level createContract/upload host function",
    },
    syntheticAddresses: { source, ...targets },
    deployPipeline: deploy.pipeline.map(({ nodeId, contractAddress, templateKind, salt }) => ({
      nodeId,
      contractAddress,
      templateKind,
      saltHex: salt.toString("hex"),
    })),
    fixtures: [
      fixture("splitter-distribute", distribute.xdr, common.amount),
      fixture("deposit", deposit.xdr, common.amount),
      fixture("streamer-top-up", topup.xdr, common.amount),
      fixture("token-approve", approve.xdr, "10000000"),
      fixture("factory-deploy-pipeline", deploy.xdr, null),
    ],
  };
  expect(mocks.simulate).toHaveBeenCalledTimes(5);
  const formatted = await format(JSON.stringify(manifest), {
    ...(await resolveConfig(fixturePath)),
    filepath: fixturePath,
  });
  await expect(formatted).toMatchFileSnapshot(fixturePath);
});

describe("committed offline scan fixture safety and decoded semantics", () => {
  it.each([
    ["splitter-distribute", targets.splitter, "distribute", "1000000"],
    ["deposit", targets.deposit, "deposit", "1000000"],
    ["streamer-top-up", targets.streamer, "top_up", "1000000"],
    ["token-approve", targets.token, "approve", "10000000"],
    ["factory-deploy-pipeline", targets.factory, "deploy_pipeline", null],
  ] as const)(
    "checks %s is unsigned, bounded and matches the advertised invocation",
    (id, target, method, amount) => {
      const manifest = JSON.parse(readFileSync(fixturePath, "utf8")) as {
        networkPassphrase: string;
        networkIdSha256: string;
        fixtures: ReturnType<typeof fixture>[];
      };
      expect(manifest.networkPassphrase).toBe(Networks.TESTNET);
      expect(manifest.networkIdSha256).toBe(hash(Buffer.from(Networks.TESTNET)).toString("hex"));
      const entry = manifest.fixtures.find((candidate) => candidate.id === id)!;
      const tx = parsed(entry.unsignedXdr);
      expect(tx.signatures).toHaveLength(0);
      expect(tx.operations).toHaveLength(1);
      expect(tx.source).toBe(source);
      expect(tx.sequence).toBe("42");
      expect(tx.timeBounds).toEqual({ minTime: "0", maxTime: String(fixedTime / 1000 + 180) });
      expect(tx.hash().toString("hex")).toBe(entry.transactionHashTestnet);
      expect(
        TransactionBuilder.fromXDR(entry.unsignedXdr, Networks.PUBLIC).hash().toString("hex"),
      ).not.toBe(entry.transactionHashTestnet);
      expect(fixture(id, entry.unsignedXdr, amount)).toEqual(entry);
      expect(entry.contractAddress).toBe(target);
      expect(entry.method).toBe(method);
      const operation = tx.operations[0]!;
      if (operation.type !== "invokeHostFunction") throw new Error("Unexpected operation");
      expect(operation.func.switch().name).toBe("hostFunctionTypeInvokeContract");
      expect(operation.auth).toHaveLength(1);
      expect(operation.auth![0]!.credentials().switch().name).toBe(
        "sorobanCredentialsSourceAccount",
      );
      expect(operation.auth![0]!.rootInvocation().function().contractFn().toXDR()).toEqual(
        operation.func.invokeContract().toXDR(),
      );
      expect(entry.arguments[0]).toBe(source);
      if (method === "approve") {
        expect(entry.arguments).toEqual([source, targets.spender, amount, 3111390]);
      } else if (amount !== null) {
        expect(entry.arguments).toEqual([source, amount]);
      } else {
        expect(entry.arguments[1]).toHaveLength(2);
      }
    },
  );
});
