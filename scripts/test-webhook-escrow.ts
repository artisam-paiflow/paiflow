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
    console.error("Usage: tsx scripts/test-webhook-escrow.ts <deploymentId> <webhookSecret>");
    process.exit(1);
  }

  const deployment = await db.deployment.findUnique({
    where: { id: deploymentId },
    select: { contractAddress: true, network: true },
  });
  if (!deployment?.contractAddress) {
    throw new Error("Deployment not found or missing contract address");
  }

  // 1. Generate a test keypair
  const kp = Keypair.random();
  const from = kp.publicKey();
  console.log("Test keypair created:", from);

  // 2. Fund it on testnet
  const friendbotRes = await fetch(`https://friendbot.stellar.org?addr=${from}`);
  if (!friendbotRes.ok) {
    console.error("Friendbot funding failed:", await friendbotRes.text());
    process.exit(1);
  }
  console.log("Funded via friendbot");

  const server = new rpc.Server(stellarRpcUrl(), { allowHttp: false });
  const contractAddress = deployment.contractAddress;

  // 3. Query the contract's asset address
  const contractIdBytes = decodeContractAddress(contractAddress);
  const scAddress = xdr.ScAddress.scAddressTypeContract(contractIdBytes as unknown as xdr.Hash);

  const assetHostFunction = xdr.HostFunction.hostFunctionTypeInvokeContract(
    new xdr.InvokeContractArgs({
      contractAddress: scAddress,
      functionName: "asset",
      args: [],
    }),
  );

  const sourceAcct = await server.getAccount(from);
  const assetTx = new TransactionBuilder(sourceAcct, {
    fee: "100000",
    networkPassphrase: stellarPassphrase(),
  })
    .addOperation(Operation.invokeHostFunction({ func: assetHostFunction }))
    .setTimeout(180)
    .build();

  const assetSim = await server.simulateTransaction(assetTx);
  if ("error" in assetSim) {
    console.error("Failed to query contract asset:", assetSim.error);
    process.exit(1);
  }

  const assetScVal = (assetSim as any).result?.retval;
  if (!assetScVal) {
    console.error("No asset returned from contract");
    process.exit(1);
  }

  const assetAddress = Address.fromScVal(assetScVal).toString();
  console.log("Contract asset:", assetAddress);

  // 4. Deposit tokens into the WebhookTrigger contract
  const depositAmount = "10000000"; // 1 XLM in stroops
  const assetScAddress = xdr.ScAddress.scAddressTypeContract(
    decodeContractAddress(assetAddress) as unknown as xdr.Hash,
  );
  const fromScVal = new Address(from).toScVal();
  const contractScVal = new Address(contractAddress).toScVal();
  const depositAmountScVal = nativeToScVal(BigInt(depositAmount), { type: "i128" });

  const depositHostFunction = xdr.HostFunction.hostFunctionTypeInvokeContract(
    new xdr.InvokeContractArgs({
      contractAddress: assetScAddress,
      functionName: "transfer",
      args: [fromScVal, contractScVal, depositAmountScVal],
    }),
  );

  const depositTx = new TransactionBuilder(sourceAcct, {
    fee: "100000",
    networkPassphrase: stellarPassphrase(),
  })
    .addOperation(Operation.invokeHostFunction({ func: depositHostFunction }))
    .setTimeout(180)
    .build();

  const depositSim = await server.simulateTransaction(depositTx);
  if ("error" in depositSim) {
    console.error("Deposit simulation failed:", depositSim.error);
    process.exit(1);
  }

  const depositAssembled = rpc.assembleTransaction(depositTx, depositSim).build();
  depositAssembled.sign(kp);

  const depositSend = await server.sendTransaction(depositAssembled);
  if (depositSend.status === "ERROR") {
    console.error("Deposit failed:", depositSend);
    process.exit(1);
  }
  console.log("Deposited", depositAmount, "stroops into contract. Tx:", depositSend.hash);

  // 5. Call the webhook in escrow mode
  const webhookRes = await fetch(`http://localhost:3000/api/webhooks/${deploymentId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Webhook-Secret": webhookSecret,
    },
    body: JSON.stringify({ amount: depositAmount, escrow: true }),
  });

  const body = await webhookRes.json();
  console.log("Webhook response:", webhookRes.status, JSON.stringify(body, null, 2));

  await db.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
