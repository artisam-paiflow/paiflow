#!/usr/bin/env tsx
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { config } from "dotenv";
import { PrismaClient, EventKind } from "@prisma/client";

const db = new PrismaClient();

config({ path: resolve(".env.local") });

const STROOP = 10_000_000n;

async function main() {
  const deploymentId = process.argv[2];
  if (!deploymentId) {
    console.error("Usage: pnpm seed:events <deploymentId>");
    process.exit(1);
  }

  const deployment = await db.deployment.findUnique({ where: { id: deploymentId } });
  if (!deployment) {
    console.error(`Deployment ${deploymentId} not found`);
    process.exit(1);
  }

  const now = new Date();
  const events = [
    {
      deploymentId,
      kind: EventKind.RECEIVE,
      ledger: 1234567,
      txHash: "aaabbbccc111222333444555666777888999000111222333444555666777888000",
      payload: { topics: ["receive"], value: { 0: "XLM", 1: (10n * STROOP).toString() } },
      decodedData: {
        from: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB",
        asset: "XLM",
        amount: (10n * STROOP).toString(),
      },
      occurredAt: new Date(now.getTime() - 1000 * 60 * 30),
    },
    {
      deploymentId,
      kind: EventKind.PAYOUT,
      ledger: 1234568,
      txHash: "bbbccc111222333444555666777888999000111222333444555666777888000aaabbb",
      payload: { topics: ["payout"], value: [] },
      decodedData: {
        from: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB",
        recipients: [
          {
            address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACHK",
            amount: (5n * STROOP).toString(),
            label: "Alice",
          },
          {
            address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADIM",
            amount: (5n * STROOP).toString(),
            label: "Bob",
          },
        ],
      },
      occurredAt: new Date(now.getTime() - 1000 * 60 * 25),
    },
    {
      deploymentId,
      kind: EventKind.RECEIVE,
      ledger: 1234569,
      txHash: "ccc111222333444555666777888999000111222333444555666777888000aaabbbccc",
      payload: { topics: ["receive"], value: { 0: "XLM", 1: (25n * STROOP).toString() } },
      decodedData: {
        from: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACC",
        asset: "XLM",
        amount: (25n * STROOP).toString(),
      },
      occurredAt: new Date(now.getTime() - 1000 * 60 * 20),
    },
    {
      deploymentId,
      kind: EventKind.PAYOUT,
      ledger: 1234570,
      txHash: "ddd222333444555666777888999000111222333444555666777888000aaabbbcccddd",
      payload: { topics: ["payout"], value: [] },
      decodedData: {
        from: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACC",
        recipients: [
          {
            address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACHK",
            amount: (25n * STROOP).toString(),
            label: "Alice",
          },
          {
            address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADIM",
            amount: (25n * STROOP).toString(),
            label: "Bob",
          },
        ],
      },
      occurredAt: new Date(now.getTime() - 1000 * 60 * 15),
    },
    {
      deploymentId,
      kind: EventKind.RECEIVE,
      ledger: 1234571,
      txHash: "eee333444555666777888999000111222333444555666777888000aaabbbcccdddeee",
      payload: { topics: ["receive"], value: { 0: "XLM", 1: (50n * STROOP).toString() } },
      decodedData: {
        from: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADDD",
        asset: "XLM",
        amount: (50n * STROOP).toString(),
      },
      occurredAt: new Date(now.getTime() - 1000 * 60 * 10),
    },
    {
      deploymentId,
      kind: EventKind.PAYOUT,
      ledger: 1234572,
      txHash: "fff444555666777888999000111222333444555666777888000aaabbbcccdddeeefff",
      payload: { topics: ["payout"], value: [] },
      decodedData: {
        from: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADDD",
        recipients: [
          {
            address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACHK",
            amount: (25n * STROOP).toString(),
            label: "Alice",
          },
          {
            address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADIM",
            amount: (25n * STROOP).toString(),
            label: "Bob",
          },
        ],
      },
      occurredAt: new Date(now.getTime() - 1000 * 60 * 5),
    },
  ];

  await db.contractEvent.deleteMany({ where: { deploymentId } });

  for (const event of events) {
    await db.contractEvent.create({ data: { ...event, eventId: randomUUID() } });
  }

  console.log(`Seeded ${events.length} events for deployment ${deploymentId}`);
  console.log("View at /deployments/" + deploymentId);
}

main().catch(console.error);
