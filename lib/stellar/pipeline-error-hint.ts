import "server-only";
import { log } from "@/lib/log";
import { soroswapRouterAddress } from "@/lib/env";
import { contractKeyForTemplate, type ContractErrorKey } from "./soroban-errors";
import type { SorobanErrorHint } from "./soroban-errors";
import { cachedSoroswapFactoryReader } from "./soroswap";

/** The subset of `Deployment.pipelineSnapshot` this needs. */
export type PipelineSnapshotNode = {
  contractAddress: string;
  templateKind: string;
};

/**
 * Map every contract a deposit can reach back to its error table, so a revert
 * deep in the pipeline reads as prose instead of "error #507".
 *
 * Shared by the trigger route and the QR deposit route — both build the same
 * deposit -> trigger -> ... invocation, so both need the same map.
 */
export async function buildPipelineErrorHint(
  pipeline: PipelineSnapshotNode[] | null,
): Promise<SorobanErrorHint & { addressMap: Record<string, ContractErrorKey> }> {
  const addressMap: Record<string, ContractErrorKey> = {};
  for (const n of pipeline ?? []) {
    const key = contractKeyForTemplate(n.templateKind);
    if (key && n.contractAddress) addressMap[n.contractAddress] = key;
  }

  const router = soroswapRouterAddress();
  if (router) {
    addressMap[router] = "soroswap_router";

    // Only swap pipelines can raise a Soroswap error, so nothing else pays for
    // the factory lookup. A failure here costs a friendlier message and nothing
    // more, so it must never propagate: this runs while building a hint for an
    // error path, and throwing would turn a readable revert into a 500.
    if ((pipeline ?? []).some((n) => n.templateKind === "SWAPPER")) {
      try {
        addressMap[await cachedSoroswapFactoryReader()(router)] = "soroswap_factory";
      } catch (err) {
        log.warn({ err, router }, "Soroswap factory lookup failed; error mapping degraded");
      }
    }
  }

  return { addressMap };
}
