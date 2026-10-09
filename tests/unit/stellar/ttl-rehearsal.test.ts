import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  Account,
  Address,
  Asset,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";

const { reserve, rpcServer, build, withChannel, measure, trackPending, clearPending } = vi.hoisted(
  () => ({
    reserve: vi.fn(),
    build: vi.fn(),
    withChannel: vi.fn(),
    measure: vi.fn(),
    trackPending: vi.fn(),
    clearPending: vi.fn(),
    rpcServer: { sendTransaction: vi.fn(), getTransaction: vi.fn(), getLedgerEntries: vi.fn() },
  }),
);
vi.mock("@/lib/stellar/fee-budget", async (original) => ({
  ...(await original<typeof import("@/lib/stellar/fee-budget")>()),
  reserveTransactionFee: reserve,
}));
vi.mock("@/lib/stellar/client", () => ({ sorobanRpc: () => rpcServer }));
vi.mock("@/lib/stellar/relayer-channels", () => ({
  buildRelayerTx: build,
  withRelayerChannel: withChannel,
}));
vi.mock("@/lib/stellar/ttl-fee-measurements", () => ({
  measureSorobanTransactionFee: measure,
}));

const signer = Keypair.random();
const recipient = Keypair.random().publicKey();
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  Object.assign(process.env, {
    RAILWAY_ENVIRONMENT_NAME: "hackathon-testing",
    STELLAR_TTL_MAX_FEE_STROOPS: "500000000",
    STELLAR_TTL_FEE_BUDGET_NAME: "ttl804-testnet-20261004",
    STELLAR_TTL_FEE_BUDGET_STROOPS: "1500000000",
  });
  reserve.mockResolvedValue(undefined);
  measure.mockResolvedValue({ netFeeStroops: "100" });
  build.mockResolvedValue(transaction());
  withChannel.mockImplementation(async (fn) =>
    fn({ publicKey: signer.publicKey(), trackPending, clearPending }),
  );
  rpcServer.sendTransaction.mockResolvedValue({ status: "PENDING" });
  rpcServer.getTransaction.mockResolvedValue({
    status: "SUCCESS",
    ledger: 42,
    resultXdr: { feeCharged: () => ({ toString: () => "100" }) },
  });
});
afterEach(() => {
  for (const key of [
    "RAILWAY_ENVIRONMENT_NAME",
    "STELLAR_TTL_MAX_FEE_STROOPS",
    "STELLAR_TTL_FEE_BUDGET_NAME",
    "STELLAR_TTL_FEE_BUDGET_STROOPS",
    "STELLAR_TTL_MAINTENANCE_ENABLED",
    "STELLAR_NETWORK",
  ])
    delete process.env[key];
  vi.restoreAllMocks();
});
const transaction = (fee = "100", networkPassphrase = Networks.TESTNET) =>
  new TransactionBuilder(new Account(signer.publicKey(), "1"), { fee, networkPassphrase })
    .addOperation(Operation.payment({ destination: recipient, amount: "1", asset: Asset.native() }))
    .setTimeout(180)
    .build();
// Classic operation exercises the submission guard without depending on RPC simulation.

it("reads the fixture payer's exact string balance and sequence", async () => {
  const { readTtlFixtureAccount } = await import("@/lib/stellar/ttl-rehearsal");
  rpcServer.getLedgerEntries.mockImplementation(async (key) => ({
    latestLedger: 42,
    entries: [
      {
        key,
        val: {
          account: () => ({
            balance: () => ({ toString: () => "9007199254740993" }),
            seqNum: () => ({ toString: () => "12345678901234567" }),
          }),
        },
      },
    ],
  }));
  expect(await readTtlFixtureAccount(signer.publicKey())).toEqual({
    address: signer.publicKey(),
    latestLedger: 42,
    balanceStroops: "9007199254740993",
    sequence: "12345678901234567",
  });
});
it("refuses a missing fixture payer or invalid address", async () => {
  const { readTtlFixtureAccount } = await import("@/lib/stellar/ttl-rehearsal");
  rpcServer.getLedgerEntries.mockResolvedValue({ latestLedger: 42, entries: [] });
  await expect(readTtlFixtureAccount(signer.publicKey())).rejects.toThrow("unavailable");
  rpcServer.getLedgerEntries.mockClear();
  await expect(readTtlFixtureAccount("bad")).rejects.toThrow();
  expect(rpcServer.getLedgerEntries).not.toHaveBeenCalled();
});

