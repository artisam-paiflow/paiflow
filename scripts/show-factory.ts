#!/usr/bin/env tsx
/**
 * Prints the `FactoryDeployment` rows, so an operator can confirm a network
 * actually ended the deploy chain with a factory address.
 *
 * Usage:
 *   pnpm contracts:show-factory
 */
import { resolve } from "node:path";
import { config } from "dotenv";
import { db } from "@/lib/prisma";

config({ path: resolve(".env") });
config({ path: resolve(".env.local"), override: true });

db.factoryDeployment
  .findMany()
  .then((rows) => console.table(rows))
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
