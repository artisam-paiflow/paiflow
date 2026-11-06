#!/usr/bin/env tsx
/**
 * One-time sync utility: reads the current contract WASM hashes and factory
 * address from .env/.env.local and writes them into the database, overriding
 * any existing rows.
 *
 * Reads STELLAR_NETWORK to pick the *_TESTNET / *_MAINNET suffix, and writes to
 * whatever DATABASE_URL names. Both can be set in the shell to target a
 * deployed environment:
 *
 * Usage:
 *   pnpm contracts:update-hashes
 *   DATABASE_URL="<deployed>" pnpm contracts:update-hashes
 */
import { resolve } from "node:path";
import { config } from "dotenv";
import { TemplateKind } from "@prisma/client";
import { db } from "@/lib/prisma";
import { setFactoryAddress } from "@/lib/stellar/template-db";
import { parseAbiRepair, inspectOrRepairAbi, syncBuiltWasm } from "./registry-abi";
// Neither call overrides, so dotenv's first-write-wins gives shell > .env.local
// > .env. The shell has to win: this script writes to whatever DATABASE_URL
// names, and an operator syncing hashes into a deployed database must not have
// a local .env.local silently redirect every write to their dev Postgres.
config({ path: resolve(".env.local") });
config({ path: resolve(".env") });
async function update() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    process.stdout.write(
      "Default: sync environment hashes; preserve same-hash ABI and refuse hash changes without ABI.\nABI repair: --abi-kind=<KIND> --abi-wasm=<file> --abi-hash=<hash> [--apply]\nRepair targets one existing row and defaults to read-only inspection. Review immutable template ABI pins before --apply.\n",
    );
    return;
  }
  const repair = parseAbiRepair(args);
  const network = process.env.STELLAR_NETWORK ?? "testnet";
  if (network !== "testnet" && network !== "mainnet") throw new Error("Invalid STELLAR_NETWORK");
  if (repair) {
    const abiJson = await inspectOrRepairAbi(repair, network);
    process.stdout.write(
      `${repair.apply ? "Applying" : "Inspecting"} ${repair.kind}@${network}: ${abiJson.specEntriesXdr.length} spec entries for ${repair.wasmHash}\n`,
    );
    return;
  }
  const suffix = network.toUpperCase();
  const templates = [
    { kind: TemplateKind.SPLITTER, envKey: `STELLAR_WASM_HASH_SPLITTER_${suffix}` },
    { kind: TemplateKind.STREAMER, envKey: `STELLAR_WASM_HASH_STREAMER_${suffix}` },
    { kind: TemplateKind.CONDITIONAL, envKey: `STELLAR_WASM_HASH_CONDITIONAL_${suffix}` },
    { kind: TemplateKind.DEPOSIT_TRIGGER, envKey: `STELLAR_WASM_HASH_DEPOSIT_TRIGGER_${suffix}` },
    { kind: TemplateKind.ROUTER, envKey: `STELLAR_WASM_HASH_ROUTER_${suffix}` },
    { kind: TemplateKind.TIMELOCK, envKey: `STELLAR_WASM_HASH_TIMELOCK_${suffix}` },
    { kind: TemplateKind.TIMELOCK_BRANCH, envKey: `STELLAR_WASM_HASH_TIMELOCK_BRANCH_${suffix}` },
    { kind: TemplateKind.FACTORY, envKey: `STELLAR_WASM_HASH_FACTORY_${suffix}` },
    { kind: TemplateKind.WEBHOOK, envKey: `STELLAR_WASM_HASH_WEBHOOK_${suffix}` },
    { kind: TemplateKind.SUBSCRIPTION, envKey: `STELLAR_WASM_HASH_SUBSCRIPTION_${suffix}` },
    { kind: TemplateKind.ORACLE, envKey: `STELLAR_WASM_HASH_ORACLE_${suffix}` },
    { kind: TemplateKind.MULTISIG, envKey: `STELLAR_WASM_HASH_MULTISIG_${suffix}` },
    { kind: TemplateKind.SWAPPER, envKey: `STELLAR_WASM_HASH_SWAPPER_${suffix}` },
    { kind: TemplateKind.YIELD, envKey: `STELLAR_WASM_HASH_YIELD_${suffix}` },
    { kind: TemplateKind.PAYER, envKey: `STELLAR_WASM_HASH_PAYER_${suffix}` },
  ];
  for (const t of templates) {
    const hash = process.env[t.envKey];
    if (!hash) {
      console.log(`${t.envKey} not set, skipping`);
      continue;
    }
    await syncBuiltWasm(t.kind, network, hash);
    console.log(`Synced ${t.kind}: ${hash.slice(0, 12)}...`);
  }
  const factoryAddress = process.env[`STELLAR_FACTORY_ADDRESS_${suffix}`];
  if (factoryAddress) {
    await setFactoryAddress(network, factoryAddress);
    console.log(`Synced factory address: ${factoryAddress}`);
  } else {
    console.log(`STELLAR_FACTORY_ADDRESS_${suffix} not set, skipping`);
  }
}
update()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
