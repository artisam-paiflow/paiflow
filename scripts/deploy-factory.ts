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
import { TemplateKind } from "@prisma/client";
import { db } from "@/lib/prisma";
import { getFactoryAddressFromDb, setFactoryAddress, setWasmHash } from "@/lib/stellar/template-db";
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

/**
 * An already-deployed factory for this network, from env or the
 * `FactoryDeployment` table, or undefined when neither knows of one.
 *
 * The DB is best-effort: a fresh machine may have no reachable DATABASE_URL,
 * and being unable to ask must mean "deploy", never "crash".
 */
async function findDeployedFactory(
  network: NetworkName,
  addressKey: string,
): Promise<{ address: string; source: "env" | "db"; label: string } | undefined> {
  const fromEnv = process.env[addressKey];
  if (fromEnv) return { address: fromEnv, source: "env", label: addressKey };

  try {
    const fromDb = await getFactoryAddressFromDb(network);
    if (fromDb) return { address: fromDb, source: "db", label: "FactoryDeployment table" };
  } catch (err) {
    console.warn(
      `[deploy-factory] could not read the FactoryDeployment table: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return undefined;
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
    // An unchanged hash does NOT imply a deployed factory: on a fresh
    // environment the upload step wrote this variable seconds ago and no
    // instance exists. Skip only once an address proves one does, or the
    // deploy chain finishes leaving nothing able to deploy (#394).
    const deployed = await findDeployedFactory(network, addressKey);
    if (deployed) {
      console.log(
        `[deploy-factory] factory wasm hash unchanged and ${deployed.address} already deployed (${deployed.label}), skipping deploy`,
      );
      // update-hashes reads the address from process.env alone, so a skip
      // justified by the database has to leave it in .env.local too — without
      // this, the next link in the chain logs "not set, skipping" and a healthy
      // run reads as the failure that line is documented to mean (#404).
      if (deployed.source === "db") {
        writeEnvLocal({ [addressKey]: deployed.address });
        console.log(`[deploy-factory] wrote ${addressKey} to .env.local`);
      }
      return;
    }
    console.log(
      `[deploy-factory] factory wasm hash unchanged but no factory address found in ${addressKey} or the FactoryDeployment table, deploying`,
    );
  } else if (existingHash) {
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

  // Record the address in every store that is reachable before anything throws.
  // The salt is Date.now()-derived, so a rerun that cannot see this address
  // deploys a second factory rather than recovering the first — and on the fresh
  // machine this path serves neither .env.local nor the database may be assumed
  // writable, so a failure of one must not skip the other.
  let persistError: unknown;

  try {
    writeEnvLocal({
      [hashKey]: wasmHash,
      [addressKey]: factoryAddress,
    });
    console.log(`[deploy-factory] wrote ${addressKey} to .env.local`);
  } catch (err) {
    persistError = err;
    console.error(
      `[deploy-factory] deployed ${factoryAddress} but could not write .env.local: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  try {
    await setFactoryAddress(network, factoryAddress, wasmHash);
    await setWasmHash(TemplateKind.FACTORY, network, wasmHash);
  } catch (err) {
    const envLocalHoldsAddress = persistError === undefined;
    persistError ??= err;
    console.error(
      `[deploy-factory] deployed ${factoryAddress} but could not record it in the database: ${err instanceof Error ? err.message : String(err)}. ` +
        (envLocalHoldsAddress
          ? `.env.local holds the address — rerunning will skip rather than deploy again; run pnpm contracts:update-hashes once the database is reachable.`
          : `.env.local could not be written either — set ${addressKey}=${factoryAddress} by hand before rerunning, or the next run deploys a second factory.`),
    );
  }

  // Exit 1 on the first failure: the environment really is incompletely
  // configured, and the && chain must not run update-hashes after it.
  if (persistError) throw persistError;
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
