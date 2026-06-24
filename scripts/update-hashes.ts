#!/usr/bin/env tsx
import { resolve } from "node:path";
import { config } from "dotenv";
import { PrismaClient, TemplateKind } from "@prisma/client";

const db = new PrismaClient();

config({ path: resolve(".env.local") });

async function update() {
  const network = process.env.STELLAR_NETWORK ?? "testnet";
  const suffix = network.toUpperCase();
  const templates = [
    { kind: TemplateKind.SPLITTER, envKey: `STELLAR_WASM_HASH_SPLITTER_${suffix}` },
    { kind: TemplateKind.STREAMER, envKey: `STELLAR_WASM_HASH_STREAMER_${suffix}` },
    { kind: TemplateKind.CONDITIONAL, envKey: `STELLAR_WASM_HASH_CONDITIONAL_${suffix}` },
    { kind: TemplateKind.DEPOSIT_TRIGGER, envKey: `STELLAR_WASM_HASH_DEPOSIT_TRIGGER_${suffix}` },
    { kind: TemplateKind.ROUTER, envKey: `STELLAR_WASM_HASH_ROUTER_${suffix}` },
    { kind: TemplateKind.TIMELOCK, envKey: `STELLAR_WASM_HASH_TIMELOCK_${suffix}` },
    { kind: TemplateKind.FACTORY, envKey: `STELLAR_WASM_HASH_FACTORY_${suffix}` },
    { kind: TemplateKind.WEBHOOK, envKey: `STELLAR_WASM_HASH_WEBHOOK_${suffix}` },
    { kind: TemplateKind.SUBSCRIPTION, envKey: `STELLAR_WASM_HASH_SUBSCRIPTION_${suffix}` },
    { kind: TemplateKind.ORACLE, envKey: `STELLAR_WASM_HASH_ORACLE_${suffix}` },
    { kind: TemplateKind.MULTISIG, envKey: `STELLAR_WASM_HASH_MULTISIG_${suffix}` },
    { kind: TemplateKind.SWAPPER, envKey: `STELLAR_WASM_HASH_SWAPPER_${suffix}` },
    { kind: TemplateKind.YIELD, envKey: `STELLAR_WASM_HASH_YIELD_${suffix}` },
    { kind: TemplateKind.PAYER, envKey: `STELLAR_WASM_HASH_PAYER_${suffix}` },
    { kind: TemplateKind.PAYROLL, envKey: `STELLAR_WASM_HASH_PAYROLL_${suffix}` },
    { kind: TemplateKind.PAYER_DEV, envKey: `STELLAR_WASM_HASH_PAYER_DEV_${suffix}` },
    { kind: TemplateKind.SPLITTER_DEV, envKey: `STELLAR_WASM_HASH_SPLITTER_DEV_${suffix}` },
    {
      kind: TemplateKind.SUBSCRIPTION_DEV,
      envKey: `STELLAR_WASM_HASH_SUBSCRIPTION_DEV_${suffix}`,
    },
    {
      kind: TemplateKind.CASH_OUT_DEV,
      envKey: `STELLAR_WASM_HASH_CASH_OUT_DEV_${suffix}`,
    },
  ];

  for (const t of templates) {
    const hash = process.env[t.envKey];
    if (!hash) {
      console.log(`${t.envKey} not set, skipping`);
      continue;
    }

    const existing = await db.contractTemplate.findUnique({
      where: { kind_network: { kind: t.kind, network } },
    });

    if (existing?.wasmHash === hash) {
      console.log(`${t.kind} hash unchanged, skipping`);
      continue;
    }

    await db.contractTemplate.upsert({
      where: { kind_network: { kind: t.kind, network } },
      update: { wasmHash: hash },
      create: {
        kind: t.kind,
        network,
        wasmHash: hash,
        // TODO: ABI ingestion — abiJson is empty until ABI extraction lands.
        abiJson: {},
      },
    });
    console.log(`Updated ${t.kind}: ${hash.slice(0, 12)}...`);
  }
}

update()
  .catch(console.error)
  .finally(() => db.$disconnect());
