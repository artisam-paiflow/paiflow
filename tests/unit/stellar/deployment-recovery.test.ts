import { Account, Keypair, Networks, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { beforeEach, expect, it, vi } from "vitest";
import { PreparedRecoverySchema } from "@/lib/deployments/prepared-recovery-schema";

const { signed, current, getTransaction, getLatestLedger, getLedgers } = vi.hoisted(() => ({
  signed: vi.fn(),
  current: vi.fn(),
  getTransaction: vi.fn(),
  getLatestLedger: vi.fn(),
  getLedgers: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  db: { signedTransaction: { findUnique: signed }, deployment: { findUnique: current } },
}));
vi.mock("@/lib/stellar/client", () => ({
  sorobanRpc: () => ({ getTransaction, getLatestLedger, getLedgers }),
}));
import { preparedDeploymentRecovery } from "@/lib/stellar/deployment-recovery";

const account = Keypair.random();
const now = Math.floor(Date.now() / 1000);
function deployment(maxTime = now + 180) {
  const tx = new TransactionBuilder(new Account(account.publicKey(), "1"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.bumpSequence({ bumpTo: "2" }))
    .setTimebounds(0, maxTime)
    .build();
  return {
    id: "deployment-id",
    createdAt: new Date((now - 180) * 1000),
    status: "PENDING_SIGNATURE",
    serviceState: "ACTIVE",
    network: "testnet",
    sourceAccount: account.publicKey(),
    unsignedXdr: tx.toXDR(),
    deployTxHash: null,
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  signed.mockResolvedValue(null);
  getTransaction.mockResolvedValue({
    status: "NOT_FOUND",
    oldestLedger: 100,
    oldestLedgerCloseTime: String(now - 240),
    latestLedger: 123,
  });
  getLatestLedger.mockResolvedValue({ sequence: 123 });
  getLedgers.mockResolvedValue({ ledgers: [{ sequence: 123, ledgerCloseTime: String(now) }] });
});

it("returns the same original prepared identity without any RPC calls", async () => {
  const d = deployment();
  const result = await preparedDeploymentRecovery(d);
  expect(result).toMatchObject({
    status: "RESUMABLE",
    unsignedXdr: d.unsignedXdr,
    sourceAccount: account.publicKey(),
    network: "testnet",
  });
  expect(PreparedRecoverySchema.safeParse(result).success).toBe(true);
  expect(getTransaction).not.toHaveBeenCalled();
});
it.each([
  { status: "SUBMITTED", deployTxHash: "a".repeat(64) },
  { serviceState: "RETIRING" },
  { serviceState: "RETIRED" },
  { network: "mainnet" },
  { unsignedXdr: "invalid" },
  { sourceAccount: Keypair.random().publicKey() },
])("guards incompatible preparation %j", async (change) => {
  expect(await preparedDeploymentRecovery({ ...deployment(), ...change })).toEqual({
    status: "BLOCKED",
  });
  expect(getTransaction).not.toHaveBeenCalled();
});
it.each([
  { outcome: "UNRESOLVED", submissionRevision: 1 },
  { outcome: "RECEIVED", submissionRevision: 1 },
  { outcome: "ACCEPTED", submissionRevision: 1 },
  { outcome: "REJECTED", submissionRevision: 1, acceptedAt: new Date() },
  { outcome: "REJECTED", submissionRevision: 1, deploymentId: "different" },
])("never resumes an ambiguous or previously accepted attempt %j", async (change) => {
  signed.mockResolvedValue({
    deploymentId: "deployment-id",
    network: "testnet",
    acceptedAt: null,
    ...change,
  });
  expect(await preparedDeploymentRecovery(deployment())).toEqual({ status: "BLOCKED" });
});
it("resumes an authoritative refusal without preparing another transaction", async () => {
  signed.mockResolvedValue({
    deploymentId: "deployment-id",
    network: "testnet",
    acceptedAt: null,
    outcome: "REJECTED",
    submissionRevision: 1,
  });
  expect(await preparedDeploymentRecovery(deployment())).toMatchObject({ status: "RESUMABLE" });
});
it("permits deliberate replacement only after ledger expiry and rechecking durable evidence", async () => {
  const d = deployment(now - 60);
  current.mockResolvedValue(d);
  expect(await preparedDeploymentRecovery(d)).toMatchObject({
    status: "EXPIRED",
    networkPassphrase: Networks.TESTNET,
  });
  expect(getTransaction).toHaveBeenCalledTimes(2);
  expect(signed).toHaveBeenCalledTimes(2);
});
it.each([now - 240, String(now - 240), String(now - 180), `00${now - 240}`])(
  "proves expiry with supported retention timestamp %j",
  async (oldestLedgerCloseTime) => {
    const d = deployment(now - 60);
    current.mockResolvedValue(d);
    getTransaction.mockResolvedValue({
      status: "NOT_FOUND",
      oldestLedger: 100,
      oldestLedgerCloseTime,
      latestLedger: 123,
    });
    expect(await preparedDeploymentRecovery(d)).toMatchObject({ status: "EXPIRED" });
    const hash = TransactionBuilder.fromXDR(d.unsignedXdr, Networks.TESTNET).hash().toString("hex");
    expect(getTransaction).toHaveBeenNthCalledWith(1, hash);
    expect(getTransaction).toHaveBeenNthCalledWith(2, hash);
    expect(signed).toHaveBeenCalledTimes(2);
  },
);
const invalidRetentionTimes: unknown[] = [
  undefined,
  null,
  true,
  false,
  {},
  [],
  [now - 240],
  1n,
  "",
  " ",
  "0",
  0,
  "-1",
  -1,
  "1.5",
  1.5,
  ` ${now - 240}`,
  `${now - 240} `,
  `${now - 240}\n`,
  `${now - 240}\r`,
  `+${now - 240}`,
  "1e3",
  "0x10",
  "Infinity",
  Number.POSITIVE_INFINITY,
  Number.NaN,
  "9007199254740992",
  Number.MAX_SAFE_INTEGER + 1,
];
for (const read of ["initial", "final"] as const) {
  it.each(invalidRetentionTimes)(
    `blocks expiry on malformed ${read} retention timestamp %s`,
    async (oldestLedgerCloseTime) => {
      const d = deployment(now - 60);
      current.mockResolvedValue(d);
      const result = {
        status: "NOT_FOUND",
        oldestLedger: 100,
        oldestLedgerCloseTime,
        latestLedger: 123,
      };
      if (read === "initial") getTransaction.mockResolvedValueOnce(result);
      else
        getTransaction
          .mockResolvedValueOnce({ ...result, oldestLedgerCloseTime: String(now - 240) })
          .mockResolvedValueOnce(result);
      expect(await preparedDeploymentRecovery(d)).toEqual({ status: "BLOCKED" });
      expect(getTransaction).toHaveBeenCalledTimes(read === "initial" ? 1 : 2);
      if (read === "initial") expect(getLatestLedger).not.toHaveBeenCalled();
      expect(current).not.toHaveBeenCalled();
    },
  );
}
it.each(["old-ledger", "rpc-failure", "success", "concurrent-submit", "concurrent-ambiguity"])(
  "retains the expired preparation guard on %s",
  async (failure) => {
    const d = deployment(now - 60);
    current.mockResolvedValue(d);
    if (failure === "old-ledger")
      getLedgers.mockResolvedValue({
        ledgers: [{ sequence: 123, ledgerCloseTime: String(now - 120) }],
      });
    if (failure === "rpc-failure") getLatestLedger.mockRejectedValue(new Error("RPC unavailable"));
    if (failure === "success")
      getTransaction
        .mockResolvedValueOnce({
          status: "NOT_FOUND",
          oldestLedger: 100,
          oldestLedgerCloseTime: String(now - 240),
          latestLedger: 123,
        })
        .mockResolvedValueOnce({ status: "SUCCESS" });
    if (failure === "concurrent-submit")
      current.mockResolvedValue({ ...d, status: "SUBMITTED", deployTxHash: "a".repeat(64) });
    if (failure === "concurrent-ambiguity")
      signed.mockResolvedValueOnce(null).mockResolvedValueOnce({
        deploymentId: d.id,
        network: "testnet",
        outcome: "UNRESOLVED",
        submissionRevision: 1,
      });
    expect(await preparedDeploymentRecovery(d)).toEqual({ status: "BLOCKED" });
  },
);
it("rejects malformed recovery metadata", () => {
  expect(
    PreparedRecoverySchema.safeParse({
      status: "RESUMABLE",
      unsignedXdr: "short",
      txHash: "wrong",
      sourceAccount: "wrong",
      network: "testnet",
    }).success,
  ).toBe(false);
});

it.each([
  {},
  { oldestLedger: 100, oldestLedgerCloseTime: String(now - 120), latestLedger: 123 },
  { oldestLedger: 100, oldestLedgerCloseTime: String(now - 240), latestLedger: 122 },
  { oldestLedger: 0, oldestLedgerCloseTime: String(now - 240), latestLedger: 123 },
  { oldestLedger: 100, oldestLedgerCloseTime: Number.NaN, latestLedger: 123 },
])("blocks expiry without complete available history %j", async (history) => {
  const d = deployment(now - 60);
  current.mockResolvedValue(d);
  getTransaction.mockResolvedValue({ status: "NOT_FOUND", ...history });
  expect(await preparedDeploymentRecovery(d)).toEqual({ status: "BLOCKED" });
});
it("blocks expiry if history is evicted between the two exact-hash reads", async () => {
  const d = deployment(now - 60);
  current.mockResolvedValue(d);
  getTransaction
    .mockResolvedValueOnce({
      status: "NOT_FOUND",
      oldestLedger: 100,
      oldestLedgerCloseTime: String(now - 240),
      latestLedger: 123,
    })
    .mockResolvedValueOnce({
      status: "NOT_FOUND",
      oldestLedger: 120,
      oldestLedgerCloseTime: String(now - 90),
      latestLedger: 123,
    });
  expect(await preparedDeploymentRecovery(d)).toEqual({ status: "BLOCKED" });
});
it("rejects bare expiry and missing server network metadata", () => {
  expect(PreparedRecoverySchema.safeParse({ status: "EXPIRED" }).success).toBe(false);
  expect(
    PreparedRecoverySchema.safeParse({
      status: "RESUMABLE",
      unsignedXdr: deployment().unsignedXdr,
      txHash: "a".repeat(64),
      sourceAccount: account.publicKey(),
      network: "testnet",
    }).success,
  ).toBe(false);
});

it.each([
  { flow: { templateKind: "PAYROLL" } },
  { graphSnapshot: { nodes: [{ type: "payroll" }] } },
  { paramsSnapshot: [{ params: { kind: "payroll_trigger" } }] },
  { pipelineSnapshot: [{ templateKind: "PAYROLL" }] },
])("never advertises signing recovery for retained payroll %j", async (recorded) => {
  expect(await preparedDeploymentRecovery({ ...deployment(), ...recorded })).toEqual({
    status: "BLOCKED",
  });
  expect(signed).not.toHaveBeenCalled();
  expect(getTransaction).not.toHaveBeenCalled();
  expect(getLatestLedger).not.toHaveBeenCalled();
});
