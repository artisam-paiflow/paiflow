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

// Neither call overrides, so dotenv's first-write-wins gives shell > .env.local
// > .env. This is what lets the command verify a deployed database: without it
// .env.local's DATABASE_URL wins and the rows printed are the local ones.
config({ path: resolve(".env.local") });
config({ path: resolve(".env") });

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
