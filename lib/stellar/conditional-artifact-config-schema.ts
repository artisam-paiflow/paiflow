import { xdr } from "@stellar/stellar-sdk";
import { z } from "zod";
import { assertConditionalArtifact, CONDITIONAL_V2_WASM_HASHES } from "./conditional-artifacts";
const HashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const ConditionalArtifactHashesSchema = z
  .object({
    DEPOSIT_TRIGGER: HashSchema,
    PAYER: HashSchema,
    SPLITTER: HashSchema,
    ROUTER: HashSchema,
  })
  .strict()
  .superRefine((hashes, ctx) => {
    for (const [kind, hash] of Object.entries(hashes)) {
      try {
        assertConditionalArtifact(kind, hash);
      } catch {
        ctx.addIssue({
          code: "custom",
          path: [kind],
          message: "Artifact must match the exact reviewed conditional family",
        });
      }
    }
  });
export type ConditionalArtifactHashes = z.infer<typeof ConditionalArtifactHashesSchema>;
export const ConditionalArtifactSetSchema = z
  .object({
    network: z.enum(["testnet", "mainnet"]),
    version: z.literal(2),
    enabled: z.boolean(),
    hashes: ConditionalArtifactHashesSchema,
  })
  .strict();
export type ConditionalArtifactSet = z.infer<typeof ConditionalArtifactSetSchema>;
/** Stable public configuration identity, not capability or chain provenance. */
export function canonicalConditionalArtifactSet(value: ConditionalArtifactSet | null): string {
  const parsed = value === null ? null : ConditionalArtifactSetSchema.parse(value);
  return JSON.stringify(parsed, (_key, item: unknown) =>
    item !== null && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item,
  );
}
/** Conditional binaries must never replace legacy/template registry slots. */
export function assertLegacyArtifactRegistryHash(hash: string, abiJson?: unknown): void {
  if (abiJson !== undefined) assertLegacyArtifactRegistryAbi(abiJson);
  if (Object.values(CONDITIONAL_V2_WASM_HASHES).some((pin) => pin === hash.toLowerCase()))
    throw new Error(
      "Conditional v2 artifacts require the separate conditional configuration and upload-only workflow",
    );
}

/** Denial only: a changed build hash must not bypass legacy-slot protection.
 * A spec never proves trusted executable capability. Preserve retained opaque
 * legacy metadata; actual uploads still require strict exact-byte extraction. */
export function assertLegacyArtifactRegistryAbi(abiJson: unknown): void {
  if (abiJson === null || typeof abiJson !== "object" || Array.isArray(abiJson)) return;
  const entries = "specEntriesXdr" in abiJson ? abiJson.specEntriesXdr : undefined;
  if (!Array.isArray(entries)) return;
  const conditionalMethods = new Set([
    "capabilities_v2",
    "graph_manifest_v2",
    "field_policy_v2",
    "initial_config_v2",
    "current_config_v2",
    "config_revision_v2",
    "mutation_status_v2",
    "execute_v2",
    "execute_step_v2",
    "mutate_v2",
    "mutate_step_v2",
  ]);
  for (const encoded of entries) {
    if (typeof encoded !== "string") continue;
    let entry: xdr.ScSpecEntry;
    try {
      entry = xdr.ScSpecEntry.fromXDR(encoded, "base64");
    } catch {
      continue;
    }
    if (
      entry.switch().name === "scSpecEntryFunctionV0" &&
      conditionalMethods.has(entry.functionV0().name().toString())
    )
      throw new Error(
        "Conditional v2 artifact ABI requires the separate conditional configuration and upload-only workflow",
      );
  }
}
