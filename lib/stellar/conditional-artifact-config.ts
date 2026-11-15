import "server-only";
import { TemplateKind } from "@prisma/client";
import { env } from "@/lib/env";
import { readConditionalArtifactSet } from "./conditional-artifact-config-command";
export {
  readConditionalArtifactSet,
  conditionalArtifactSetDigest,
  configureConditionalArtifacts,
  lockConditionalArtifactConfiguration,
  requireConditionalArtifactConfiguration,
} from "./conditional-artifact-config-command";
/** Independent conditional-only activation, without legacy/env fallback or cache. */
export async function getConditionalWasmHashes(
  network: "testnet" | "mainnet" = env().STELLAR_NETWORK,
): Promise<Map<TemplateKind, string>> {
  const set = await readConditionalArtifactSet(network);
  if (!set?.enabled) return new Map<TemplateKind, string>();
  return new Map<TemplateKind, string>([
    [TemplateKind.DEPOSIT_TRIGGER, set.hashes.DEPOSIT_TRIGGER],
    [TemplateKind.PAYER, set.hashes.PAYER],
    [TemplateKind.SPLITTER, set.hashes.SPLITTER],
    [TemplateKind.ROUTER, set.hashes.ROUTER],
  ]);
}
