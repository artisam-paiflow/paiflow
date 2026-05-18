#!/usr/bin/env tsx
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient, TemplateKind } from "@prisma/client";

const db = new PrismaClient();

function loadEnvLocal() {
  try {
    const content = readFileSync(resolve(".env.local"), "utf-8");
    const lines = content.split("\n");
    for (const line of lines) {
      const [key, ...valueParts] = line.split("=");
      if (key && key.startsWith("STELLAR_WASM_HASH_") && valueParts.length > 0) {
        process.env[key.trim()] = valueParts.join("=").trim();
      }
    }
  } catch (e) {
    console.log("Could not load .env.local:", e);
  }
}

loadEnvLocal();

async function update() {
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
      where: { kind_network: { kind: t.kind, network: "testnet" } },
      update: { wasmHash: hash },
      create: {
        kind: t.kind,
        network: "testnet",
        wasmHash: hash,
        abiJson: {},
      },
    });
    console.log(`Updated ${t.kind}: ${hash.slice(0, 12)}...`);
  }
}

update()
  .catch(console.error)
  .finally(() => db.$disconnect());
