#!/usr/bin/env tsx
/**
 * Deploys the pipeline factory contract when the locally-built wasm hash differs
 * from the hash stored in .env.local. Writes the deployed address back to
 * .env.local as STELLAR_FACTORY_ADDRESS_<TESTNET|MAINNET>.
 *
 * Usage:
 *   pnpm contracts:deploy-factory
 *   pnpm contracts:deploy-factory --network=testnet
 *   pnpm contracts:deploy-factory --network=mainnet
 */
import { config as dotenvConfig } from "dotenv";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  Address,
  BASE_FEE,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  rpc,
  hash,
  xdr,
} from "@stellar/stellar-sdk";
import { writeEnvLocal } from "./env-file";

const WASM_DIR = "contracts/target/wasm32v1-none/release";
const FACTORY_WASM = "paiflow_factory.wasm";

dotenvConfig({ path: resolve(".env") });
dotenvConfig({ path: resolve(".env.local"), override: true });

type NetworkName = "testnet" | "mainnet";

function parseNetworkFlag(): NetworkName {
  const fromFlag = process.argv
    .slice(2)
    .find((arg) => arg.startsWith("--network="))
    ?.slice("--network=".length);
  const value = fromFlag ?? process.env.STELLAR_NETWORK ?? "testnet";

  if (value !== "testnet" && value !== "mainnet") {
    throw new Error(`Invalid network: ${value}. Only 'testnet' or 'mainnet' are permitted.`);
  }

  return value;
}

function getRpcUrl(network: NetworkName): string {
  if (network === "mainnet") {
    return process.env.STELLAR_SOROBAN_RPC_URL_MAINNET ?? "https://mainnet.sorobanrpc.com";
  }
  return process.env.STELLAR_SOROBAN_RPC_URL_TESTNET ?? "https://soroban-testnet.stellar.org";
}

function getPassphrase(network: NetworkName): string {
  if (network === "mainnet") {
    return process.env.STELLAR_NETWORK_PASSPHRASE_MAINNET ?? Networks.PUBLIC;
  }
  return process.env.STELLAR_NETWORK_PASSPHRASE_TESTNET ?? Networks.TESTNET;
}

function extractContractAddress(returnValue: xdr.ScVal): string {
  if (returnValue.switch().name !== "scvAddress") {
    throw new Error(`Unexpected factory deploy return type: ${returnValue.switch().name}`);
  }
  return Address.fromScAddress(returnValue.address()).toString();
}

async function main() {
  const network = parseNetworkFlag();
  const rpcUrl = getRpcUrl(network);
  const passphrase = getPassphrase(network);
  const uploaderSecret = process.env.UPLOADER_SECRET;

  if (!uploaderSecret) throw new Error("UPLOADER_SECRET env var is required");

  console.log(`[deploy-factory] network=${network} rpc=${rpcUrl}`);

  const wasmPath = resolve(WASM_DIR, FACTORY_WASM);
  if (!existsSync(wasmPath)) {
    console.error(`[deploy-factory] Missing ${wasmPath}. Did you run pnpm contracts:build?`);
    process.exit(1);
  }

  const wasm = readFileSync(wasmPath);
  const wasmHash = hash(wasm).toString("hex");
  const suffix = network.toUpperCase();
  const hashKey = `STELLAR_WASM_HASH_FACTORY_${suffix}`;
  const addressKey = `STELLAR_FACTORY_ADDRESS_${suffix}`;
  const existingHash = process.env[hashKey];

  if (existingHash === wasmHash) {
    console.log(`[deploy-factory] factory wasm hash unchanged, skipping deploy`);
    return;
  }

  if (existingHash) {
    console.log(
      `[deploy-factory] factory wasm hash changed (${existingHash.slice(0, 12)}... -> ${wasmHash.slice(0, 12)}...), deploying`,
    );
  } else {
    console.log(`[deploy-factory] no existing factory hash, deploying`);
  }

  const server = new rpc.Server(rpcUrl, { allowHttp: false });
  const kp = Keypair.fromSecret(uploaderSecret);
  const account = await server.getAccount(kp.publicKey());

  const op = Operation.createCustomContract({
    address: new Address(kp.publicKey()),
    wasmHash: Buffer.from(wasmHash, "hex"),
    salt: Buffer.from(hash(Buffer.from(`${Date.now()}`, "utf8"))).subarray(0, 32),
    constructorArgs: [],
  });

  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: passphrase })
    .addOperation(op)
    .setTimeout(180)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(`simulate failed: ${sim.error}`);

  const prepared = rpc.assembleTransaction(tx, sim).build();
  prepared.sign(kp);

  const send = await server.sendTransaction(prepared);
  if (send.status === "ERROR") throw new Error(`send failed: ${JSON.stringify(send)}`);

  let attempts = 0;
  let result: rpc.Api.GetTransactionResponse | null = null;

  while (attempts++ < 20) {
    result = await server.getTransaction(send.hash);

    if (result.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      break;
    }

    if (result.status === rpc.Api.GetTransactionStatus.FAILED) {
      throw new Error(`factory deployment failed: ${JSON.stringify(result)}`);
    }

    await new Promise((r) => setTimeout(r, 1500));
  }

  if (!result || result.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error("factory deployment polling timed out after 20 attempts");
  }

  if (!result.returnValue) {
    throw new Error("factory deployment succeeded but returned no contract address");
  }

  const factoryAddress = extractContractAddress(result.returnValue);
  console.log(`[deploy-factory] deployed at ${factoryAddress}`);

  writeEnvLocal({
    [hashKey]: wasmHash,
    [addressKey]: factoryAddress,
  });
  console.log(`[deploy-factory] wrote ${addressKey} to .env.local`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
