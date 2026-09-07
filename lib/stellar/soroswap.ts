import "server-only";
import { Address, nativeToScVal, xdr, StrKey } from "@stellar/stellar-sdk";
import { simulateContractCall, simulateGetter } from "./relayer";
import { assetContractId } from "./assets";
import { createContractReadCache } from "@/lib/contract-read-cache";
import { soroswapRouterAddress, SWAP_ROUTER_UNSET_MESSAGE } from "@/lib/env";
import { AppError } from "@/lib/errors";
import type { Asset } from "@/lib/flows/schema";
import { minOut, orientReserves, spotOut, type SoroswapQuote } from "@/lib/soroswap/quote";

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

const addr = (a: string) => new Address(a).toScVal();

/** The pinned router, or the plain-English message the deploy path also uses. */
function requireRouterAddress(): string {
  const routerAddress = soroswapRouterAddress();
  if (!routerAddress) throw new AppError("VALIDATION", SWAP_ROUTER_UNSET_MESSAGE);
  return routerAddress;
}

export type SoroswapPool = {
  routerAddress: string;
  factoryAddress: string;
  pairAddress: string;
  token0: string;
  reserve0: bigint;
  reserve1: bigint;
};

/**
 * Router → factory → pair → reserves for one asset pair, by simulation
 * (Instawards D1, #391). Read-only: nothing here is ever submitted.
 */
export async function readSoroswapPool(input: {
  assetIn: Asset;
  assetOut: Asset;
}): Promise<SoroswapPool> {
  const routerAddress = requireRouterAddress();
  const inId = assetContractId(input.assetIn);
  const outId = assetContractId(input.assetOut);

  const factoryAddress = await readSoroswapFactory(routerAddress);
  let pairAddress: string;
  try {
    pairAddress = String(
      await simulateContractCall(factoryAddress, "get_pair", [addr(inId), addr(outId)]),
    );
  } catch (err) {
    throw new AppError(
      "VALIDATION",
      "Soroswap has no liquidity pool for this asset pair on this network.",
      undefined,
      err instanceof Error ? err.message : String(err),
    );
  }
  const reserves = (await simulateContractCall(pairAddress, "get_reserves")) as [bigint, bigint];
  const token0 = String(await simulateContractCall(pairAddress, "token_0"));

  return {
    routerAddress,
    factoryAddress,
    pairAddress,
    token0,
    reserve0: BigInt(reserves[0]),
    reserve1: BigInt(reserves[1]),
  };
}

/**
 * Expected output (the router's own quote, fee and impact included) and the
 * minimum the swapper contract will enforce (spot less slippage), as strings.
 */
export async function readSoroswapQuote(input: {
  assetIn: Asset;
  assetOut: Asset;
  amountStroops: string;
  slippageBps: number;
}): Promise<SoroswapQuote> {
  const pool = await readSoroswapPool(input);
  const inId = assetContractId(input.assetIn);
  const outId = assetContractId(input.assetOut);
  const amount = BigInt(input.amountStroops);

  const amounts = (await simulateContractCall(pool.routerAddress, "router_get_amounts_out", [
    nativeToScVal(amount, { type: "i128" }),
    xdr.ScVal.scvVec([addr(inId), addr(outId)]),
  ])) as bigint[];
  const amountOut = BigInt(amounts[amounts.length - 1] ?? 0n);

  const { reserveIn, reserveOut } = orientReserves(
    pool.reserve0,
    pool.reserve1,
    pool.token0 === inId,
  );
  const spot = spotOut(amount, reserveIn, reserveOut);
  const min = minOut(spot, input.slippageBps);

  return {
    amountOutStroops: amountOut.toString(),
    amountOutMinStroops: min.toString(),
    pairAddress: pool.pairAddress,
    routerAddress: pool.routerAddress,
  };
}
