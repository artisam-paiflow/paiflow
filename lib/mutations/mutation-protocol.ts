import "server-only";
import type { WalletControlIntent } from "@prisma/client";
import { AppError } from "@/lib/errors";
import {
  ConditionalMutationIntentSchema,
  type ConditionalMutationIntent,
} from "@/lib/flows/conditional-v2";
import { mutationV2Args } from "@/lib/stellar/conditional-v2-codec";
import { mutationV1Args } from "@/lib/stellar/execution-v1";
import {
  MutationIntentSchema,
  MutationPrepareSchema,
  type MutationIntent,
  type MutationPrepare,
} from "./schema";
import {
  ConditionalMutationPrepareSchema,
  type ConditionalMutationPrepare,
} from "./conditional-schema";

/** Internal protocol dispatch; existing public v1 schemas remain exact. */
export type StoredMutationIntent = MutationIntent | ConditionalMutationIntent;
export type StoredMutationRequest = MutationPrepare | ConditionalMutationPrepare;
export function parseStoredMutationIntent(raw: unknown): StoredMutationIntent {
  if (raw && typeof raw === "object" && "version" in raw && raw.version === 2)
    return ConditionalMutationIntentSchema.parse(raw);
  return MutationIntentSchema.parse(raw);
}
export function parseStoredMutationRequest(raw: unknown): StoredMutationRequest {
  if (
    raw &&
    typeof raw === "object" &&
    "arguments" in raw &&
    raw.arguments &&
    typeof raw.arguments === "object" &&
    "version" in raw.arguments &&
    raw.arguments.version === 2
  )
    return ConditionalMutationPrepareSchema.parse(raw);
  return MutationPrepareSchema.parse(raw);
}
export function storedMutationArguments(mutation: StoredMutationIntent) {
  return mutation.version === 2
    ? mutationV2Args(mutation)
    : mutationV1Args(mutation.nodes, mutation.arguments);
}
export function storedMutationProtocol(binding: { mutationIntent?: unknown }) {
  if (binding.mutationIntent === undefined || binding.mutationIntent === null)
    return { version: 1 as const, method: "mutate_v1" as const };
  const mutation = parseStoredMutationIntent(binding.mutationIntent);
  return mutation.version === 2
    ? { version: 2 as const, method: "mutate_v2" as const }
    : { version: 1 as const, method: "mutate_v1" as const };
}
export function assertStoredMutationVersion(
  saved: Pick<WalletControlIntent, "id" | "txHash" | "mutationIntent">,
  expected: 1 | 2,
) {
  if (storedMutationProtocol(saved).version !== expected)
    throw new AppError("CONFLICT", "Recover the original mutation using its original version", {
      intent: [saved.id],
      txHash: [saved.txHash],
    });
}
