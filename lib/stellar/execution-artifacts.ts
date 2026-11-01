import type { ArtifactCapabilities } from "@/lib/flows/field-policies";

/** Reviewed build outputs, not registry activation. Rebuild with Rust 1.95.0,
 * locked dependencies, release/wasm32v1-none; update only with ABI/security review.
 * A registry/env hash alone never grants policy enforcement capabilities. */
export const EXECUTION_V1_WASM_HASHES = {
  DEPOSIT_TRIGGER: "501864f26d6acfe1e2c6992caa585a5e7b1b40380b622ba3ba03df16b7a209a3",
  PAYER: "be042aff166c3295cba284600e8455409323491a4e0256524a575d342c5e103b",
  SPLITTER: "5b4303816afddb482e3a850ea9d461d6c5bce0e5ef9a92a5b4e5e9d5dc852f57",
} as const;
export function assertExecutionArtifact(kind: string, wasmHash: string): void {
  if (
    !Object.hasOwn(EXECUTION_V1_WASM_HASHES, kind) ||
    EXECUTION_V1_WASM_HASHES[kind as keyof typeof EXECUTION_V1_WASM_HASHES] !== wasmHash
  )
    throw new Error(`The pinned ${kind} artifact does not enforce execution v1 policies`);
}
export function executionArtifactMetadata(kind: string, wasmHash: string): ArtifactCapabilities {
  assertExecutionArtifact(kind, wasmHash);
  return {
    policyVersion: 1,
    wasmHash,
    executionAbi: 1,
    execution: true,
    mutation: false,
    immutablePolicies: true,
    revisionBinding: true,
  };
}
