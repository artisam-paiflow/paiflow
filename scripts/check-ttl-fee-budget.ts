/** Real Postgres concurrency verification. Refuses any database except local ttl804. */
import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { Keypair } from "@stellar/stellar-sdk";
import { env } from "@/lib/env";

async function main() {
  const config = env();
  const url = new URL(config.DATABASE_URL);
  if (
    config.NODE_ENV !== "test" ||
    config.STELLAR_NETWORK !== "testnet" ||
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    url.pathname !== "/ttl804"
  ) {
    throw new Error("Verification requires NODE_ENV=test and the isolated local ttl804 database");
  }
  const [output] = process.argv.slice(2);
  if (!output) throw new Error("Output file required");
  const { db } = await import("@/lib/db");
  const { reserveTransactionFee, claimFixtureSetup } = await import("@/lib/stellar/fee-budget");
  const payer = Keypair.random().publicKey();
  const budget = { name: `verify-${randomBytes(8).toString("hex")}`, limitStroops: "1500000000" };
  const item = {
    network: "testnet" as const,
    budget,
    payer,
    purpose: "fixture-setup" as const,
    declaredFeeStroops: "500000000",
  };
  try {
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        reserveTransactionFee({ ...item, txHash: randomBytes(32).toString("hex") }),
      ),
    );
    const row = await db.transactionFeeBudget.findUniqueOrThrow({
      where: { network_name: { network: "testnet", name: budget.name } },
    });
    const reservations = await db.transactionFeeReservation.findMany({
      where: { network: "testnet", budgetName: budget.name },
    });
    const sum = reservations.reduce((total, r) => total + BigInt(r.declaredFeeStroops), 0n);
    const successes = results.filter((r) => r.status === "fulfilled").length;
    if (
      successes !== 3 ||
      reservations.length !== 3 ||
      sum !== 1_500_000_000n ||
      row.committedStroops !== sum.toString()
    )
      throw new Error("Concurrent ceiling verification failed");
    await db.$disconnect();
    let persistedCeilingRejected = false;
    try {
      await reserveTransactionFee({
        ...item,
        txHash: randomBytes(32).toString("hex"),
        declaredFeeStroops: "1",
      });
    } catch {
      persistedCeilingRejected = true;
    }
    if (!persistedCeilingRejected) throw new Error("Persisted ceiling was reset");

    const duplicateBudget = { name: `${budget.name}-duplicate`, limitStroops: "1500000000" };
    const duplicate = { ...item, budget: duplicateBudget, txHash: randomBytes(32).toString("hex") };
    await reserveTransactionFee(duplicate);
    let duplicateRejected = false;
    try {
      await reserveTransactionFee(duplicate);
    } catch {
      duplicateRejected = true;
    }
    const duplicateRow = await db.transactionFeeBudget.findUniqueOrThrow({
      where: { network_name: { network: "testnet", name: duplicateBudget.name } },
    });
    if (!duplicateRejected || duplicateRow.committedStroops !== "500000000")
      throw new Error("Duplicate rollback failed");
    let changedLimitRejected = false;
    try {
      await reserveTransactionFee({
        ...duplicate,
        txHash: randomBytes(32).toString("hex"),
        budget: { ...duplicateBudget, limitStroops: "1600000000" },
      });
    } catch {
      changedLimitRejected = true;
    }
    if (!changedLimitRejected) throw new Error("Existing limit was changed");
    const auditCount = await db.auditLog.count({
      where: {
        action: "TRANSACTION_FEE_RESERVED",
        metadata: { path: ["budgetName"], equals: budget.name },
      },
    });
    if (auditCount !== 3) throw new Error("Atomic reservation audit mismatch");
    const setupBudget = { name: `${budget.name}-setup`, limitStroops: budget.limitStroops };
    await db.transactionFeeBudget.create({ data: { network: "testnet", ...setupBudget } });
    const setupResults = await Promise.allSettled(
      Array.from({ length: 20 }, () => claimFixtureSetup(setupBudget)),
    );
    const setupAccepted = setupResults.filter((r) => r.status === "fulfilled").length;
    const setupRow = await db.transactionFeeBudget.findUniqueOrThrow({
      where: { network_name: { network: "testnet", name: setupBudget.name } },
    });
    if (setupAccepted !== 1 || !setupRow.fixtureSetupClaimedAt || setupRow.committedStroops !== "0")
      throw new Error("Atomic setup claim verification failed");
    await db.$disconnect();
    let persistedSetupClaimRejected = false;
    try {
      await claimFixtureSetup(setupBudget);
    } catch {
      persistedSetupClaimRejected = true;
    }
    if (!persistedSetupClaimRejected) throw new Error("Setup claim did not survive reconnect");
    const setupAuditCount = await db.auditLog.count({
      where: {
        action: "TTL_FIXTURE_SETUP_CLAIMED",
        metadata: { path: ["budgetName"], equals: setupBudget.name },
      },
    });
    if (setupAuditCount !== 1) throw new Error("Setup claim audit mismatch");
    const evidence = {
      environment: "isolated-local-postgres",
      at: new Date().toISOString(),
      concurrentAttempts: 20,
      accepted: successes,
      rejected: 20 - successes,
      limitStroops: budget.limitStroops,
      committedStroops: row.committedStroops,
      reservationSumStroops: sum.toString(),
      persistedCeilingRejected,
      duplicateRejected,
      duplicateRollbackCommittedStroops: duplicateRow.committedStroops,
      changedLimitRejected,
      auditCount,
      setupClaims: {
        concurrentAttempts: 20,
        accepted: setupAccepted,
        rejected: 20 - setupAccepted,
        persistedSetupClaimRejected,
        committedStroops: setupRow.committedStroops,
        auditCount: setupAuditCount,
      },
      networkSubmissions: 0,
    };
    await writeFile(output, JSON.stringify(evidence, null, 2) + "\n");
    process.stdout.write(JSON.stringify(evidence) + "\n");
  } finally {
    await db.$disconnect();
  }
}

main().catch(() => {
  process.stderr.write("Local TTL fee-budget verification failed; raw errors suppressed.\n");
  process.exitCode = 1;
});
