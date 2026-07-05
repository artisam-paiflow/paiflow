#!/usr/bin/env tsx
/**
 * Uploads Soroban WASM artifacts whose locally-built hash differs from the
 * value already stored in .env.local. Writes updated hashes back to .env.local
 * under per-network env-var names (STELLAR_WASM_HASH_<KIND>_<TESTNET|MAINNET>).
 * Run after `pnpm contracts:build`.
 *
 * Usage:
 *   pnpm contracts:upload
 *   pnpm contracts:upload --network=testnet
 *   pnpm contracts:upload --network=mainnet
 */
import { config as dotenvConfig } from "dotenv";
import { readFileSync, existsSync, readdirSync } from "node:fs";
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
import { TemplateKind } from "@prisma/client";
import { db } from "@/lib/prisma";
import { setWasmHash } from "@/lib/stellar/template-db";
import { writeEnvLocal } from "./env-file";

const WASM_DIR = "contracts/target/wasm32v1-none/release";

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

  const contracts = files
    .map((file) => {
      const baseName = file.replace(".wasm", "");
      const kind = baseName.replace(/^(paiflow_|pinkraft_)/i, "").toUpperCase();
      const templateKind = TemplateKind[kind as keyof typeof TemplateKind];
      return { file, kind, templateKind, path: resolve(WASM_DIR, file) };
    })
    .filter((c) => {
      if (c.templateKind) return true;
      console.warn(`[upload] ${c.file} does not map to a known TemplateKind, skipping`);
      return false;
    });

  const server = new rpc.Server(rpcUrl, { allowHttp: false });
  const kp = Keypair.fromSecret(uploaderSecret);
  const suffix = network.toUpperCase();

  const updates: Record<string, string> = {};
  let account: Awaited<ReturnType<typeof server.getAccount>> | null = null;

  for (const c of contracts) {
    const wasm = readFileSync(c.path);
    const wasmHash = hash(wasm).toString("hex");
    const envKey = `STELLAR_WASM_HASH_${c.kind}_${suffix}`;
    const existingHash = process.env[envKey];

    if (existingHash === wasmHash) {
      console.log(`[upload] ${c.kind} hash unchanged, skipping`);
      continue;
    }

    if (existingHash) {
      console.log(
        `[upload] ${c.kind} hash changed (${existingHash.slice(0, 12)}... -> ${wasmHash.slice(0, 12)}...), uploading`,
      );
    } else {
      console.log(`[upload] ${c.kind} has no existing hash, uploading`);
    }

    if (!account) {
      account = await server.getAccount(kp.publicKey());
    }

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

    console.log(`[upload] ${c.kind}@${network} uploaded, hash=${wasmHash}`);
    updates[envKey] = wasmHash;
    await setWasmHash(c.templateKind, network, wasmHash);
  }

  if (Object.keys(updates).length > 0) {
    writeEnvLocal(updates);
    console.log(`[upload] done — ${network} hashes written to .env.local`);
  } else {
    console.log(`[upload] done — no uploads were needed`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
