import { z } from "zod";

/** Kind-specific reviewed #1224 source outputs. This compatibility assertion is
 * separate from network upload/registry activation and from instance generation.
 * No legacy or execution-only v2 binary acquires guarded capabilities here. */
export const CONDITIONAL_V2_WASM_HASHES = {
  DEPOSIT_TRIGGER: "8ad4a9072e7f3bb2e708a0124e764843599badd5d2cef964e47d7e367a0453e9",
  PAYER: "58af309f7af9d912b309e078a9db4c8df7cef89cc44a4f49829f74af545d9fd8",
  SPLITTER: "24186c7112423c4ffae8d59900460d3e3196a14c2b375dd15d76b55638a0d9d2",
  ROUTER: "6c7f0a6ca5019bf40e430b152e1aeeaa08ef05428d0cdd76e6261a063f963ece",
} as const;

export const ConditionalArtifactCapabilitiesSchema = z
  .object({
    policyVersion: z.literal(2),
    wasmHash: z.string().regex(/^[a-f0-9]{64}$/),
    executionAbi: z.literal(2),
    mutationAbi: z.literal(2),
    conditional: z.literal(true),
    execution: z.literal(true),
    mutation: z.literal(true),
    immutablePolicies: z.literal(true),
    revisionBinding: z.literal(true),
  })
  .strict();
export type ConditionalArtifactCapabilities = z.infer<typeof ConditionalArtifactCapabilitiesSchema>;

export function assertConditionalArtifact(kind: string, wasmHash: string): void {
  if (
    !Object.hasOwn(CONDITIONAL_V2_WASM_HASHES, kind) ||
    CONDITIONAL_V2_WASM_HASHES[kind as keyof typeof CONDITIONAL_V2_WASM_HASHES] !== wasmHash
  )
    throw new Error(`The pinned ${kind} artifact does not enforce guarded conditional v2`);
}
export function conditionalArtifactMetadata(
  kind: string,
  wasmHash: string,
): ConditionalArtifactCapabilities {
  assertConditionalArtifact(kind, wasmHash);
  return {
    policyVersion: 2,
    wasmHash,
    executionAbi: 2,
    mutationAbi: 2,
    conditional: true,
    execution: true,
    mutation: true,
    immutablePolicies: true,
    revisionBinding: true,
  };
}
