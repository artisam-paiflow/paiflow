import "server-only";
import { db } from "@/lib/db";
import { stellarRelayerAddress, stellarPassphrase } from "@/lib/env";
import { sorobanRpc } from "@/lib/stellar/client";
import { measureSorobanTransactionFee } from "@/lib/stellar/ttl-fee-measurements";
import {
  assertTtlRehearsalEnvironment,
  TTL_REHEARSAL,
  TtlRecoveryFixtureSchema,
  readTtlFixtureInstances,
  readTtlFixtureTokenBalances,
  submitTtlFixtureEscrow,
  type TtlFixtureTransactionRecord,
  type TtlFixtureTransactionOutcome,
} from "@/lib/stellar/ttl-rehearsal";

type RecordedTransaction =
  | (TtlFixtureTransactionRecord & { status: "RESERVED" })
  | (TtlFixtureTransactionOutcome & {
      fees?: Awaited<ReturnType<typeof measureSorobanTransactionFee>>;
    });

export type TtlRecoveryReport = {
  environment: "hackathon-testing";
  network: "TESTNET";
  at: string;
  phase:
    | "awaiting-natural-expiry"
    | "expired-awaiting-execution"
    | "reserved-reconcile-before-retry"
    | "restoration-confirmed"
    | "restoration-failed"
    | "payment-confirmed-awaiting-verification"
    | "payment-failed"
    | "payment-confirmed-verification-failed"
    | "payment-confirmed-review-transaction-metadata"
    | "incomplete-reconcile-before-any-retry";
  before: Awaited<ReturnType<typeof readTtlFixtureInstances>>;
  after?: Awaited<ReturnType<typeof readTtlFixtureInstances>>;
  balancesBeforeStroops?: Record<string, string>;
  balancesAfterStroops?: Record<string, string>;
  // Unknown while any reserved attempt lacks finality; never guess zero.
  networkSubmissions: number | null;
  confirmedTransactions: number;
  transactions: RecordedTransaction[];
  verification: "not-started" | "passed" | "failed";
  error?: string;
};

/** All public outcomes are journaled before fee measurement or post-payment reads. */
export async function recoverTtlFixture(
  input: unknown,
  execute: boolean,
  save: (report: TtlRecoveryReport) => Promise<void>,
): Promise<TtlRecoveryReport> {
  assertTtlRehearsalEnvironment();
  const fixture = TtlRecoveryFixtureSchema.parse(input);
  if (fixture.relayer !== stellarRelayerAddress())
    throw new Error("Fixture relayer differs from this environment");
  const webhook = fixture.pipeline.find((n) => n.nodeId === "webhook")!.contractAddress;
  const pay = fixture.pipeline.find((n) => n.nodeId === "pay")!.contractAddress;
  const addresses = [webhook, pay];
  const before = await readTtlFixtureInstances(addresses);
  for (const row of before) {
    const saved = fixture.instances.find((i) => i.address === row.address)!;
    if (row.valueSha256 !== saved.valueSha256 || row.wasmHash !== saved.wasmHash)
      throw new Error("Fixture config changed");
  }
  const expired = before.every(
    (row) => row.liveUntilLedger !== undefined && row.liveUntilLedger < row.latestLedger,
  );
  const report: TtlRecoveryReport = {
    environment: "hackathon-testing",
    network: "TESTNET",
    at: new Date().toISOString(),
    phase: expired ? "expired-awaiting-execution" : "awaiting-natural-expiry",
    before,
    networkSubmissions: 0,
    confirmedTransactions: 0,
    transactions: [],
    verification: "not-started",
  };
  await save(report);
  if (!execute || !expired) return report;

  const recordTransaction = async (row: RecordedTransaction) => {
    const index = report.transactions.findIndex((item) => item.hash === row.hash);
    if (index < 0) report.transactions.push({ ...row });
    else report.transactions[index] = { ...row };
    report.confirmedTransactions = report.transactions.filter(
      (item) => item.status !== "RESERVED",
    ).length;
    report.networkSubmissions = report.transactions.some((item) => item.status === "RESERVED")
      ? null
      : report.confirmedTransactions;
    await save(report);
  };
  try {
    const previous = await db.transactionFeeReservation.findFirst({
      where: {
        network: "testnet",
        budgetName: TTL_REHEARSAL.budget.name,
        purpose: "fixture-payment",
      },
    });
    if (previous)
      throw new Error("A fixture payment is already reserved; reconcile rather than repeat");
    const balancesBefore = await readTtlFixtureTokenBalances(fixture.admin, [
      ...addresses,
      fixture.recipient,
    ]);
    if (balancesBefore[webhook] !== TTL_REHEARSAL.paymentStroops || balancesBefore[pay] !== "0")
      throw new Error("Expected exactly one funded fixture payment");
    report.balancesBeforeStroops = balancesBefore;
    const paid = await submitTtlFixtureEscrow(webhook, {
      beforeSend: async (row) => {
        report.phase = "reserved-reconcile-before-retry";
        await recordTransaction({ ...row, status: "RESERVED" });
      },
      onFinality: async (outcome) => {
        report.phase =
          outcome.purpose === "fixture-payment"
            ? outcome.status === "SUCCESS"
              ? "payment-confirmed-awaiting-verification"
              : "payment-failed"
            : outcome.status === "SUCCESS"
              ? "restoration-confirmed"
              : "restoration-failed";
        await recordTransaction(outcome);
      },
    });
    await recordTransaction(paid);
    for (const row of report.transactions) {
      if (row.purpose === "ttl-restoration" && row.status === "SUCCESS") {
        row.fees = await measureSorobanTransactionFee(sorobanRpc(), row.hash, stellarPassphrase());
        await save(report);
      }
    }
    const after = await readTtlFixtureInstances(addresses);
    report.after = after;
    for (const row of after) {
      const saved = fixture.instances.find((i) => i.address === row.address)!;
      if (
        row.valueSha256 !== saved.valueSha256 ||
        row.wasmHash !== saved.wasmHash ||
        row.liveUntilLedger === undefined ||
        row.liveUntilLedger <= row.latestLedger
      )
        throw new Error("Restored config/lifetime mismatch");
    }
    const balancesAfter = await readTtlFixtureTokenBalances(fixture.admin, [
      ...addresses,
      fixture.recipient,
    ]);
    report.balancesAfterStroops = balancesAfter;
    if (
      balancesAfter[webhook] !== "0" ||
      balancesAfter[pay] !== "0" ||
      BigInt(balancesAfter[fixture.recipient]!) - BigInt(balancesBefore[fixture.recipient]!) !==
        BigInt(TTL_REHEARSAL.paymentStroops)
    )
      throw new Error("Downstream payment or residual mismatch");
    report.verification = "passed";
    report.phase = "payment-confirmed-review-transaction-metadata";
    await save(report);
    return report;
  } catch (error) {
    const paid = report.transactions.some(
      (row) => row.purpose === "fixture-payment" && row.status === "SUCCESS",
    );
    if (paid) {
      report.phase = "payment-confirmed-verification-failed";
      report.verification = "failed";
      report.error =
        "Verification or fee measurement failed after confirmed payment; do not retry.";
    } else {
      if (!report.transactions.some((row) => row.status === "FAILED"))
        report.phase = "incomplete-reconcile-before-any-retry";
      report.error = "Recovery incomplete; reconcile recorded transactions without retrying.";
    }
    await save(report);
    throw error;
  }
}
