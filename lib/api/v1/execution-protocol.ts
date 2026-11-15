import "server-only";
import type { WalletControlIntent } from "@prisma/client";
import { AppError } from "@/lib/errors";
import {
  ConditionalExecutionIntentSchema,
  type ConditionalExecutionIntent,
} from "@/lib/flows/conditional-v2";
import { ExecutionIntentSchema, type ExecutionIntent } from "@/lib/flows/field-policies";
import { executionV2Args } from "@/lib/stellar/conditional-v2-codec";
import { executionV1Args } from "@/lib/stellar/execution-v1";

/** Internal dispatch only. Public v1 request/response types remain unchanged. */
export type PaymentExecutionIntent = ExecutionIntent | ConditionalExecutionIntent;
export function parsePaymentExecutionIntent(raw: unknown): PaymentExecutionIntent {
  if (typeof raw === "object" && raw !== null && "version" in raw && raw.version === 2)
    return ConditionalExecutionIntentSchema.parse(raw);
  return ExecutionIntentSchema.parse(raw);
}
export function paymentExecutionArguments(intent: PaymentExecutionIntent) {
  return intent.version === 2 ? executionV2Args(intent) : executionV1Args(intent);
}

/** The invocation generation comes from validated persisted evidence, never a
 * caller-provided method selector. Older generic controls have no intent JSON. */
export function paymentExecutionProtocol(binding: { executionIntent?: unknown }) {
  if (binding.executionIntent === undefined || binding.executionIntent === null)
    return { version: 1 as const, method: "execute_v1" as const, arity: 7 as const };
  const intent = parsePaymentExecutionIntent(binding.executionIntent);
  return intent.version === 2
    ? { version: 2 as const, method: "execute_v2" as const, arity: 8 as const }
    : { version: 1 as const, method: "execute_v1" as const, arity: 7 as const };
}
export function assertPaymentExecutionVersion(
  saved: Pick<WalletControlIntent, "id" | "txHash" | "executionIntent">,
  expectedVersion: 1 | 2,
) {
  if (paymentExecutionProtocol(saved).version !== expectedVersion)
    throw new AppError(
      "CONFLICT",
      "Use the original preparation's execution version to recover it",
      {
        intent: [saved.id],
        txHash: [saved.txHash],
      },
    );
}
