import "server-only";
import { StrKey } from "@stellar/stellar-sdk";
import { simulateGetter } from "./relayer";
import { createContractReadCache } from "@/lib/contract-read-cache";
import { AppError } from "@/lib/errors";

/**
 * Soroswap's pair factory, as reported by the router.
 *
 * Not to be confused with `stellarFactoryAddress()` in `lib/env.ts`, which is
 * Paiflow's own deploy factory. This one belongs to Soroswap and is only needed
 * to attribute a contract error to the right table: `do_swap` resolves the pair
 * through the factory before it calls the router, so a missing pool fails in
 * the factory's frame, not the router's.
 *
 * Read rather than configured, so it can never drift out of step with
 * STELLAR_SOROSWAP_ROUTER_*. The router sets its factory at construction and
 * exposes no setter, which is the precondition `contract-read-cache` documents
 * for anything cached.
 */
export async function readSoroswapFactory(routerAddress: string): Promise<string> {
  const value = await simulateGetter(routerAddress, "get_factory");
  if (typeof value !== "string" || !StrKey.isValidContract(value)) {
    throw new AppError(
      "UPSTREAM_RPC",
      `Soroswap router ${routerAddress} returned an unusable factory address`,
    );
  }
  return value;
}

/**
 * Cache-wrapped variant. `createContractReadCache` is request-scoped by design
 * — its in-memory memo lives on the returned closure — so build one per request
 * and let Redis carry the value between them.
 */
export function cachedSoroswapFactoryReader() {
  return createContractReadCache()("soroswap:factory", readSoroswapFactory, (router) => router);
}
