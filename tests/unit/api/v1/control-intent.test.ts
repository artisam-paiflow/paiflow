import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  Account,
  Address,
  Asset,
  BASE_FEE,
  Contract,
  Keypair,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
  xdr,
} from "@stellar/stellar-sdk";
import type { Deployment, WalletControlIntent } from "@prisma/client";
const mocks = vi.hoisted(() => ({
  find: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  lock: vi.fn(),
  beforeSend: vi.fn(),
  observe: vi.fn(),
  rpc: vi.fn(),
  send: vi.fn(),
  expired: vi.fn(),
  signed: vi.fn(),
  audit: vi.fn(),
  begin: vi.fn(),
  outcome: vi.fn(),
  status: vi.fn(),
  invalidation: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  db: {
    $transaction: async (fn: (client: unknown) => Promise<unknown>) =>
      fn({
        walletControlIntent: {
          findFirst: mocks.find,
          create: mocks.create,
          updateMany: mocks.update,
        },
        auditLog: { create: mocks.audit },
      }),
    walletControlIntent: { findFirst: mocks.find, updateMany: mocks.update },
  },
}));
vi.mock("@/lib/deployments/service-work", () => ({
  lockDeployment: mocks.lock,
  beforeServiceSubmission: mocks.beforeSend,
  observeServiceTransaction: mocks.observe,
  withDeploymentWork: async (_id: string, _kind: string, fn: () => Promise<unknown>) => fn(),
}));
vi.mock("@/lib/stellar/client", () => ({
  sorobanRpc: () => ({ getTransaction: mocks.rpc, sendTransaction: mocks.send }),
}));
vi.mock("@/lib/stellar/allowance-status", () => ({ allowanceHasExpired: mocks.expired }));
vi.mock("@/lib/stellar/dashboard-balance-cache", () => ({
  invalidateDashboardBalances: mocks.invalidation,
}));
vi.mock("@/lib/signed-tx", async (original) => ({
  ...(await original<typeof import("@/lib/signed-tx")>()),
  insertSignedTransaction: mocks.signed,
}));
vi.mock("@/lib/analytics/outcomes", () => ({
  beginTransactionSubmission: mocks.begin,
  recordTransactionOutcome: mocks.outcome,
}));
vi.mock("@/lib/api/v1/transaction-status", () => ({ getTransactionStatus: mocks.status }));
import {
  assertControlTransaction,
  createControlIntent,
  readControlIntent,
  reconcileControlIntent,
  verifyControlTransaction,
  WalletControlSubmitSchema,
} from "@/lib/api/v1/control-intent";
import { submitControlIntent } from "@/lib/api/v1/control-submission";
const expiry = Math.floor(Date.now() / 1000) + 180;
const wallet = Keypair.random();
const other = Keypair.random();
const contract = StrKey.encodeContract(Buffer.alloc(32, 1));
const deploymentId = "11111111-1111-4111-8111-111111111111";
const intentId = "22222222-2222-4222-8222-222222222222";
function build(
  opts: {
    method?: string;
    source?: string;
    network?: string;
    extra?: boolean;
    sequence?: string;
    amount?: string;
    funding?: boolean;
  } = {},
) {
  const builder = new TransactionBuilder(
    new Account(opts.source ?? wallet.publicKey(), opts.sequence ?? "10"),
    {
      fee: BASE_FEE,
      networkPassphrase: opts.network ?? Networks.TESTNET,
    },
  ).addOperation(
    new Contract(contract).call(
      opts.method ?? "unsubscribe",
      ...(opts.funding
        ? [
            new Address(wallet.publicKey()).toScVal(),
            nativeToScVal(BigInt(opts.amount ?? "100"), { type: "i128" }),
          ]
        : []),
    ),
  );
  if (opts.extra)
    builder.addOperation(
      Operation.payment({ destination: other.publicKey(), asset: Asset.native(), amount: "1" }),
    );
  return builder.setTimebounds(0, expiry).build();
}
function binding(tx = build(), action = "subscription.cancel") {
  return {
    id: intentId,
    deploymentId,
    nodeId: "head",
    contractAddress: contract,
    walletAddress: wallet.publicKey(),
    network: "testnet",
    action,
    txHash: tx.hash().toString("hex"),
    maxTime: tx.timeBounds!.maxTime,
    preparationLedger: 90,
    state: "PREPARED",
    ledger: null,
  } as WalletControlIntent;
}
const deployment = {
  id: deploymentId,
  network: "testnet",
  status: "CONFIRMED",
  ownerId: deploymentId,
  pipelineSnapshot: [
    { nodeId: "head", templateKind: "SUBSCRIPTION", contractAddress: contract },
    { nodeId: "schedule", templateKind: "STREAMER", contractAddress: contract },
  ],
} as unknown as Deployment;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.lock.mockResolvedValue({ serviceState: "ACTIVE" });
  mocks.find.mockResolvedValue(null);
  mocks.create.mockImplementation(async ({ data }) => ({ ...data, id: intentId }));
  mocks.update.mockResolvedValue({ count: 1 });
  mocks.rpc.mockResolvedValue({ status: "NOT_FOUND" });
  mocks.send.mockResolvedValue({ status: "PENDING" });
  mocks.begin.mockResolvedValue(1);
  mocks.status.mockResolvedValue({ txHash: "known", network: "testnet", status: "UNKNOWN" });
});
describe("wallet-control exact binding", () => {
  it.each([
    ["subscription.cancel", "unsubscribe"],
    ["subscription.reactivate", "subscribe"],
    ["schedule.pause", "pause"],
    ["schedule.resume", "unpause"],
    ["schedule.retrieve", "retrieve_unvested"],
  ])(
    "accepts representative %s envelopes only with the source wallet signature",
    (action, method) => {
      const tx = build({ method });
      const record = binding(tx, action);
      expect(() => verifyControlTransaction(record, tx.toXDR())).toThrow(/signed by/);
      tx.sign(wallet);
      expect(verifyControlTransaction(record, tx.toXDR()).signer.signedBySource).toBe(true);
    },
  );
  it.each([
    { sequence: "11" },
    { source: other.publicKey() },
    { method: "subscribe" },
    { extra: true },
    { network: Networks.PUBLIC },
  ])("rejects altered transaction content before sending: %j", (change) => {
    const record = binding();
    const altered = build(change);
    altered.sign(wallet);
    expect(() => verifyControlTransaction(record, altered.toXDR())).toThrow();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("rejects a different wallet signature and unsupported fee-bump envelopes", () => {
    const tx = build();
    const record = binding(tx);
    tx.sign(other);
    expect(() => verifyControlTransaction(record, tx.toXDR())).toThrow(/signed by/);
    const feeBump = TransactionBuilder.buildFeeBumpTransaction(
      other.publicKey(),
      BASE_FEE,
      tx,
      Networks.TESTNET,
    );
    feeBump.sign(other);
    expect(() => verifyControlTransaction(record, feeBump.toXDR())).toThrow(/fee-bump/);
  });
  it("binds the configured network independently of hash matching", () => {
    const tx = build();
    const record = { ...binding(tx), network: "mainnet" };
    tx.sign(wallet);
    expect(() => verifyControlTransaction(record, tx.toXDR())).toThrow(/does not match/);
  });
  it.each([
    ["schedule.fund", "top_up"],
    ["webhook.fund", "deposit"],
  ])("limits %s to a positive amount from the consenting wallet", (action, method) => {
    const tx = build({ method, funding: true });
    tx.sign(wallet);
    expect(verifyControlTransaction(binding(tx, action), tx.toXDR()).signer.signedBySource).toBe(
      true,
    );
    const zero = build({ method, funding: true, amount: "0" });
    expect(() => assertControlTransaction(zero, binding(zero, action))).toThrow(/does not match/);
  });
  it.each([
    ["schedule.fund", "top_up"],
    ["webhook.fund", "deposit"],
  ])(
    "rejects %s funding amount, source, unrelated operation and signer changes",
    (action, method) => {
      const original = build({ method, funding: true, amount: "100" });
      const receipt = binding(original, action);
      for (const tx of [
        build({ method, funding: true, amount: "101" }),
        build({ method, funding: true, source: other.publicKey() }),
        build({ method, funding: true, extra: true }),
      ]) {
        tx.sign(wallet);
        expect(() => verifyControlTransaction(receipt, tx.toXDR())).toThrow();
      }
      original.sign(other);
      expect(() => verifyControlTransaction(receipt, original.toXDR())).toThrow();
    },
  );
  it("binds Soroban authorization contents and rejects unsupported address credentials", () => {
    const original = build();
    const operation = original.operations[0]!;
    if (operation.type !== "invokeHostFunction") throw new Error("fixture shape");
    const rootInvocation = new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        operation.func.invokeContract(),
      ),
      subInvocations: [],
    });
    const withAuth = (credentials: xdr.SorobanCredentials) =>
      new TransactionBuilder(new Account(wallet.publicKey(), "10"), {
        fee: BASE_FEE,
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(
          Operation.invokeHostFunction({
            func: operation.func,
            auth: [new xdr.SorobanAuthorizationEntry({ credentials, rootInvocation })],
          }),
        )
        .setTimebounds(0, expiry)
        .build();
    const sourceAuth = withAuth(xdr.SorobanCredentials.sorobanCredentialsSourceAccount());
    sourceAuth.sign(wallet);
    expect(
      verifyControlTransaction(binding(sourceAuth), sourceAuth.toXDR()).signer.signedBySource,
    ).toBe(true);
    expect(() => verifyControlTransaction(binding(original), sourceAuth.toXDR())).toThrow(
      /does not match/,
    );
    const addressAuth = withAuth(
      xdr.SorobanCredentials.sorobanCredentialsAddress(
        new xdr.SorobanAddressCredentials({
          address: new Address(wallet.publicKey()).toScAddress(),
          nonce: xdr.Int64.fromString("1"),
          signatureExpirationLedger: 100,
          signature: xdr.ScVal.scvVoid(),
        }),
      ),
    );
    addressAuth.sign(wallet);
    expect(() => verifyControlTransaction(binding(addressAuth), addressAuth.toXDR())).toThrow(
      /does not match/,
    );
  });
  it("rejects malformed submit bodies and extra fields", () => {
    expect(WalletControlSubmitSchema.safeParse({ intent: "bad", signedXdr: "x" }).success).toBe(
      false,
    );
    expect(
      WalletControlSubmitSchema.safeParse({ intent: intentId, signedXdr: "x", network: "mainnet" })
        .success,
    ).toBe(false);
  });
  it("rejects cross-deployment and cross-action intent lookup", async () => {
    await expect(readControlIntent(intentId, deploymentId, "schedule.pause")).rejects.toThrow(
      /not found/,
    );
    expect(mocks.find).toHaveBeenCalledWith({
      where: { id: intentId, deploymentId, network: "testnet", action: "schedule.pause" },
    });
  });
});
describe("durable wallet-control preparation", () => {
  const prepare = () =>
    createControlIntent({
      deployment,
      nodeId: "head",
      action: "subscription.cancel",
      walletAddress: wallet.publicKey(),
      unsignedXdr: build().toXDR(),
      preparationLedger: 90,
    });
  it("resolves the selected deployed node and persists exact binding under admission lock", async () => {
    const result = await prepare();
    expect(result.intent).toBe(intentId);
    expect(mocks.create.mock.calls[0]![0].data).toMatchObject({
      contractAddress: contract,
      nodeId: "head",
      network: "testnet",
      preparationLedger: 90,
    });
    expect(mocks.lock.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.create.mock.invocationCallOrder[0]!,
    );
  });
  it("blocks another action on an unresolved node, including expired wall-clock intents", async () => {
    mocks.find.mockResolvedValue({ ...binding(), maxTime: "1", state: "SUBMITTING" });
    await expect(prepare()).rejects.toThrow(/finality reconciliation/);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it.each(["RETIRING", "RETIRED"])(
    "rejects %s admission before recording preparation",
    async (serviceState) => {
      mocks.lock.mockResolvedValue({ serviceState });
      await expect(prepare()).rejects.toThrow(/closed/);
      expect(mocks.create).not.toHaveBeenCalled();
    },
  );
  it("rejects an unsigned transaction aimed at a different action's node", async () => {
    await expect(
      createControlIntent({
        deployment,
        nodeId: "schedule",
        action: "subscription.cancel",
        walletAddress: wallet.publicKey(),
        unsignedXdr: build().toXDR(),
        preparationLedger: 90,
      }),
    ).rejects.toThrow(/unsupported/);
  });
});
describe("single claimed submission and recovery", () => {
  function submit(tx = build()) {
    tx.sign(wallet);
    return submitControlIntent({
      deployment,
      tokenId: deploymentId,
      action: "subscription.cancel",
      intent: intentId,
      signedXdr: tx.toXDR(),
      ip: "127.0.0.1",
      assertEligible: async () => undefined,
    });
  }
  it("records signature/audit and admitted hash before sending bytes", async () => {
    const tx = build();
    mocks.find.mockResolvedValue(binding(tx));
    expect((await submit(tx)).status).toBe("PENDING");
    for (const prerequisite of [mocks.signed, mocks.audit, mocks.beforeSend, mocks.begin])
      expect(prerequisite.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.send.mock.invocationCallOrder[0]!,
      );
  });
  it("a durable persistence failure stops submission", async () => {
    const tx = build();
    mocks.find.mockResolvedValue(binding(tx));
    mocks.beforeSend.mockRejectedValue(new Error("DB unavailable"));
    await expect(submit(tx)).rejects.toThrow(/DB unavailable/);
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("concurrent callers reserve at most one send and losers use existing status", async () => {
    const tx = build();
    mocks.find.mockResolvedValue(binding(tx));
    let claimed = false;
    mocks.update.mockImplementation(async () => {
      if (claimed) return { count: 0 };
      claimed = true;
      return { count: 1 };
    });
    const a = build();
    const b = build();
    await Promise.all([submit(a), submit(b)]);
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.status).toHaveBeenCalledTimes(1);
  });
  it("a crashed/uncertain claimant does not send again, including after validity expires", async () => {
    const tx = build();
    mocks.find.mockResolvedValue({
      ...binding(tx),
      state: "SUBMITTING",
      maxTime: tx.timeBounds!.maxTime,
    });
    expect((await submit(tx)).status).toBe("UNKNOWN");
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.signed).not.toHaveBeenCalled();
  });
  it("transport errors return attributable UNKNOWN while retaining the claim", async () => {
    const tx = build();
    mocks.find.mockResolvedValue(binding(tx));
    mocks.send.mockRejectedValue(new Error("timeout"));
    expect((await submit(tx)).status).toBe("UNKNOWN");
    expect(mocks.outcome).toHaveBeenCalledWith(
      tx.hash().toString("hex"),
      "UNRESOLVED",
      expect.any(Object),
    );
    expect(mocks.update.mock.calls[0]![0].data.state).toBe("SUBMITTING");
  });
  it("submission refusals retain the reservation for ledger reconciliation", async () => {
    const tx = build();
    mocks.find.mockResolvedValue(binding(tx));
    mocks.send.mockResolvedValue({ status: "ERROR" });
    expect((await submit(tx)).status).toBe("REJECTED");
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });
  it.each(["SUCCESS", "FAILED"])("durably records %s from ledger evidence", async (state) => {
    mocks.find
      .mockResolvedValueOnce(binding())
      .mockResolvedValue({ ...binding(), state, ledger: 101 });
    mocks.rpc.mockResolvedValue({ status: state, ledger: 101 });
    await reconcileControlIntent(intentId, deploymentId, "subscription.cancel");
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ state, ledger: 101 }) }),
    );
    expect(mocks.observe).toHaveBeenCalledWith(expect.any(String), state, 101, true);
  });
  it("unavailable history preserves unknown finality, even after wall-clock expiry", async () => {
    mocks.find.mockResolvedValue({ ...binding(), maxTime: "1", state: "SUBMITTING" });
    mocks.expired.mockRejectedValue(new Error("history gap"));
    await expect(
      reconcileControlIntent(intentId, deploymentId, "subscription.cancel"),
    ).rejects.toThrow(/history gap/);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("releases only after the shared helper proves ledger-time expiry with full lookup coverage", async () => {
    mocks.find
      .mockResolvedValueOnce(binding())
      .mockResolvedValue({ ...binding(), state: "EXPIRED" });
    mocks.expired.mockResolvedValue(true);
    await reconcileControlIntent(intentId, deploymentId, "subscription.cancel");
    expect(mocks.expired).toHaveBeenCalledWith(expect.objectContaining({ preparationLedger: 90 }));
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ state: "EXPIRED" }) }),
    );
    expect(mocks.observe).toHaveBeenCalledWith(expect.any(String), "REJECTED", undefined, true);
  });
});
