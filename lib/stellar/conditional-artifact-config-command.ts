import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { AppError } from "@/lib/errors";
import { db } from "@/lib/prisma";
import { CONDITIONAL_V2_WASM_HASHES } from "./conditional-artifacts";
import {
  ConditionalArtifactSetSchema,
  canonicalConditionalArtifactSet,
  type ConditionalArtifactSet,
} from "./conditional-artifact-config-schema";
const NetworkSchema = z.enum(["testnet", "mainnet"]);
const HashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const InputSchema = z
  .object({
    network: NetworkSchema,
    enabled: z.boolean(),
    expectedCurrentDigest: HashSchema.optional(),
  })
  .strict();
const PlanSchema = z
  .object({
    network: NetworkSchema,
    version: z.literal(2),
    mode: z.enum(["dry-run", "applied"]),
    current: ConditionalArtifactSetSchema.nullable(),
    proposed: ConditionalArtifactSetSchema,
    currentDigest: HashSchema,
    proposedDigest: HashSchema,
  })
  .strict();
export type ConditionalArtifactConfigurationPlan = z.infer<typeof PlanSchema>;
export function conditionalArtifactSetDigest(set: ConditionalArtifactSet | null): string {
  return createHash("sha256").update(canonicalConditionalArtifactSet(set)).digest("hex");
}
async function readSet(
  network: "testnet" | "mainnet",
  client: Pick<Prisma.TransactionClient, "conditionalArtifactSet">,
) {
  const row = await client.conditionalArtifactSet.findUnique({
    where: { network_version: { network, version: 2 } },
  });
  if (!row) return null;
  const set = ConditionalArtifactSetSchema.parse({
    network: row.network,
    version: row.version,
    enabled: row.enabled,
    hashes: {
      DEPOSIT_TRIGGER: row.receiveWasmHash,
      PAYER: row.payerWasmHash,
      SPLITTER: row.splitterWasmHash,
      ROUTER: row.routerWasmHash,
    },
  });
  if (set.network !== network)
    throw new Error("Conditional artifact configuration network differs");
  return set;
}
/** Shared by operator configuration and fresh deployment admission, including absent rows. */
export async function lockConditionalArtifactConfiguration(
  tx: Pick<Prisma.TransactionClient, "$executeRaw">,
  network: "testnet" | "mainnet",
) {
  const lockTag = `paiflow.conditional-artifact-config:${NetworkSchema.parse(network)}:2`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockTag}, 0))`;
}
/** Caller must hold lockConditionalArtifactConfiguration for admission/configuration. */
export async function requireConditionalArtifactConfiguration(
  tx: Pick<Prisma.TransactionClient, "conditionalArtifactSet">,
  network: "testnet" | "mainnet",
) {
  const set = await readSet(NetworkSchema.parse(network), tx);
  if (!set?.enabled)
    throw new AppError("VALIDATION", "Conditional artifacts are unavailable for a new deployment");
  return set;
}
export async function readConditionalArtifactSet(
  network: "testnet" | "mainnet",
): Promise<ConditionalArtifactSet | null> {
  return readSet(NetworkSchema.parse(network), db);
}
/** A reviewed plan is configuration only, never deployed capability evidence. */
export async function configureConditionalArtifacts(
  raw: z.input<typeof InputSchema>,
  apply = false,
): Promise<ConditionalArtifactConfigurationPlan> {
  const input = InputSchema.parse(raw);
  z.boolean().parse(apply);
  if (apply && !input.expectedCurrentDigest)
    throw new Error(
      "Applying conditional configuration requires --expect with the reviewed current digest",
    );
  const proposed = ConditionalArtifactSetSchema.parse({
    network: input.network,
    version: 2,
    enabled: input.enabled,
    hashes: CONDITIONAL_V2_WASM_HASHES,
  });
  const plan = (current: ConditionalArtifactSet | null, mode: "dry-run" | "applied") =>
    PlanSchema.parse({
      network: input.network,
      version: 2,
      mode,
      current,
      proposed,
      currentDigest: conditionalArtifactSetDigest(current),
      proposedDigest: conditionalArtifactSetDigest(proposed),
    });
  if (!apply) return plan(await readSet(input.network, db), "dry-run");
  return db.$transaction(async (tx) => {
    await lockConditionalArtifactConfiguration(tx, input.network);
    const current = await readSet(input.network, tx),
      result = plan(current, "applied");
    if (result.currentDigest !== input.expectedCurrentDigest)
      throw new Error(
        "Conditional artifact configuration changed; inspect a fresh dry-run before applying",
      );
    const values = {
      enabled: proposed.enabled,
      receiveWasmHash: proposed.hashes.DEPOSIT_TRIGGER,
      payerWasmHash: proposed.hashes.PAYER,
      splitterWasmHash: proposed.hashes.SPLITTER,
      routerWasmHash: proposed.hashes.ROUTER,
    };
    await tx.conditionalArtifactSet.upsert({
      where: { network_version: { network: input.network, version: 2 } },
      create: { network: input.network, version: 2, ...values },
      update: values,
    });
    await tx.auditLog.create({
      data: {
        action: "CONDITIONAL_ARTIFACT_CONFIGURATION",
        metadata: {
          network: input.network,
          version: 2,
          before: current,
          after: proposed,
          currentDigest: result.currentDigest,
          proposedDigest: result.proposedDigest,
        },
      },
    });
    return result;
  });
}
/** Deliberately no network picker: the operator environment remains authoritative. */
export function parseConditionalArtifactConfigurationArgs(args: string[]) {
  let apply = false,
    enabled = true,
    expectedCurrentDigest: string | undefined;
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (seen.has(arg)) throw new Error("Duplicate conditional configuration option");
    seen.add(arg);
    if (arg === "--apply") apply = true;
    else if (arg === "--disable") enabled = false;
    else if (arg === "--expect") {
      const value = args[++i];
      if (!value) throw new Error("--expect requires a current digest");
      expectedCurrentDigest = HashSchema.parse(value);
    } else throw new Error("Unknown conditional configuration option");
  }
  if (apply && !expectedCurrentDigest)
    throw new Error("--apply requires --expect with the reviewed current digest");
  return { apply, enabled, ...(expectedCurrentDigest ? { expectedCurrentDigest } : {}) };
}