it("prepares an immutable, exact 100% native Webhook-to-Pay graph", async () => {
  const { ttlRehearsalGraph } = await import("@/lib/stellar/ttl-rehearsal");
  const { flowToPipeline } = await import("@/lib/flows/to-params");
  const graph = ttlRehearsalGraph(recipient, signer.publicKey());
  expect(graph.devMode).not.toBe(true);
  const nodes = flowToPipeline(graph, signer.publicKey());
  expect(nodes.map((n) => n.templateKind)).toEqual(["WEBHOOK", "PAYER"]);
  expect(nodes[1]?.params).toMatchObject({ recipient, percentageBps: 10000 });
  expect(() => ttlRehearsalGraph("bad", signer.publicKey())).toThrow();
  expect(() => ttlRehearsalGraph(recipient, signer.secret())).toThrow();
});

it("validates a public recovery manifest and rejects duplicate/wrong contract bindings", async () => {
  const { TtlRecoveryFixtureSchema, TTL_REHEARSAL } = await import("@/lib/stellar/ttl-rehearsal");
  const { Address } = await import("@stellar/stellar-sdk");
  const webhook = Address.contract(Buffer.alloc(32, 1)).toString();
  const pay = Address.contract(Buffer.alloc(32, 2)).toString();
  const manifest = {
    environment: "hackathon-testing",
    network: "TESTNET",
    phase: "awaiting-natural-expiry",
    budget: TTL_REHEARSAL.budget,
    admin: signer.publicKey(),
    recipient,
    relayer: signer.publicKey(),
    registeredForMaintenance: false,
    pipeline: [
      { nodeId: "webhook", templateKind: "WEBHOOK", contractAddress: webhook },
      { nodeId: "pay", templateKind: "PAYER", contractAddress: pay },
    ],
    instances: [
      { address: webhook, valueSha256: "ab".repeat(32), wasmHash: TTL_REHEARSAL.wasm.WEBHOOK },
      { address: pay, valueSha256: "cd".repeat(32), wasmHash: TTL_REHEARSAL.wasm.PAYER },
    ],
  };
  expect(TtlRecoveryFixtureSchema.safeParse(manifest).success).toBe(true);
  for (const value of [
    null,
    {},
    { ...manifest, network: "MAINNET" },
    { ...manifest, phase: "preparing" },
    { ...manifest, registeredForMaintenance: true },
    { ...manifest, instances: [] },
    { ...manifest, pipeline: [manifest.pipeline[0], manifest.pipeline[0]] },
    {
      ...manifest,
      instances: [{ ...manifest.instances[0], wasmHash: "ab".repeat(32) }, manifest.instances[1]],
    },
  ]) {
    expect(TtlRecoveryFixtureSchema.safeParse(value).success).toBe(false);
  }
});
it.each([
  { STELLAR_NETWORK: "mainnet" },
  { RAILWAY_ENVIRONMENT_NAME: "staging" },
  { STELLAR_TTL_FEE_BUDGET_STROOPS: "1600000000" },
  { STELLAR_TTL_MAINTENANCE_ENABLED: "true" },
])("refuses unauthorized environment/configuration %j", async (values) => {
  Object.assign(process.env, values);
  const { assertTtlRehearsalEnvironment } = await import("@/lib/stellar/ttl-rehearsal");
  expect(assertTtlRehearsalEnvironment).toThrow();
});
it("records durable commitment and public hash before signing/submitting", async () => {
  const { submitTtlFixtureTransaction } = await import("@/lib/stellar/ttl-rehearsal");
  const save = vi.fn().mockResolvedValue(undefined);
  const sign = vi.spyOn(signer, "sign");
  await submitTtlFixtureTransaction(transaction(), signer, "fixture-setup", save);
  expect(reserve.mock.invocationCallOrder[0]).toBeLessThan(save.mock.invocationCallOrder[0]!);
  expect(save.mock.invocationCallOrder[0]).toBeLessThan(sign.mock.invocationCallOrder[0]!);
  expect(sign.mock.invocationCallOrder[0]).toBeLessThan(
    rpcServer.sendTransaction.mock.invocationCallOrder[0]!,
  );
});
it.each(["budget", "manifest"])("does not sign/send on %s persistence failure", async (failure) => {
  const { submitTtlFixtureTransaction } = await import("@/lib/stellar/ttl-rehearsal");
  const sign = vi.spyOn(signer, "sign");
  const save = vi.fn().mockResolvedValue(undefined);
  if (failure === "budget") reserve.mockRejectedValueOnce(new Error("offline"));
  else save.mockRejectedValueOnce(new Error("disk"));
  await expect(
    submitTtlFixtureTransaction(transaction(), signer, "fixture-setup", save),
  ).rejects.toThrow();
  expect(sign).not.toHaveBeenCalled();
  expect(rpcServer.sendTransaction).not.toHaveBeenCalled();
});
it("refuses a fee above approval or wrong transaction network before reservation", async () => {
  const { submitTtlFixtureTransaction } = await import("@/lib/stellar/ttl-rehearsal");
  await expect(
    submitTtlFixtureTransaction(transaction("500000001"), signer, "fixture-setup", vi.fn()),
  ).rejects.toThrow();
  await expect(
    submitTtlFixtureTransaction(
      transaction("100", Networks.PUBLIC),
      signer,
      "fixture-setup",
      vi.fn(),
    ),
  ).rejects.toThrow();
  expect(reserve).not.toHaveBeenCalled();
});
it("retains commitment and never retries an uncertain submission", async () => {
  rpcServer.sendTransaction.mockRejectedValueOnce(new Error("unknown"));
  const { submitTtlFixtureTransaction } = await import("@/lib/stellar/ttl-rehearsal");
  await expect(
    submitTtlFixtureTransaction(transaction(), signer, "fixture-setup", vi.fn()),
  ).rejects.toThrow();
  expect(reserve).toHaveBeenCalledOnce();
  expect(rpcServer.sendTransaction).toHaveBeenCalledOnce();
});

