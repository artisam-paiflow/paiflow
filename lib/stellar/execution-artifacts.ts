import type { ArtifactCapabilities } from "@/lib/flows/field-policies";

/** Reviewed build outputs, not registry activation. Rebuild with Rust 1.95.0,
 * locked dependencies, release/wasm32v1-none; update only with ABI/security review.
 * A registry/env hash alone never grants policy enforcement capabilities. */
export const EXECUTION_V1_WASM_HASHES = {
  DEPOSIT_TRIGGER: "501864f26d6acfe1e2c6992caa585a5e7b1b40380b622ba3ba03df16b7a209a3",
  PAYER: "be042aff166c3295cba284600e8455409323491a4e0256524a575d342c5e103b",
  SPLITTER: "5b4303816afddb482e3a850ea9d461d6c5bce0e5ef9a92a5b4e5e9d5dc852f57",
} as const;
/** Distinct new artifacts. Retained execution-only snapshots remain supported. */
export const MUTATION_V1_WASM_HASHES = {
  DEPOSIT_TRIGGER: "2bd7fd8d6251092f49833513f50e3c04b9188f8da47a7cb73e5c84b521dc16ec",
  PAYER: "dcfc03ef0b4f608148313059c531e034ae43d3c2b6ae6149f9766e341c887318",
  SPLITTER: "589df78f21dfacceaefb59a2b66b019afb487090c3cd31beaf04d5f540768da9",
} as const;
export function assertMutationArtifact(kind: string, wasmHash: string): void {
  if (
    !Object.hasOwn(MUTATION_V1_WASM_HASHES, kind) ||
    MUTATION_V1_WASM_HASHES[kind as keyof typeof MUTATION_V1_WASM_HASHES] !== wasmHash
  )
    throw new Error(`The pinned ${kind} artifact does not enforce guarded mutation v1`);
}
export function assertExecutionArtifact(kind: string, wasmHash: string): void {
  if (
    !Object.hasOwn(EXECUTION_V1_WASM_HASHES, kind) ||
    (EXECUTION_V1_WASM_HASHES[kind as keyof typeof EXECUTION_V1_WASM_HASHES] !== wasmHash &&
      MUTATION_V1_WASM_HASHES[kind as keyof typeof MUTATION_V1_WASM_HASHES] !== wasmHash)
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
    mutation:
      Object.hasOwn(MUTATION_V1_WASM_HASHES, kind) &&
      MUTATION_V1_WASM_HASHES[kind as keyof typeof MUTATION_V1_WASM_HASHES] === wasmHash,
    immutablePolicies: true,
    revisionBinding: true,
  };
}
