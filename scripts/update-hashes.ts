#!/usr/bin/env tsx
import { resolve } from "node:path";
import { config } from "dotenv";
import { PrismaClient, TemplateKind } from "@prisma/client";

const db = new PrismaClient();

config({ path: resolve(".env.local") });

async function update() {
  const network = process.env.STELLAR_NETWORK ?? "testnet";
  const templates = [
    { kind: TemplateKind.SPLITTER, envKey: "STELLAR_WASM_HASH_SPLITTER" },
    { kind: TemplateKind.STREAMER, envKey: "STELLAR_WASM_HASH_STREAMER" },
    { kind: TemplateKind.CONDITIONAL, envKey: "STELLAR_WASM_HASH_CONDITIONAL" },
  ];

  for (const t of templates) {
    const hash = process.env[t.envKey];
    if (!hash) {
      console.log(`${t.envKey} not set, skipping`);
      continue;
    }

    const result = await db.contractTemplate.upsert({
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
