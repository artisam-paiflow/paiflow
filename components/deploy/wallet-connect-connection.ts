import { isAccountId } from "@/lib/stellar/strkey";
import { hasApprovedWalletConnectSession } from "./mobile-wallet-session";
import { stellarChainId } from "./wallet-connect-config";
import type { WalletConnectClient } from "./wallet-kit";

export type ApprovedWalletConnection = { topic: string; address: string };

/** Read an account from one exact approved topic; never search by account or peer name. */
export function walletConnectIdentity(
  client: WalletConnectClient,
  network: "testnet" | "mainnet",
  topic: string,
): ApprovedWalletConnection {
  const session = client.session.values.find((candidate) => candidate.topic === topic);
  const chain = stellarChainId(network);
  const namespace = session?.namespaces.stellar ?? session?.namespaces[chain];
  const prefix = `${chain}:`;
  const address = namespace?.accounts
    .find((account) => account.startsWith(prefix))
    ?.slice(prefix.length);
  if (
    !isAccountId(address) ||
    !hasApprovedWalletConnectSession({ topic, address }, client.session.values, network)
  )
    throw new Error("Wallet connection does not authorize this account and network.");
  return { topic, address };
}

/** Sign only through the exact user-approved topic/account, revalidated after every await. */
export function walletConnectConnection(
  client: WalletConnectClient,
  network: "testnet" | "mainnet",
  approved: ApprovedWalletConnection,
  signal: AbortSignal,
) {
  const check = () => {
    signal.throwIfAborted();
    if (!hasApprovedWalletConnectSession(approved, client.session.values, network))
      throw new Error("Wallet connection ended or changed. Connect again to continue.");
  };
  check();
  return {
    address: approved.address,
    walletId: "wallet_connect",
    signTransaction: async (
      xdr: string,
      options: { address: string; networkPassphrase: string },
    ) => {
      check();
      if (options.address !== approved.address) throw new Error("Wallet account changed.");
      const { assertWalletNetwork, assertSignedWalletTransaction } =
        await import("@/lib/stellar/wallet-signature");
      check();
      assertWalletNetwork(network, options.networkPassphrase);
      const result: unknown = await client.request({
        topic: approved.topic,
        chainId: stellarChainId(network),
        request: { method: "stellar_signXDR", params: { xdr } },
      });
      check();
      if (
        !result ||
        typeof result !== "object" ||
        !("signedXDR" in result) ||
        typeof result.signedXDR !== "string" ||
        !result.signedXDR
      )
        throw new Error("Wallet returned no signed transaction.");
      assertSignedWalletTransaction(
        xdr,
        result.signedXDR,
        approved.address,
        options.networkPassphrase,
      );
      return { signedTxXdr: result.signedXDR };
    },
  };
}
