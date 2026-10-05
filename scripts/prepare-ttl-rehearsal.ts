/**
 * #804 disposable Webhook v2 -> Pay v4 fixture, using existing uploaded WASM.
 * Run only with hackathon-testing variables and its public PostgreSQL URL.
 * Creates/funds disposable accounts, deploys through the existing factory,
 * and escrows 1 test XLM. It never changes shared hashes, enables maintenance,
 * registers DB deployments, invokes payments, or writes private keys.
 * pnpm exec tsx --conditions=react-server scripts/prepare-ttl-rehearsal.ts OUTPUT.json
 */
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Keypair, TransactionBuilder } from "@stellar/stellar-sdk";
import { config } from "dotenv";
import { env, stellarPassphrase, stellarRelayerAddress } from "@/lib/env";

async function main() {
  config({ path: resolve(".env.local") });
  config({ path: resolve(".env") });
  const { db } = await import("@/lib/db");
  const { log } = await import("@/lib/log");
  const {
    assertTtlRehearsalEnvironment,
    TTL_REHEARSAL,
    ttlRehearsalGraph,
    readTtlFixtureInstances,
    readTtlFixtureTokenBalances,
    readTtlFixtureAccount,
    prepareTtlFixtureDeposit,
    submitTtlFixtureTransaction,
  } = await import("@/lib/stellar/ttl-rehearsal");
  const { preparePipelineDeployTx } = await import("@/lib/stellar/deploy");
  const { flowToPipeline } = await import("@/lib/flows/to-params");
  const { claimFixtureSetup } = await import("@/lib/stellar/fee-budget");
  assertTtlRehearsalEnvironment();
  const [output] = process.argv.slice(2);
  if (!output || process.argv.length !== 3) throw new Error("Exactly one new output path required");
  const relayer = stellarRelayerAddress();
  if (!relayer) throw new Error("Relayer public address required");
  const admin = Keypair.random();
  const recipient = Keypair.random().publicKey();
  const graph = ttlRehearsalGraph(recipient, relayer);
  const transactions: Array<{
    hash: string;
    declaredFeeStroops: string;
    purpose: string;
    netFeeStroops?: string;
    ledger?: number;
  }> = [];
  const manifest: Record<string, unknown> = {
    environment: env().RAILWAY_ENVIRONMENT_NAME,
    network: "TESTNET",
    createdAt: new Date().toISOString(),
    budget: TTL_REHEARSAL.budget,
    maxFeeStroops: TTL_REHEARSAL.maxFeeStroops,
    admin: admin.publicKey(),
    recipient,
    relayer,
    graph,
    transactions,
    phase: "preparing",
    registeredForMaintenance: false,
    limitations: [
      "Fixture setup is preparation, not recovery/payment evidence.",
      "No DB deployment is registered, so background maintenance will not renew these instances.",
      "Admin private key is disposable and is not persisted; the existing relayer can later release escrow.",
    ],
  };
  await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  const save = async () =>
    writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  const beforeSend = async (row: (typeof transactions)[number]) => {
    transactions.push(row);
    await save();
  };
  try {
    await claimFixtureSetup(TTL_REHEARSAL.budget);
    manifest.setupClaimed = true;
    await save();
    for (const address of [admin.publicKey(), recipient]) {
      const res = await fetch(`https://friendbot.stellar.org?addr=${address}`);
      if (!res.ok) throw new Error("Fixture Friendbot funding failed");
    }
    manifest.friendbotFunded = true;
    const payerBefore = await readTtlFixtureAccount(admin.publicKey());
    manifest.payerBefore = payerBefore;
    await save();
    const nodes = flowToPipeline(graph, relayer, undefined, {
      ownerAddress: admin.publicKey(),
    }).map((node) => {
      if (node.templateKind !== "WEBHOOK" && node.templateKind !== "PAYER")
        throw new Error("Unexpected fixture contract");
      return { ...node, wasmHash: TTL_REHEARSAL.wasm[node.templateKind] };
    });
    const prepared = await preparePipelineDeployTx({
      sourceAccount: admin.publicKey(),
      graph,
      nodes,
    });
    manifest.pipeline = prepared.pipeline.map(({ salt: _salt, ...node }) => node);
    await save();
    const deployed = await submitTtlFixtureTransaction(
      TransactionBuilder.fromXDR(
        prepared.xdr,
        stellarPassphrase(),
      ) as import("@stellar/stellar-sdk").Transaction,
      admin,
      "fixture-setup",
      beforeSend,
    );
    Object.assign(transactions[transactions.length - 1]!, deployed);
    const webhook = prepared.pipeline.find((node) => node.nodeId === "webhook")!.contractAddress;
    const pay = prepared.pipeline.find((node) => node.nodeId === "pay")!.contractAddress;
    const deposit = await submitTtlFixtureTransaction(
      await prepareTtlFixtureDeposit(admin.publicKey(), webhook),
      admin,
      "fixture-deposit",
      beforeSend,
    );
    Object.assign(transactions[transactions.length - 1]!, deposit);
    manifest.instances = await readTtlFixtureInstances([webhook, pay]);
    const balances = await readTtlFixtureTokenBalances(admin.publicKey(), [
      webhook,
      pay,
      recipient,
    ]);
    if (balances[webhook] !== TTL_REHEARSAL.paymentStroops || balances[pay] !== "0")
      throw new Error("Fixture escrow balances mismatch");
    manifest.balancesStroops = balances;
    const payerAfter = await readTtlFixtureAccount(admin.publicKey());
    const declared = BigInt(deployed.declaredFeeStroops) + BigInt(deposit.declaredFeeStroops);
    const net = BigInt(deployed.netFeeStroops) + BigInt(deposit.netFeeStroops);
    if (
      BigInt(payerBefore.balanceStroops) - BigInt(payerAfter.balanceStroops) !==
        net + BigInt(TTL_REHEARSAL.paymentStroops) ||
      BigInt(payerAfter.sequence) - BigInt(payerBefore.sequence) !== 2n
    )
      throw new Error("Fixture payer fees, deposit or sequence do not reconcile");
    manifest.payerAfter = payerAfter;
    manifest.setupFees = { declaredFeeStroops: declared.toString(), netFeeStroops: net.toString() };
    manifest.phase = "awaiting-natural-expiry";
    await save();
    log.info(
      { transactions: transactions.length },
      "TTL recovery fixture prepared; no payment invoked",
    );
  } catch {
    manifest.phase = "incomplete-reconcile-before-any-retry";
    await save();
    throw new Error(
      "Fixture preparation incomplete; inspect public manifest and reservations without retrying submissions",
    );
  } finally {
    await db.$disconnect();
  }
}

main().catch(() => {
  process.stderr.write(
    "TTL rehearsal fixture preparation failed; raw errors and credentials suppressed.\n",
  );
  process.exitCode = 1;
});
