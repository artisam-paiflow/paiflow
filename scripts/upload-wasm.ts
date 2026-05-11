#!/usr/bin/env tsx
/**
 * Uploads the three Soroban WASM artifacts to the configured network and
 * appends their hashes to .env.local. Run after `pnpm contracts:build`.
 *
 * Usage: tsx scripts/upload-wasm.ts
 */
import { readFileSync, existsSync, appendFileSync } from "node:fs";
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

const CONTRACTS = [
  { kind: "SPLITTER", wasm: "contracts/target/wasm32v1-none/release/pinkraft_splitter.wasm" },
  { kind: "STREAMER", wasm: "contracts/target/wasm32v1-none/release/pinkraft_streamer.wasm" },
  {
    kind: "CONDITIONAL",
    wasm: "contracts/target/wasm32v1-none/release/pinkraft_conditional.wasm",
  },
];

async function main() {
  const network = process.env.STELLAR_NETWORK ?? "testnet";
  const rpcUrl =
    network === "mainnet"
      ? process.env.STELLAR_SOROBAN_RPC_URL_MAINNET
      : (process.env.STELLAR_SOROBAN_RPC_URL_TESTNET ?? "https://soroban-testnet.stellar.org");
  const passphrase =
    network === "mainnet" ? Networks.PUBLIC : (process.env.STELLAR_NETWORK_PASSPHRASE_TESTNET ?? Networks.TESTNET);
  const uploaderSecret = process.env.UPLOADER_SECRET;
  if (!uploaderSecret) throw new Error("UPLOADER_SECRET env var is required");

  const server = new rpc.Server(rpcUrl!, { allowHttp: false });
  const kp = Keypair.fromSecret(uploaderSecret);
  const lines: string[] = [];

  for (const c of CONTRACTS) {
    const path = resolve(c.wasm);
    if (!existsSync(path)) {
      console.error(`[upload] missing ${path}; did you run pnpm contracts:build?`);
      process.exit(1);
    }
    const wasm = readFileSync(path);
    const account = await server.getAccount(kp.publicKey());
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
    while (attempts++ < 20) {
      const got = await server.getTransaction(send.hash);
      if (got.status === "SUCCESS") break;
      if (got.status === "FAILED") throw new Error(`tx failed for ${c.kind}`);
      await new Promise((r) => setTimeout(r, 1500));
    }
    const wasmHash = hash(wasm).toString("hex");
    console.log(`[upload] ${c.kind} hash=${wasmHash}`);
    lines.push(`STELLAR_WASM_HASH_${c.kind}=${wasmHash}`);
  }

  appendFileSync(".env.local", `\n# uploaded ${new Date().toISOString()}\n${lines.join("\n")}\n`);
  console.log("[upload] wrote hashes to .env.local");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
