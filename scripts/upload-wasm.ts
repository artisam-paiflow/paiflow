#!/usr/bin/env tsx
/**
 * Uploads all Soroban WASM artifacts found in the release directory to the
 * specified network and appends their hashes to .env.local under per-network
 * env-var names (STELLAR_WASM_HASH_<KIND>_<TESTNET|MAINNET>).
 * Run after `pnpm contracts:build`.
 *
 * Usage:
 *   pnpm contracts:upload
 *   pnpm contracts:upload --network=testnet
 *   pnpm contracts:upload --network=mainnet
 */
import "dotenv/config";
import { readFileSync, existsSync, appendFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  BASE_FEE,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  rpc,
  hash,
} from "@stellar/stellar-sdk";

const WASM_DIR = "contracts/target/wasm32v1-none/release";

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

async function main() {
  const network = parseNetworkFlag();
  const rpcUrl = getRpcUrl(network);
  const passphrase = getPassphrase(network);
  const uploaderSecret = process.env.UPLOADER_SECRET;

  if (!uploaderSecret) throw new Error("UPLOADER_SECRET env var is required");

  console.log(`[upload] network=${network} rpc=${rpcUrl}`);

  if (!existsSync(WASM_DIR)) {
    console.error(`[upload] Missing directory: ${WASM_DIR}. Did you run pnpm contracts:build?`);
    process.exit(1);
  }

  const files = readdirSync(WASM_DIR).filter((file) => file.endsWith(".wasm"));
  if (files.length === 0) {
    console.error(`[upload] No .wasm files found in ${WASM_DIR}`);
    process.exit(1);
  }

  const contracts = files.map((file) => {
    const baseName = file.replace(".wasm", "");
    const kind = baseName.includes("_")
      ? baseName.split("_").pop()!.toUpperCase()
      : baseName.toUpperCase();
    return { kind, path: resolve(WASM_DIR, file) };
  });

  const server = new rpc.Server(rpcUrl, { allowHttp: false });
  const kp = Keypair.fromSecret(uploaderSecret);
  const lines: string[] = [];
  const suffix = network.toUpperCase();

  const account = await server.getAccount(kp.publicKey());

  for (const c of contracts) {
    const wasm = readFileSync(c.path);
    const op = Operation.uploadContractWasm({ wasm });

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
    let finalised = false;

    while (attempts++ < 20) {
      const got = await server.getTransaction(send.hash);

      if (got.status === rpc.Api.GetTransactionStatus.SUCCESS) {
        finalised = true;
        break;
      }

      if (got.status === rpc.Api.GetTransactionStatus.FAILED) {
        throw new Error(`transaction failed for ${c.kind}: ${JSON.stringify(got)}`);
      }

      await new Promise((r) => setTimeout(r, 1500));
    }

    if (!finalised) {
      throw new Error(`transaction polling timed out for ${c.kind} after 20 attempts`);
    }

    const wasmHash = hash(wasm).toString("hex");
    console.log(`[upload] ${c.kind}@${network} uploaded, hash=${wasmHash}`);
    lines.push(`STELLAR_WASM_HASH_${c.kind}_${suffix}=${wasmHash}`);
  }

  appendFileSync(
    ".env.local",
    `\n# uploaded ${network} ${new Date().toISOString()}\n${lines.join("\n")}\n`,
  );
  console.log(`[upload] done — ${network} hashes written to .env.local`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
