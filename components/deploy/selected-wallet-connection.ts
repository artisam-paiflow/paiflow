import type { WalletKit } from "./wallet-kit";
import { selectWallet } from "./select-wallet";
import { walletConnectConnection } from "./wallet-connect-connection";

export function assertWalletAttemptActive(signal: AbortSignal): void {
  signal.throwIfAborted();
}

/** Pin the selected connection instead of SWK 1.x's account-based topic search. */
export async function connectSelectedWallet(
  shared: WalletKit,
  network: "testnet" | "mainnet",
  signal: AbortSignal,
) {
  assertWalletAttemptActive(signal);
  const wallet = await selectWallet(shared.kit, signal);
  assertWalletAttemptActive(signal);
  if (!wallet) return null;
  shared.kit.setWallet(wallet.id);
  if (wallet.id === "wallet_connect") {
    if (!shared.module || !shared.client) throw new Error("WalletConnect is not configured.");
    const { module, client } = shared;
    const session = await module.connectWalletConnect();
    assertWalletAttemptActive(signal);
    const address = session.accounts.find(
      (account: { network: string; publicKey: string }) =>
        account.network === (network === "mainnet" ? "pubnet" : "testnet"),
    )?.publicKey;
    if (!address) throw new Error("Wallet connection does not authorize this network.");
    const approved = { topic: session.id, address };
    return walletConnectConnection(client, network, approved, signal);
  }
  const { address } = await shared.kit.getAddress();
  assertWalletAttemptActive(signal);
  return {
    address,
    walletId: wallet.id,
    signTransaction: async (
      xdr: string,
      options: { address: string; networkPassphrase: string },
    ) => {
      assertWalletAttemptActive(signal);
      shared.kit.setWallet(wallet.id);
      const current = await shared.kit.getAddress();
      assertWalletAttemptActive(signal);
      if (current.address !== address || options.address !== address)
        throw new Error("Wallet account changed. Connect again to continue.");
      // SDK methods capture their module synchronously. Re-select after the
      // account await so another surface cannot change the signer in that gap.
      shared.kit.setWallet(wallet.id);
      const result = await shared.kit.signTransaction(xdr, options);
      assertWalletAttemptActive(signal);
      return result;
    },
  };
}
