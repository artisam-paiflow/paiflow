import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  Account,
  Asset,
  Contract,
  Keypair,
  Networks,
  StrKey,
  TransactionBuilder,
  type Transaction,
} from "@stellar/stellar-sdk";
import type { Deployment, WalletControlIntent } from "@prisma/client";
import { ExecutionIntentSchema, type ExecutionIntent } from "@/lib/flows/field-policies";
import { executionV1Args } from "@/lib/stellar/execution-v1";
import { EXECUTION_V1_WASM_HASHES } from "@/lib/stellar/execution-artifacts";

const mocks = vi.hoisted(() => ({
  db: {
    walletControlIntent: { findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
  rpc: { sendTransaction: vi.fn(), getTransaction: vi.fn() },
  beforeSend: vi.fn(),
  outcome: vi.fn(),
  status: vi.fn(),
  expired: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/deployments/service-work", () => ({
  lockDeployment: vi.fn(async () => ({ serviceState: "ACTIVE" })),
  withDeploymentWork: async (_id: string, _kind: string, fn: () => Promise<unknown>) => fn(),
  beforeServiceSubmission: mocks.beforeSend,
  observeServiceTransaction: vi.fn(),
}));
vi.mock("@/lib/stellar/client", () => ({ sorobanRpc: () => mocks.rpc }));
vi.mock("@/lib/analytics/outcomes", () => ({
  recordTransactionOutcome: mocks.outcome,
  beginTransactionSubmission: vi.fn(async () => 1),
}));
vi.mock("@/lib/signed-tx", () => ({
  signedTransactionRow: (input: { signer: { txHash: string } }) => ({
    txHash: input.signer.txHash,
  }),
  insertSignedTransaction: vi.fn(async () => true),
}));
vi.mock("@/lib/api/v1/transaction-status", () => ({ getTransactionStatus: mocks.status }));
vi.mock("@/lib/stellar/allowance-status", () => ({ allowanceHasExpired: mocks.expired }));
import {
  createExecutionIntent,
  findExecutionRetry,
  readExecutionForSubmission,
} from "@/lib/api/v1/execution-intent";
import { reconcileControlIntent } from "@/lib/api/v1/control-intent";
import { submitControlIntent } from "@/lib/api/v1/control-submission";

const deployment = {
  id: "11111111-1111-4111-8111-111111111111",
  network: "testnet",
  status: "CONFIRMED",
} as Deployment;
const root = StrKey.encodeContract(Buffer.alloc(32, 1));
const pay = StrKey.encodeContract(Buffer.alloc(32, 2));
const payer = Keypair.random();
const recipient = Keypair.random().publicKey();
let rows: WalletControlIntent[];
let serial: Promise<unknown>;
const execution = (wallet = payer.publicKey(), nonce = "ab".repeat(32)): ExecutionIntent =>
  ExecutionIntentSchema.parse({
    version: 1,
    deploymentId: deployment.id,
    networkPassphraseHash: createHash("sha256").update(Networks.TESTNET).digest("hex"),
    rootContract: root,
    assetContract: Asset.native().contractId(Networks.TESTNET),
    payer: wallet,
    amountStroops: "1000",
    nonce,
    expiresAtLedger: 100,
    nodes: [
      { nodeId: "root", contractAddress: root, expectedRevision: "0" },
      { nodeId: "pay", contractAddress: pay, expectedRevision: "0" },
    ],
    arguments: { version: 1, inputs: [{ kind: "pay", nodeId: "pay", recipient }] },
  });
function envelope(
  intent: ExecutionIntent,
  options: { passphrase?: string; signer?: Keypair; amount?: string } = {},
) {
  const tx = new TransactionBuilder(new Account(intent.payer, "10"), {
    fee: "100",
    networkPassphrase: options.passphrase ?? Networks.TESTNET,
  })
    .addOperation(
      new Contract(intent.rootContract).call(
        "execute_v1",
        ...executionV1Args({
          ...intent,
          ...(options.amount ? { amountStroops: options.amount } : {}),
        }),
      ),
    )
    .setTimeout(180)
    .build();
  if (options.signer) tx.sign(options.signer);
  return tx;
}
function matches(row: WalletControlIntent, where: Record<string, unknown>) {
  return Object.entries(where).every(([key, value]) => {
    const actual = row[key as keyof WalletControlIntent];
    return typeof value === "object" && value !== null && "in" in value
      ? (value as { in: unknown[] }).in.includes(actual)
      : actual === value;
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  rows = [];
  serial = Promise.resolve();
  mocks.db.$transaction.mockImplementation((fn: (client: typeof mocks.db) => Promise<unknown>) => {
    const result = serial.then(() => fn(mocks.db));
    serial = result.catch(() => undefined);
    return result;
  });
  mocks.db.walletControlIntent.findFirst.mockImplementation(
    async ({ where }: { where: Record<string, unknown> }) =>
      rows.find((row) => matches(row, where)) ?? null,
  );
  mocks.db.walletControlIntent.create.mockImplementation(
    async ({ data }: { data: Partial<WalletControlIntent> }) => {
      const row = {
        id: `22222222-2222-4222-8222-${String(rows.length + 1).padStart(12, "0")}`,
        state: "PREPARED",
        ledger: null,
        createdAt: new Date(),
        submittedAt: null,
        completedAt: null,
        ...data,
      } as WalletControlIntent;
      rows.push(row);
      return { ...row };
    },
  );
  mocks.db.walletControlIntent.updateMany.mockImplementation(
    async ({
      where,
      data,
    }: {
      where: Record<string, unknown>;
      data: Partial<WalletControlIntent>;
    }) => {
      const selected = rows.filter((row) => matches(row, where));
      selected.forEach((row) => Object.assign(row, data));
      return { count: selected.length };
    },
  );
  mocks.rpc.sendTransaction.mockResolvedValue({ status: "PENDING" });
  mocks.rpc.getTransaction.mockResolvedValue({ status: "NOT_FOUND" });
  mocks.status.mockImplementation(async (_deployment: unknown, txHash: string) => ({
    txHash,
    network: "testnet",
    status: "UNKNOWN",
  }));
  mocks.expired.mockResolvedValue(false);
});
async function prepare(
  options: { intent?: ExecutionIntent; keyHash?: string | null; digest?: string } = {},
) {
  const intent = options.intent ?? execution();
  return createExecutionIntent({
    deployment,
    execution: intent,
    artifacts: intent.nodes.map((node, index) => ({
      nodeId: node.nodeId,
      contractAddress: node.contractAddress,
      wasmHash:
        index === 0 ? EXECUTION_V1_WASM_HASHES.DEPOSIT_TRIGGER : EXECUTION_V1_WASM_HASHES.PAYER,
    })),
    unsignedXdr: envelope(intent).toXDR(),
    preparationLedger: 10,
    keyHash: options.keyHash ?? null,
    requestDigest: options.digest ?? "ef".repeat(32),
  });
}
function signed(
  prepared: Awaited<ReturnType<typeof prepare>>,
  options: { passphrase?: string; signer?: Keypair; amount?: string } = {},
) {
  if (options.amount) return envelope(prepared.execution!, { signer: payer, ...options }).toXDR();
  const tx = TransactionBuilder.fromXDR(
    prepared.xdr,
    options.passphrase ?? Networks.TESTNET,
  ) as Transaction;
  tx.sign(options.signer ?? payer);
  return tx.toXDR();
}

describe("durable exact execution preparation", () => {
  it("persists unsigned evidence before signing and reuses key without generating a new payment", async () => {
    const first = await prepare({ keyHash: "12".repeat(32) });
    const second = await prepare({
      keyHash: "12".repeat(32),
      intent: execution(payer.publicKey(), "34".repeat(32)),
    });
    expect(second).toEqual(first);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.unsignedXdr).toBe(first.xdr);
    expect(
      (TransactionBuilder.fromXDR(rows[0]!.unsignedXdr!, Networks.TESTNET) as Transaction)
        .signatures,
    ).toHaveLength(0);
    expect(await findExecutionRetry(deployment.id, "12".repeat(32), "ef".repeat(32))).toEqual(
      first,
    );
    await expect(
      findExecutionRetry(deployment.id, "12".repeat(32), "ff".repeat(32)),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("serializes duplicate preparation claims across concurrent requests", async () => {
    const results = await Promise.all([
      prepare({ keyHash: "12".repeat(32) }),
      prepare({ keyHash: "12".repeat(32) }),
    ]);
    expect(results[0]!.intent).toBe(results[1]!.intent);
    expect(rows).toHaveLength(1);
  });
  it("blocks same-payer replacement without a key, while another payer remains independent", async () => {
    await prepare();
    await expect(
      prepare({ intent: execution(payer.publicKey(), "11".repeat(32)) }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await prepare({ intent: execution(Keypair.random().publicKey()) });
    expect(rows).toHaveLength(2);
  });
  it("validates actual prepared arguments against saved reviewed intent", async () => {
    const intent = execution();
    await expect(
      createExecutionIntent({
        deployment,
        execution: intent,
        artifacts: intent.nodes.map((node, index) => ({
          nodeId: node.nodeId,
          contractAddress: node.contractAddress,
          wasmHash:
            index === 0 ? EXECUTION_V1_WASM_HASHES.DEPOSIT_TRIGGER : EXECUTION_V1_WASM_HASHES.PAYER,
        })),
        unsignedXdr: envelope(intent, { amount: "999" }).toXDR(),
        preparationLedger: 10,
        keyHash: null,
        requestDigest: "aa".repeat(32),
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    expect(rows).toHaveLength(0);
  });
  it("allows exact signedXdr-only lookup but refuses another deployment/intent/body", async () => {
    const prepared = await prepare();
    expect((await readExecutionForSubmission(deployment.id, signed(prepared))).id).toBe(
      prepared.intent,
    );
    await expect(
      readExecutionForSubmission("99999999-9999-4999-8999-999999999999", signed(prepared)),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      readExecutionForSubmission(
        deployment.id,
        signed(prepared),
        "99999999-9999-4999-8999-999999999999",
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      readExecutionForSubmission(deployment.id, signed(prepared, { amount: "1001" })),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    expect(mocks.rpc.sendTransaction).not.toHaveBeenCalled();
  });
  it.each(["unsigned", "wrong-key", "wrong-network"])(
    "refuses %s before attribution or relay",
    async (which) => {
      const prepared = await prepare();
      const wire =
        which === "unsigned"
          ? prepared.xdr
          : signed(
              prepared,
              which === "wrong-key"
                ? { signer: Keypair.random() }
                : { passphrase: Networks.PUBLIC },
            );
      await expect(readExecutionForSubmission(deployment.id, wire)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(mocks.db.auditLog.create).not.toHaveBeenCalled();
      expect(mocks.beforeSend).not.toHaveBeenCalled();
    },
  );
  it.each(["asset", "recipient", "revision", "nonce", "payer"])(
    "refuses a signed change to reviewed %s before relay",
    async (field) => {
      const prepared = await prepare();
      const altered = structuredClone(prepared.execution!);
      if (field === "asset") altered.assetContract = StrKey.encodeContract(Buffer.alloc(32, 9));
      if (field === "recipient" && altered.arguments.inputs[0]!.kind === "pay")
        altered.arguments.inputs[0]!.recipient = Keypair.random().publicKey();
      if (field === "revision") altered.nodes[1]!.expectedRevision = "1";
      if (field === "nonce") altered.nonce = "12".repeat(32);
      if (field === "payer") altered.payer = Keypair.random().publicKey();
      const tx = envelope(altered, { signer: payer });
      await expect(
        readExecutionForSubmission(deployment.id, tx.toXDR(), prepared.intent),
      ).rejects.toMatchObject({ code: "VALIDATION" });
      expect(mocks.beforeSend).not.toHaveBeenCalled();
      expect(mocks.db.auditLog.create).not.toHaveBeenCalled();
    },
  );
});
describe("one-send wallet intent lifecycle for execution", () => {
  const submit = (prepared: Awaited<ReturnType<typeof prepare>>) =>
    submitControlIntent({
      deployment,
      tokenId: "token",
      intent: prepared.intent!,
      action: "payment.execute",
      signedXdr: signed(prepared),
      ip: "127.0.0.1",
      assertEligible: async () => undefined,
    });
  it("only one concurrent replica claims the send; duplicates observe the same hash", async () => {
    const prepared = await prepare();
    const results = await Promise.all([submit(prepared), submit(prepared)]);
    expect(mocks.rpc.sendTransaction).toHaveBeenCalledTimes(1);
    expect(results.map((result) => result.txHash)).toEqual([prepared.txHash, prepared.txHash]);
    expect(rows[0]!.state).toBe("SUBMITTING");
  });
  it("retains unknown send outcome and never blindly retries after missing acknowledgement", async () => {
    const prepared = await prepare();
    mocks.rpc.sendTransaction.mockRejectedValue(new Error("transport"));
    expect((await submit(prepared)).status).toBe("UNKNOWN");
    expect((await submit(prepared)).status).toBe("UNKNOWN");
    expect(mocks.rpc.sendTransaction).toHaveBeenCalledTimes(1);
    expect(mocks.outcome).toHaveBeenCalledWith(prepared.txHash, "UNRESOLVED", expect.anything());
    await expect(prepare()).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("a crash after durable claim does not authorize another send", async () => {
    const prepared = await prepare();
    mocks.beforeSend.mockRejectedValueOnce(new Error("crash"));
    await expect(submit(prepared)).rejects.toThrow("crash");
    expect(rows[0]!.state).toBe("SUBMITTING");
    await submit(prepared);
    expect(mocks.rpc.sendTransaction).not.toHaveBeenCalled();
  });
  it.each(["ERROR", "TRY_AGAIN_LATER"])(
    "queue %s retains the original receipt and reservation",
    async (status) => {
      const prepared = await prepare();
      mocks.rpc.sendTransaction.mockResolvedValue({ status });
      expect((await submit(prepared)).status).toBe("REJECTED");
      await submit(prepared);
      expect(mocks.rpc.sendTransaction).toHaveBeenCalledTimes(1);
      expect(rows[0]!.state).toBe("SUBMITTING");
    },
  );
  it("expiry retains reservation until actual coverage proves non-inclusion", async () => {
    const prepared = await prepare();
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 181000);
    await expect(submit(prepared)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(rows[0]!.state).toBe("PREPARED");
    await reconcileControlIntent(prepared.intent!, deployment.id, "payment.execute");
    expect(rows[0]!.state).toBe("PREPARED");
    mocks.expired.mockResolvedValue(true);
    await reconcileControlIntent(prepared.intent!, deployment.id, "payment.execute");
    expect(rows[0]!.state).toBe("EXPIRED");
    expect(mocks.rpc.sendTransaction).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
  it("recovers authoritative finality without another signature/send", async () => {
    const prepared = await prepare();
    rows[0]!.state = "SUBMITTING";
    mocks.rpc.getTransaction.mockResolvedValue({ status: "SUCCESS", ledger: 80 });
    const result = await reconcileControlIntent(prepared.intent!, deployment.id, "payment.execute");
    expect(result.state).toBe("SUCCESS");
    expect(result.ledger).toBe(80);
    expect(mocks.rpc.sendTransaction).not.toHaveBeenCalled();
  });
});
