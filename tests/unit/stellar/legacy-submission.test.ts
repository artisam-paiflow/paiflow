import type { Prisma, SignedTransaction } from "@prisma/client";
import {
  Account,
  Address,
  Keypair,
  MuxedAccount,
  Networks,
  Operation,
  StrKey,
  Transaction,
  TransactionBuilder,
  nativeToScVal,
  xdr,
} from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  admitLegacySubmission,
  registerLegacyPreparation,
  type LegacySubmissionDeployment,
  type LegacySubmissionKind,
} from "@/lib/stellar/legacy-submission";

const mocked = vi.hoisted(() => ({
  deployment: null as LegacySubmissionDeployment | null,
  serviceState: "ACTIVE" as "ACTIVE" | "RETIRING" | "RETIRED",
  preparations: new Map<string, Prisma.WalletSubmissionPreparationCreateManyInput>(),
  journals: new Map<string, SignedTransaction>(),
  insert: vi.fn(),
  capture: vi.fn(),
  lock: vi.fn(),
  transaction: vi.fn(),
  prepareCreate: vi.fn(),
  prepareFind: vi.fn(),
  journalFind: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: { $transaction: mocked.transaction } }));
vi.mock("@/lib/deployments/service-work", () => ({ lockDeployment: mocked.lock }));
vi.mock("@/lib/signed-tx", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/signed-tx")>()),
  insertSignedTransaction: mocked.insert,
  captureTransactionSigned: mocked.capture,
}));

const SOURCE = Keypair.random();
const OTHER = Keypair.random();
const ROOT = StrKey.encodeContract(Buffer.alloc(32, 1));
const OTHER_ROOT = StrKey.encodeContract(Buffer.alloc(32, 2));
const DEPLOYMENT_ID = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-11-03T15:00:00Z");

function graph(kind: "STREAMER" | "SUBSCRIPTION" | "DEPOSIT_TRIGGER"): Prisma.JsonObject {
  const trigger =
    kind === "STREAMER"
      ? {
          id: "root",
          type: "on_schedule",
          config: {
            intervalAmount: 1,
            intervalUnit: "day",
            startsAt: "2026-11-02T00:00:00Z",
            pauseAllowed: true,
            retrieveAllowed: true,
          },
        }
      : kind === "SUBSCRIPTION"
        ? {
            id: "root",
            type: "subscription",
            config: {
              asset: { kind: "native" },
              subscriber: OTHER.publicKey(),
              amountPerPeriodStroops: "100",
            },
          }
        : { id: "root", type: "on_receive", config: { asset: { kind: "native" } } };
  return {
    nodes: [
      trigger,
      {
        id: "pay",
        type: "pay",
        config: { asset: { kind: "native" }, recipient: OTHER.publicKey(), fullAmount: true },
      },
    ],
    edges: [{ id: "edge", source: "root", target: "pay" }],
  };
}

function deployment(
  kind: "STREAMER" | "SUBSCRIPTION" | "DEPOSIT_TRIGGER" = "DEPOSIT_TRIGGER",
): LegacySubmissionDeployment {
  return {
    id: DEPLOYMENT_ID,
    status: "CONFIRMED",
    network: "testnet",
    contractAddress: ROOT,
    pipelineSnapshot: [{ nodeId: "root", templateKind: kind, contractAddress: ROOT }],
    graphSnapshot: graph(kind),
    paramsSnapshot: {},
    sourceAccount: SOURCE.publicKey(),
    chargeRelayerMode: "USER",
    chargeRelayerAddress: OTHER.publicKey(),
    flow: { templateKind: kind === "DEPOSIT_TRIGGER" ? "SPLITTER" : kind },
  };
}

function current(): LegacySubmissionDeployment {
  if (!mocked.deployment) throw new Error("Missing test deployment");
  return mocked.deployment;
}