it("journals escrow finality before fee measurement can fail", async () => {
  measure.mockRejectedValueOnce(new Error("fee metadata unavailable"));
  const { submitTtlFixtureEscrow } = await import("@/lib/stellar/ttl-rehearsal");
  const observer = { beforeSend: vi.fn(), onFinality: vi.fn() };
  await expect(
    submitTtlFixtureEscrow(Address.contract(Buffer.alloc(32, 1)).toString(), observer),
  ).rejects.toThrow("fee metadata");
  expect(observer.onFinality).toHaveBeenCalledWith(
    expect.objectContaining({
      status: "SUCCESS",
      netFeeStroops: "100",
      purpose: "fixture-payment",
    }),
  );
  expect(observer.onFinality.mock.invocationCallOrder[0]).toBeLessThan(
    measure.mock.invocationCallOrder[0]!,
  );
  expect(reserve.mock.invocationCallOrder[0]).toBeLessThan(
    observer.beforeSend.mock.invocationCallOrder[0]!,
  );
  expect(observer.beforeSend.mock.invocationCallOrder[0]).toBeLessThan(
    rpcServer.sendTransaction.mock.invocationCallOrder[0]!,
  );
  expect(rpcServer.sendTransaction).toHaveBeenCalledOnce();
});
it("forwards separate restoration reservation and finality to the fixture journal", async () => {
  build.mockImplementationOnce(async (opts) => {
    const row = { hash: "cd".repeat(32), payer: signer.publicKey(), declaredFeeStroops: "120" };
    await opts.restorationObserver.beforeSend(row);
    await opts.restorationObserver.onFinality({
      ...row,
      status: "SUCCESS",
      netFeeStroops: "100",
      ledger: 41,
    });
    return transaction();
  });
  const { submitTtlFixtureEscrow } = await import("@/lib/stellar/ttl-rehearsal");
  const observer = { beforeSend: vi.fn(), onFinality: vi.fn() };
  await submitTtlFixtureEscrow(Address.contract(Buffer.alloc(32, 1)).toString(), observer);
  expect(observer.beforeSend.mock.calls.map(([row]) => row.purpose)).toEqual([
    "ttl-restoration",
    "fixture-payment",
  ]);
  expect(observer.onFinality.mock.calls.map(([row]) => row.purpose)).toEqual([
    "ttl-restoration",
    "fixture-payment",
  ]);
});
it("does not send escrow when public journal persistence fails", async () => {
  const { submitTtlFixtureEscrow } = await import("@/lib/stellar/ttl-rehearsal");
  const observer = {
    beforeSend: vi.fn().mockRejectedValue(new Error("disk unavailable")),
    onFinality: vi.fn(),
  };
  await expect(
    submitTtlFixtureEscrow(Address.contract(Buffer.alloc(32, 1)).toString(), observer),
  ).rejects.toThrow("disk unavailable");
  expect(reserve).toHaveBeenCalledOnce();
  expect(rpcServer.sendTransaction).not.toHaveBeenCalled();
});
