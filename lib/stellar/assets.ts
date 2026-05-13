import { Asset } from "@stellar/stellar-sdk";
import type { Asset as FlowAsset } from "@/lib/flows/schema";
import { env, stellarPassphrase } from "@/lib/env";

// Known testnet asset issuers. USDC is the Circle testnet token.
const KNOWN_ISSUERS: Record<"testnet" | "mainnet", Record<string, string>> = {
  testnet: {
    USDC: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  },
  mainnet: {
    USDC: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  },
};

export function resolveAsset(a: FlowAsset): Asset {
  if (a.kind === "native") return Asset.native();
  if (a.kind === "custom") return new Asset(a.code, a.issuer);
  const issuer = KNOWN_ISSUERS[env().STELLAR_NETWORK][a.symbol];
  if (!issuer) throw new Error(`Unknown asset ${a.symbol} on ${env().STELLAR_NETWORK}`);
  return new Asset(a.symbol, issuer);
}

export function assetContractId(a: FlowAsset): string {
  return resolveAsset(a).contractId(stellarPassphrase());
}
