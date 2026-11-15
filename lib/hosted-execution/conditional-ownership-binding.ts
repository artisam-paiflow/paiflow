import { z } from "zod";
import {
  ConditionalHostedOwnershipRequestSchema,
  type ConditionalHostedOwnershipRequest,
} from "./conditional-schema";
/** Existing lifecycle ordering; array order remains evidence. */
export function canonicalHostedValue(value: unknown): string {
  const canonical = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(canonical);
    if (input && typeof input === "object")
      return Object.fromEntries(
        Object.entries(input)
          .filter(([, item]) => item !== undefined)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, item]) => [key, canonical(item)]),
      );
    return input;
  };
  return JSON.stringify(canonical(value));
}
const HashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const ContextSchema = z
  .object({
    domain: z.literal("paiflow.hosted-execution.ownership"),
    version: z.literal(2),
    deploymentId: z.uuid().transform((id) => id.toLowerCase()),
    payer: ConditionalHostedOwnershipRequestSchema.shape.payment.shape.from,
    network: z.enum(["testnet", "mainnet"]),
    networkPassphraseHash: HashSchema,
    requestDigest: HashSchema,
    recoveryKeyHash: HashSchema,
  })
  .strict();
export function conditionalHostedOwnershipContext(input: z.input<typeof ContextSchema>) {
  return ContextSchema.parse(input);
}
export async function hostedBrowserSha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
/** Inner proof payment digest differs from outer durable lifecycle digest. */
export async function conditionalHostedOwnershipBinding(
  deploymentId: string,
  input: ConditionalHostedOwnershipRequest,
  network: "testnet" | "mainnet",
  networkPassphrase: string,
): Promise<string> {
  const parsed = ConditionalHostedOwnershipRequestSchema.parse(input);
  const context = conditionalHostedOwnershipContext({
    domain: "paiflow.hosted-execution.ownership",
    version: 2,
    deploymentId,
    payer: parsed.payment.from,
    network,
    networkPassphraseHash: await hostedBrowserSha256(networkPassphrase),
    requestDigest: await hostedBrowserSha256(canonicalHostedValue(parsed.payment)),
    recoveryKeyHash: await hostedBrowserSha256(parsed.recoveryKey),
  });
  return hostedBrowserSha256(canonicalHostedValue(context));
}
