import "server-only";
import { TemplateKind } from "@prisma/client";
import { env, stellarFactoryAddress, stellarWasmHash } from "@/lib/env";
import {
  getFactoryAddressFromDb,
  getWasmHashFromDb,
  getWasmHashesFromDb,
  setFactoryAddress as setFactoryAddressDb,
  setWasmHash as setWasmHashDb,
} from "@/lib/stellar/template-db";

const globalCache = globalThis as unknown as {
  __stellarConfigCache?: StellarConfigCache;
};

type StellarConfigCache = {
  wasmHashes: Map<string, string>;
  factoryAddresses: Map<string, string>;
};

function cache(): StellarConfigCache {
  if (!globalCache.__stellarConfigCache) {
    globalCache.__stellarConfigCache = {
      wasmHashes: new Map(),
      factoryAddresses: new Map(),
    };
  }
  return globalCache.__stellarConfigCache;
}

export function clearStellarConfigCache(): void {
  cache().wasmHashes.clear();
  cache().factoryAddresses.clear();
}

function networkName(): "testnet" | "mainnet" {
  const network = env().STELLAR_NETWORK;
  if (network !== "testnet" && network !== "mainnet") {
    throw new Error(`Unsupported STELLAR_NETWORK: ${network}`);
  }
  return network;
}

function wasmHashCacheKey(kind: TemplateKind, network: string): string {
  return `${kind}:${network}`;
}

function factoryAddressCacheKey(network: string): string {
  return network;
}

function warnEnvFallback(key: string): void {
  console.warn(
    `[stellar-config] env fallback used for ${key}. ` +
      "Migrate this value into the database for it to become the source of truth.",
  );
}

/**
 * Load every known WASM hash for a network from the DB, falling back to env
 * vars only when a row is missing. Results are cached for the process lifetime.
 */
export async function getWasmHashes(
  network?: "testnet" | "mainnet",
): Promise<Map<TemplateKind, string>> {
  const net = network ?? networkName();
  const c = cache();
  const result = new Map<TemplateKind, string>();
  const missing: TemplateKind[] = [];

  for (const kind of Object.values(TemplateKind)) {
    const key = wasmHashCacheKey(kind, net);
    const cached = c.wasmHashes.get(key);
    if (cached) {
      result.set(kind, cached);
      continue;
    }
    missing.push(kind);
  }

  if (missing.length > 0) {
    const dbHashes = await getWasmHashesFromDb(missing, net);

    const foundKinds = new Set<TemplateKind>();
    for (const [kind, hash] of dbHashes) {
      result.set(kind, hash);
      c.wasmHashes.set(wasmHashCacheKey(kind, net), hash);
      foundKinds.add(kind);
    }

    for (const kind of missing) {
      if (foundKinds.has(kind)) continue;
      const envKey = `STELLAR_WASM_HASH_${kind}_${net.toUpperCase()}`;
      const fallback = stellarWasmHash(kind);
      if (fallback) {
        warnEnvFallback(envKey);
        result.set(kind, fallback);
        c.wasmHashes.set(wasmHashCacheKey(kind, net), fallback);
      }
    }
  }

  return result;
}

/**
 * Look up a single WASM hash from the DB, falling back to env vars when the DB
 * row is missing.
 */
export async function getWasmHash(
  kind: TemplateKind,
  network?: "testnet" | "mainnet",
): Promise<string | undefined> {
  const net = network ?? networkName();
  const c = cache();
  const key = wasmHashCacheKey(kind, net);
  const cached = c.wasmHashes.get(key);
  if (cached) return cached;

  const row = await getWasmHashFromDb(kind, net);

  if (row) {
    c.wasmHashes.set(key, row);
    return row;
  }

  const fallback = stellarWasmHash(kind);
  if (fallback) {
    const envKey = `STELLAR_WASM_HASH_${kind}_${net.toUpperCase()}`;
    warnEnvFallback(envKey);
    c.wasmHashes.set(key, fallback);
  }
  return fallback;
}

/**
 * Look up the factory contract address from the DB, falling back to env vars
 * when the DB row is missing.
 */
export async function getFactoryAddress(
  network?: "testnet" | "mainnet",
): Promise<string | undefined> {
  const net = network ?? networkName();
  const c = cache();
  const key = factoryAddressCacheKey(net);
  const cached = c.factoryAddresses.get(key);
  if (cached) return cached;

  const row = await getFactoryAddressFromDb(net);

  if (row) {
    c.factoryAddresses.set(key, row);
    return row;
  }

  const fallback = stellarFactoryAddress();
  if (fallback) {
    const envKey = `STELLAR_FACTORY_ADDRESS_${net.toUpperCase()}`;
    warnEnvFallback(envKey);
    c.factoryAddresses.set(key, fallback);
  }
  return fallback;
}

/**
 * Persist a WASM hash to the DB. Used by deploy scripts.
 */
export async function setWasmHash(
  kind: TemplateKind,
  network: string,
  wasmHash: string,
  abiJson?: object,
): Promise<void> {
  await setWasmHashDb(kind, network, wasmHash, abiJson);
  cache().wasmHashes.set(wasmHashCacheKey(kind, network), wasmHash);
}

/**
 * Persist the factory contract address to the DB. Used by deploy scripts.
 */
export async function setFactoryAddress(
  network: string,
  address: string,
  wasmHash?: string,
): Promise<void> {
  await setFactoryAddressDb(network, address, wasmHash);
  cache().factoryAddresses.set(factoryAddressCacheKey(network), address);
}