function build(
  options: {
    method?: string;
    target?: string;
    args?: xdr.ScVal[];
    source?: Keypair;
    operationSource?: string;
    fee?: string;
    sequence?: string;
    timeout?: number;
    network?: string;
    extraOperation?: boolean;
    auth?: xdr.SorobanAuthorizationEntry[];
    muxed?: boolean;
  } = {},
): Transaction {
  const source = options.source ?? SOURCE;
  const account = new Account(source.publicKey(), options.sequence ?? "1");
  const builder = new TransactionBuilder(
    options.muxed ? new MuxedAccount(account, "10") : account,
    { fee: options.fee ?? "100", networkPassphrase: options.network ?? Networks.TESTNET },
  );
  builder.addOperation(
    Operation.invokeContractFunction({
      contract: options.target ?? ROOT,
      function: options.method ?? "deposit",
      args: options.args ?? [
        new Address(source.publicKey()).toScVal(),
        nativeToScVal(100n, { type: "i128" }),
      ],
      source: options.operationSource,
      auth: options.auth,
    }),
  );
  if (options.extraOperation) builder.addOperation(Operation.bumpSequence({ bumpTo: "9" }));
  return builder.setTimeout(options.timeout ?? 180).build();
}

function register(
  tx: Transaction,
  kind: LegacySubmissionKind = "TRIGGER",
  extra: { method?: string; amount?: string; expectedArgs?: xdr.ScVal[] } = {},
) {
  return registerLegacyPreparation({
    deployment: current(),
    kind,
    unsignedXdr: tx.toXDR(),
    sourceAddress: tx.source,
    contractAddress: ROOT,
    method: extra.method ?? (kind === "TRIGGER" ? "deposit" : "pause"),
    amount: extra.amount ?? (kind === "TRIGGER" ? "100" : undefined),
    expectedArgs: extra.expectedArgs,
  });
}

function admit(tx: Transaction, kind: LegacySubmissionKind = "TRIGGER", d = current()) {
  return admitLegacySubmission({
    deployment: d,
    kind,
    signedXdr: tx.toXDR(),
    userId: null,
    ip: null,
  });
}

function journal(row: Prisma.SignedTransactionUncheckedCreateInput): SignedTransaction {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    txHash: row.txHash,
    signerAddress: row.signerAddress,
    network: row.network,
    kind: row.kind,
    deploymentId: row.deploymentId ?? null,
    signedBySource: row.signedBySource ?? true,
    isFeeBump: row.isFeeBump ?? false,
    muxedSource: row.muxedSource ?? null,
    feeSourceAddress: row.feeSourceAddress ?? null,
    userId: null,
    ip: null,
    apiTokenId: null,
    developerApiTokenId: null,
    callerAccountId: null,
    trackingVersion: null,
    audience: "UNCLASSIFIED",
    outcome: "RECEIVED",
    ledger: null,
    submittedAt: NOW,
    acceptedAt: null,
    confirmedAt: null,
    failedAt: null,
    rejectedAt: null,
    failureCode: null,
    nextCheckAt: null,
    lastCheckedAt: null,
    checkAttempts: 0,
    submissionRevision: 0,
    outcomeRevision: 0,
    createdAt: NOW,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  mocked.deployment = deployment();
  mocked.serviceState = "ACTIVE";
  mocked.preparations.clear();
  mocked.journals.clear();
  mocked.lock.mockImplementation(async () => ({
    id: DEPLOYMENT_ID,
    serviceState: mocked.serviceState,
  }));
  mocked.prepareCreate.mockImplementation(
    async ({ data }: { data: Prisma.WalletSubmissionPreparationCreateManyInput[] }) => {
      let count = 0;
      for (const row of data)
        if (!mocked.preparations.has(row.txHash)) {
          mocked.preparations.set(row.txHash, row);
          count++;
        }
      return { count };
    },
  );
  mocked.prepareFind.mockImplementation(
    async ({ where }: { where: { txHash: string } }) =>
      mocked.preparations.get(where.txHash) ?? null,
  );
  mocked.journalFind.mockImplementation(
    async ({ where }: { where: { txHash: string } }) => mocked.journals.get(where.txHash) ?? null,
  );
  mocked.transaction.mockImplementation(async (fn: (client: unknown) => Promise<unknown>) =>
    fn({
      deployment: { findUnique: async () => mocked.deployment },
      walletSubmissionPreparation: {
        createMany: mocked.prepareCreate,
        findUnique: mocked.prepareFind,
      },
      signedTransaction: { findUnique: mocked.journalFind },
    }),
  );
  mocked.insert.mockImplementation(async (row: Prisma.SignedTransactionUncheckedCreateInput) => {
    if (mocked.journals.has(row.txHash)) return false;
    mocked.journals.set(row.txHash, journal(row));
    return true;
  });
});
afterEach(() => vi.useRealTimers());

