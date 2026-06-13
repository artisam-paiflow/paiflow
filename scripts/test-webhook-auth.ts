#!/usr/bin/env tsx
import { resolve } from "node:path";
import { config } from "dotenv";
config({ path: resolve(".env.local") });

import {
  Keypair,
  Address,
  xdr,
  TransactionBuilder,
  Operation,
  nativeToScVal,
  authorizeEntry,
  StrKey,
  rpc,
} from "@stellar/stellar-sdk";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

function decodeContractAddress(addr: string): Buffer {
  if (StrKey.isValidContract(addr)) {
    return StrKey.decodeContract(addr);
  }
  const raw = Buffer.from(addr, "base64");
  if (raw.length === 32) {
    return raw;
  }
  throw new Error(`Invalid contract address: ${addr}`);
}

function stellarPassphrase(): string {
  const network = process.env.STELLAR_NETWORK ?? "testnet";
  return network === "mainnet"
    ? "Public Global Stellar Network ; September 2015"
    : "Test SDF Network ; September 2015";
}

function stellarRpcUrl(): string {
  const network = process.env.STELLAR_NETWORK ?? "testnet";
  return network === "mainnet"
    ? "https://soroban-rpc.mainnet.stellar.org"
    : "https://soroban-testnet.stellar.org";
}

async function main() {
  const deploymentId = process.argv[2];
  const webhookSecret = process.argv[3];
  if (!deploymentId || !webhookSecret) {
    console.error("Usage: tsx scripts/test-webhook-auth.ts <deploymentId> <webhookSecret>");
    process.exit(1);
  }

  const deployment = await db.deployment.findUnique({
    where: { id: deploymentId },
    select: { contractAddress: true, network: true },
  });
  if (!deployment?.contractAddress) {
    throw new Error("Deployment not found or missing contract address");
  }

  // 1. Generate a test keypair to act as `from`
  const kp = Keypair.random();
  const from = kp.publicKey();
  console.log("Test keypair created:", from);

  // 2. Fund it on testnet
  const friendbotRes = await fetch(`https://friendbot.stellar.org?addr=${from}`);
  if (!friendbotRes.ok) {
    console.error("Friendbot funding failed:", await friendbotRes.text());
  } else {
    console.log("Funded via friendbot");
  }

  // 3. Build the same invocation the backend would build
  const relayerAddress = process.env.STELLAR_RELAYER_ADDRESS!;
  const contractAddress = deployment.contractAddress;
  const amount = "10000000";

  const server = new rpc.Server(stellarRpcUrl(), { allowHttp: false });
  const sourceAcct = await server.getAccount(relayerAddress);

  const contractIdBytes = decodeContractAddress(contractAddress);
  const scAddress = xdr.ScAddress.scAddressTypeContract(contractIdBytes as unknown as xdr.Hash);
  const fromScVal = new Address(from).toScVal();
  const amountScVal = nativeToScVal(BigInt(amount), { type: "i128" });

  const hostFunction = xdr.HostFunction.hostFunctionTypeInvokeContract(
    new xdr.InvokeContractArgs({
      contractAddress: scAddress,
      functionName: "execute",
      args: [fromScVal, amountScVal],
    }),
  );

  const op = Operation.invokeHostFunction({ func: hostFunction });
  const tx = new TransactionBuilder(sourceAcct, {
    fee: "100000",
    networkPassphrase: stellarPassphrase(),
  })
    .addOperation(op)
    .setTimeout(180)
    .build();

  // 4. Simulate to get required auth entries
  const sim = await server.simulateTransaction(tx);
  if ("error" in sim) {
    console.error("Simulation failed:", sim.error);
    process.exit(1);
  }

  const authEntries = (sim as any).result?.auth ?? [];
  if (authEntries.length === 0) {
    console.error("No auth entries required — maybe the contract still uses old code?");
    process.exit(1);
  }

  console.log(`Simulation returned ${authEntries.length} auth entry(s) to sign`);

  // 5. Sign each auth entry
  const ledger = await server.getLatestLedger();
  const validUntil = ledger.sequence + 100;

  const signedEntries: string[] = [];
  for (const entry of authEntries) {
    const signed = await authorizeEntry(entry, kp, validUntil, stellarPassphrase());
    signedEntries.push(signed.toXDR("base64"));
  }

  console.log("Signed auth entries");

  // 6. POST to the webhook with signed auth
  const webhookRes = await fetch(`http://localhost:3000/api/webhooks/${deploymentId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Webhook-Secret": webhookSecret,
    },
    body: JSON.stringify({ from, amount, auth: signedEntries }),
  });

  const body = await webhookRes.json();
  console.log("Webhook response:", webhookRes.status, JSON.stringify(body, null, 2));

  await db.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
