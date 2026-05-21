export type StellarNetwork = "testnet" | "mainnet";

const NETWORK_SEGMENT: Record<StellarNetwork, "testnet" | "public"> = {
  testnet: "testnet",
  mainnet: "public",
};

export function isStellarNetwork(value: unknown): value is StellarNetwork {
  return value === "testnet" || value === "mainnet";
}

export function stellarExpertContractUrl(contractAddress: string, network: StellarNetwork): string {
  return `https://stellar.expert/explorer/${NETWORK_SEGMENT[network]}/contract/${contractAddress}`;
}

export function stellarExpertTxUrl(txHash: string, network: StellarNetwork): string {
  return `https://stellar.expert/explorer/${NETWORK_SEGMENT[network]}/tx/${txHash}`;
}