describe("legacy wallet exact preparation admission", () => {
  it("records only the approved hash/snapshot evidence, then admits a real source signature once", async () => {
    const tx = build();
    await register(tx);
    const record = mocked.preparations.get(tx.hash().toString("hex"));
    expect(record).toMatchObject({
      deploymentId: DEPLOYMENT_ID,
      network: "testnet",
      kind: "TRIGGER",
      sourceAddress: SOURCE.publicKey(),
      contractAddress: ROOT,
      method: "deposit",
      amountStroops: "100",
    });
    expect(record).not.toHaveProperty("unsignedXdr");
    expect(record).not.toHaveProperty("signedXdr");
    tx.sign(SOURCE);
    expect(await admit(tx)).toMatchObject({
      replay: false,
      signer: { ok: true, signedBySource: true },
    });
    expect(await admit(tx)).toMatchObject({
      replay: true,
      receipt: { outcome: "RECEIVED", ledger: null },
    });
    expect(mocked.insert).toHaveBeenCalledTimes(1);
    expect(mocked.capture).toHaveBeenCalledTimes(1);
  });

  it("rejects an unsigned envelope before any transaction, journal or analytics write", async () => {
    await expect(admit(build())).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocked.transaction).not.toHaveBeenCalled();
    expect(mocked.insert).not.toHaveBeenCalled();
    expect(mocked.capture).not.toHaveBeenCalled();
  });

  it.each(["wrong-key", "wrong-network", "forged-hint"])(
    "rejects %s signatures before writes",
    async (attack) => {
      const tx = build({
        network: attack === "wrong-network" ? Networks.PUBLIC : Networks.TESTNET,
      });
      if (attack === "forged-hint")
        tx.addDecoratedSignature(
          new xdr.DecoratedSignature({
            hint: SOURCE.signatureHint(),
            signature: OTHER.sign(tx.hash()),
          }),
        );
      else tx.sign(attack === "wrong-key" ? OTHER : SOURCE);
      await expect(admit(tx)).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(mocked.transaction).not.toHaveBeenCalled();
      expect(mocked.capture).not.toHaveBeenCalled();
    },
  );

  it("requires approval for a fresh correctly signed matching-shape transaction", async () => {
    const tx = build();
    tx.sign(SOURCE);
    await expect(admit(tx)).rejects.toMatchObject({ code: "VALIDATION" });
    expect(mocked.insert).not.toHaveBeenCalled();
  });

  it.each(["fee", "amount", "sequence"])(
    "rejects unapproved %s changes even with a real source signature",
    async (field) => {
      await register(build());
      const tx = build({
        fee: field === "fee" ? "101" : "100",
        sequence: field === "sequence" ? "2" : "1",
        args: [
          new Address(SOURCE.publicKey()).toScVal(),
          nativeToScVal(field === "amount" ? 101n : 100n, { type: "i128" }),
        ],
      });
      tx.sign(SOURCE);
      await expect(admit(tx)).rejects.toMatchObject({ code: "VALIDATION" });
      expect(mocked.insert).not.toHaveBeenCalled();
    },
  );

  it.each([
    "target",
    "method",
    "extra-op",
    "op-source",
    "payer",
    "amount-type",
    "negative",
    "zero",
  ])("rejects %s operation substitution before journal writes", async (attack) => {
    const args =
      attack === "payer"
        ? [new Address(OTHER.publicKey()).toScVal(), nativeToScVal(100n, { type: "i128" })]
        : attack === "amount-type"
          ? [new Address(SOURCE.publicKey()).toScVal(), nativeToScVal(100n, { type: "i64" })]
          : [
              new Address(SOURCE.publicKey()).toScVal(),
              nativeToScVal(attack === "negative" ? -1n : attack === "zero" ? 0n : 100n, {
                type: "i128",
              }),
            ];
    const tx = build({
      target: attack === "target" ? OTHER_ROOT : ROOT,
      method: attack === "method" ? "execute" : "deposit",
      extraOperation: attack === "extra-op",
      operationSource: attack === "op-source" ? SOURCE.publicKey() : undefined,
      args,
    });
    tx.sign(SOURCE);
    await expect(admit(tx)).rejects.toMatchObject({ code: "VALIDATION" });
    expect(mocked.insert).not.toHaveBeenCalled();
    expect(mocked.capture).not.toHaveBeenCalled();
  });

  it("rejects fee bumps and muxed transaction sources", async () => {
    const inner = build();
    inner.sign(SOURCE);
    const feeBump = TransactionBuilder.buildFeeBumpTransaction(
      OTHER,
      "100",
      inner,
      Networks.TESTNET,
    );
    feeBump.sign(OTHER);
    await expect(
      admitLegacySubmission({ deployment: current(), kind: "TRIGGER", signedXdr: feeBump.toXDR() }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    const muxed = build({ muxed: true });
    muxed.sign(SOURCE);
    await expect(admit(muxed)).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("refuses another address's contract authorization entries", async () => {
    const auth = new xdr.SorobanAuthorizationEntry({
      credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
        new xdr.SorobanAddressCredentials({
          address: new Address(OTHER.publicKey()).toScAddress(),
          nonce: xdr.Int64.fromString("1"),
          signatureExpirationLedger: 1,
          signature: xdr.ScVal.scvVoid(),
        }),
      ),
      rootInvocation: new xdr.SorobanAuthorizedInvocation({
        function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
          new xdr.InvokeContractArgs({
            contractAddress: new Address(ROOT).toScAddress(),
            functionName: "deposit",
            args: [],
          }),
        ),
        subInvocations: [],
      }),
    });
    const tx = build({ auth: [auth] });
    tx.sign(SOURCE);
    await expect(admit(tx)).rejects.toMatchObject({ code: "VALIDATION" });
    expect(mocked.insert).not.toHaveBeenCalled();
  });

  it("rejects signed or mismatched registrations and unlimited/overlong signing windows", async () => {
    const signed = build();
    signed.sign(SOURCE);
    await expect(register(signed)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(register(build(), "TRIGGER", { amount: "101" })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await expect(register(build({ timeout: 0 }))).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(register(build({ timeout: 301 }))).rejects.toMatchObject({ code: "VALIDATION" });
    expect(mocked.prepareCreate).not.toHaveBeenCalled();
  });

  it("refuses expired fresh approval without deleting retained evidence", async () => {
    const tx = build();
    await register(tx);
    tx.sign(SOURCE);
    vi.setSystemTime(new Date(NOW.getTime() + 181_000));
    await expect(admit(tx)).rejects.toMatchObject({ code: "VALIDATION" });
    expect(mocked.preparations.size).toBe(1);
    expect(mocked.insert).not.toHaveBeenCalled();
  });

  it("allows exact historical journal recovery after expiry without an approval row", async () => {
    const tx = build();
    tx.sign(SOURCE);
    await expect(admit(tx)).rejects.toMatchObject({ code: "VALIDATION" });
    const row: Prisma.SignedTransactionUncheckedCreateInput = {
      txHash: tx.hash().toString("hex"),
      signerAddress: SOURCE.publicKey(),
      deploymentId: DEPLOYMENT_ID,
      kind: "TRIGGER",
      network: "testnet",
    };
    mocked.journals.set(row.txHash, { ...journal(row), outcome: "CONFIRMED", ledger: 123 });
    vi.setSystemTime(new Date(NOW.getTime() + 181_000));
    expect(await admit(tx)).toMatchObject({
      replay: true,
      receipt: { outcome: "CONFIRMED", ledger: 123 },
    });
    expect(mocked.insert).not.toHaveBeenCalled();
    expect(mocked.capture).not.toHaveBeenCalled();
  });

  it.each(["deployment", "network", "kind", "source", "unsigned"])(
    "rejects a historical journal with mismatched %s attribution",
    async (field) => {
      const tx = build();
      tx.sign(SOURCE);
      const hash = tx.hash().toString("hex");
      const existing = journal({
        txHash: hash,
        signerAddress: SOURCE.publicKey(),
        deploymentId: DEPLOYMENT_ID,
        kind: "TRIGGER",
        network: "testnet",
      });
      if (field === "deployment") existing.deploymentId = "33333333-3333-4333-8333-333333333333";
      if (field === "network") existing.network = "mainnet";
      if (field === "kind") existing.kind = "INVOKE";
      if (field === "source") existing.signerAddress = OTHER.publicKey();
      if (field === "unsigned") existing.signedBySource = false;
      mocked.journals.set(hash, existing);
      await expect(admit(tx)).rejects.toMatchObject({ code: "CONFLICT" });
      expect(mocked.insert).not.toHaveBeenCalled();
    },
  );

  it("does not trust a historical journal for an unrelated operation", async () => {
    const tx = build({ target: OTHER_ROOT });
    tx.sign(SOURCE);
    const hash = tx.hash().toString("hex");
    mocked.journals.set(
      hash,
      journal({
        txHash: hash,
        signerAddress: SOURCE.publicKey(),
        deploymentId: DEPLOYMENT_ID,
        kind: "TRIGGER",
        network: "testnet",
      }),
    );
    await expect(admit(tx)).rejects.toMatchObject({ code: "VALIDATION" });
    expect(mocked.transaction).not.toHaveBeenCalled();
  });

  it("rechecks current snapshot and lifecycle under the deployment lock", async () => {
    const tx = build();
    await register(tx);
    tx.sign(SOURCE);
    const original = structuredClone(current());
    mocked.deployment = { ...current(), paramsSnapshot: { changed: true } };
    await expect(admit(tx, "TRIGGER", original)).rejects.toMatchObject({ code: "CONFLICT" });
    mocked.deployment = original;
    mocked.serviceState = "RETIRING";
    await expect(admit(tx)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mocked.insert).not.toHaveBeenCalled();
  });

  it("rechecks active lifecycle before registering and does not overwrite conflicting preparation scope", async () => {
    mocked.serviceState = "RETIRED";
    await expect(register(build())).rejects.toMatchObject({ code: "CONFLICT" });
    mocked.serviceState = "ACTIVE";
    const tx = build();
    await register(tx);
    const record = mocked.preparations.get(tx.hash().toString("hex"))!;
    mocked.preparations.set(record.txHash, {
      ...record,
      deploymentId: "33333333-3333-4333-8333-333333333333",
    });
    await expect(register(tx)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mocked.preparations.get(record.txHash)?.deploymentId).toBe(
      "33333333-3333-4333-8333-333333333333",
    );
  });

  it("rechecks confirmation status under the deployment lock", async () => {
    const tx = build();
    await register(tx);
    tx.sign(SOURCE);
    const original = structuredClone(current());
    mocked.deployment = { ...current(), status: "FAILED" };
    await expect(admit(tx, "TRIGGER", original)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mocked.insert).not.toHaveBeenCalled();
  });

  it("does not emit analytics when atomic journal admission fails", async () => {
    const tx = build();
    await register(tx);
    tx.sign(SOURCE);
    mocked.insert.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(admit(tx)).rejects.toThrow("database unavailable");
    expect(mocked.capture).not.toHaveBeenCalled();
  });

  it("rejects an approval after snapshot changes even when the caller loaded the new snapshot", async () => {
    const tx = build();
    await register(tx);
    tx.sign(SOURCE);
    mocked.deployment = { ...current(), paramsSnapshot: { changed: true } };
    await expect(admit(tx)).rejects.toMatchObject({ code: "VALIDATION" });
    expect(mocked.insert).not.toHaveBeenCalled();
  });

  it("does not send policy-v1 funding through the legacy boundary", async () => {
    mocked.deployment = {
      ...current(),
      graphSnapshot: { ...graph("DEPOSIT_TRIGGER"), fieldPolicies: {} },
    };
    const tx = build();
    tx.sign(SOURCE);
    await expect(admit(tx)).rejects.toMatchObject({ code: "VALIDATION" });
    expect(mocked.transaction).not.toHaveBeenCalled();
  });

  it("treats a journal inserted by a competing admission as recovery without a second capture", async () => {
    const tx = build();
    await register(tx);
    tx.sign(SOURCE);
    mocked.insert.mockImplementationOnce(
      async (row: Prisma.SignedTransactionUncheckedCreateInput) => {
        mocked.journals.set(row.txHash, journal(row));
        return false;
      },
    );
    expect(await admit(tx)).toMatchObject({
      replay: true,
      receipt: { outcome: "RECEIVED", ledger: null },
    });
    expect(mocked.capture).not.toHaveBeenCalled();
  });

  it("refuses a competing mismatched journal instead of returning another scope's receipt", async () => {
    const tx = build();
    await register(tx);
    tx.sign(SOURCE);
    mocked.insert.mockImplementationOnce(
      async (row: Prisma.SignedTransactionUncheckedCreateInput) => {
        mocked.journals.set(row.txHash, { ...journal(row), kind: "INVOKE" });
        return false;
      },
    );
    await expect(admit(tx)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mocked.capture).not.toHaveBeenCalled();
  });
});

describe("legitimate legacy funding and control matrix", () => {
  it.each(["pause", "unpause", "retrieve_unvested"])(
    "binds streamer %s to deployed permissions and controller",
    async (method) => {
      mocked.deployment = deployment("STREAMER");
      const tx = build({ method, args: [] });
      await register(tx, "INVOKE", { method });
      tx.sign(SOURCE);
      expect(await admit(tx, "INVOKE")).toMatchObject({ replay: false });
      const wrongSource = build({ method, args: [], source: OTHER });
      wrongSource.sign(OTHER);
      await expect(admit(wrongSource, "INVOKE")).rejects.toMatchObject({ code: "VALIDATION" });
    },
  );

  it.each(["charge", "subscribe", "unsubscribe"])(
    "retains subscription %s with its exact authorizer",
    async (method) => {
      mocked.deployment = deployment("SUBSCRIPTION");
      const source = method === "charge" ? SOURCE : OTHER;
      const tx = build({ method, args: [], source });
      await register(tx, "INVOKE", { method });
      tx.sign(source);
      expect(await admit(tx, "INVOKE")).toMatchObject({ replay: false });
      const wrongSource = method === "charge" ? OTHER : SOURCE;
      const wrong = build({ method, args: [], source: wrongSource });
      wrong.sign(wrongSource);
      await expect(admit(wrong, "INVOKE")).rejects.toMatchObject({ code: "VALIDATION" });
    },
  );

  it("checks the exact approved relayer against current desired configuration only for fresh sends", async () => {
    mocked.deployment = deployment("SUBSCRIPTION");
    const args = [new Address(OTHER.publicKey()).toScVal()];
    const tx = build({ method: "set_relayer", args });
    await expect(register(tx, "INVOKE", { method: "set_relayer" })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await register(tx, "INVOKE", { method: "set_relayer", expectedArgs: args });
    tx.sign(SOURCE);
    mocked.deployment = { ...current(), chargeRelayerAddress: SOURCE.publicKey() };
    await expect(admit(tx, "INVOKE")).rejects.toMatchObject({ code: "VALIDATION" });
    mocked.deployment = { ...current(), chargeRelayerAddress: OTHER.publicKey() };
    expect(await admit(tx, "INVOKE")).toMatchObject({ replay: false });
    mocked.deployment = { ...current(), chargeRelayerMode: "MANUAL", chargeRelayerAddress: null };
    expect(await admit(tx, "INVOKE")).toMatchObject({ replay: true });
  });

  it("refuses relayer, allowance and malformed control methods even with real signatures", async () => {
    mocked.deployment = deployment("SUBSCRIPTION");
    for (const method of ["charge_by_relayer", "approve", "execute", "cancel"]) {
      const tx = build({ method, args: [] });
      tx.sign(SOURCE);
      await expect(admit(tx, "INVOKE")).rejects.toMatchObject({ code: "VALIDATION" });
    }
    const extra = build({ method: "charge", args: [nativeToScVal(1n, { type: "i128" })] });
    extra.sign(SOURCE);
    await expect(admit(extra, "INVOKE")).rejects.toMatchObject({ code: "VALIDATION" });
    expect(mocked.insert).not.toHaveBeenCalled();
  });

  it("refuses controls disabled in the immutable schedule snapshot", async () => {
    const d = deployment("STREAMER");
    d.graphSnapshot = {
      nodes: [
        {
          id: "root",
          type: "on_schedule",
          config: {
            intervalUnit: "day",
            startsAt: "2026-11-02T00:00:00Z",
            pauseAllowed: false,
            retrieveAllowed: false,
          },
        },
      ],
      edges: [],
    };
    mocked.deployment = d;
    for (const method of ["pause", "unpause", "retrieve_unvested"]) {
      const tx = build({ method, args: [] });
      tx.sign(SOURCE);
      await expect(admit(tx, "INVOKE")).rejects.toMatchObject({ code: "VALIDATION" });
    }
  });

  it.each(["WEBHOOK", "STREAMER", "SPLITTER"])(
    "retains %s funding with exact prepared hash",
    async (kind) => {
      const d = deployment(kind === "STREAMER" ? "STREAMER" : "DEPOSIT_TRIGGER");
      d.pipelineSnapshot =
        kind === "SPLITTER"
          ? null
          : [{ nodeId: "root", templateKind: kind, contractAddress: ROOT }];
      d.flow.templateKind = kind;
      mocked.deployment = d;
      const method =
        kind === "STREAMER" ? "top_up" : kind === "SPLITTER" ? "distribute" : "deposit";
      const tx = build({ method });
      await register(tx, "TRIGGER", { method });
      tx.sign(SOURCE);
      expect(await admit(tx)).toMatchObject({ replay: false });
    },
  );
});
