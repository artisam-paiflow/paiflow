"use client";

import { WalletConnectModal } from "@walletconnect/modal";
import { SignClient } from "@walletconnect/sign-client";
import type { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit";
import type {
  WalletConnectAllowedMethods,
  WalletConnectModule,
} from "@creit.tech/stellar-wallets-kit/modules/walletconnect.module";
import { walletConnectMobileWallets, mobileWalletImages } from "./mobile-wallet-registry";
import { WALLET_CONNECT_UNCONFIGURED, walletConnectProjectId } from "./wallet-connect-config";

function isMobile() {
  if (typeof window === "undefined") return false;
  return Boolean(
    window.matchMedia("(pointer:coarse)").matches ||
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|Opera Mini/u.test(navigator.userAgent),
  );
}

export type WalletConnectClient = InstanceType<typeof SignClient>;

export type WalletKit = {
  kit: StellarWalletsKit;
  /** null when WalletConnect is not configured; the kit then carries Freighter only. */
  module: WalletConnectModule | null;
  client: WalletConnectClient | null;
  method: WalletConnectAllowedMethods.SIGN;
};

const cache = new Map<string, Promise<WalletKit>>();
const initialized = new Map<string, WalletKit>();

/** Read pre-warmed state without yielding Android tap activation to a promise. */
export function getCachedWalletKit(network: "testnet" | "mainnet"): WalletKit | undefined {
  return initialized.get(network);
}

export async function getWalletKit(network: "testnet" | "mainnet"): Promise<WalletKit> {
  const key = network;
  if (cache.has(key)) return cache.get(key)!;

  const promise = (async (): Promise<WalletKit> => {
    const [
      { StellarWalletsKit, WalletNetwork, FreighterModule },
      { WalletConnectModule, WalletConnectAllowedMethods },
    ] = await Promise.all([
      import("@creit.tech/stellar-wallets-kit"),
      import("@creit.tech/stellar-wallets-kit/modules/walletconnect.module"),
    ]);

    const walletNetwork = network === "mainnet" ? WalletNetwork.PUBLIC : WalletNetwork.TESTNET;
    const projectId = walletConnectProjectId();

    if (!projectId) {
      // The WalletConnect SDK accepts an undefined project id at init and only
      // fails later, when the relay rejects the pairing. On mobile WalletConnect
      // is the only wallet path, so fail here with a message instead of there
      // with a timeout. Desktop still has the Freighter extension.
      if (isMobile()) throw new Error(WALLET_CONNECT_UNCONFIGURED);
      const kit = new StellarWalletsKit({
        network: walletNetwork,
        modules: [new FreighterModule()],
      });
      return { kit, module: null, client: null, method: WalletConnectAllowedMethods.SIGN };
    }

    const chain = network === "mainnet" ? "stellar:pubnet" : "stellar:testnet";

    const originalConsoleError = console.error;
    console.error = (...args: unknown[]) => {
      const msg = args.map(String).join(" ");
      if (msg.includes("No matching key. expirer")) return;
      originalConsoleError.apply(console, args);
    };

    let walletConnectClient;
    try {
      walletConnectClient = await SignClient.init({
        projectId,
        metadata: {
          name: "Paiflow",
          description: "Trigger contract deployments",
          url: typeof window !== "undefined" ? window.location.origin : "",
          icons: ["/logo.png"],
        },
      });
    } finally {
      console.error = originalConsoleError;
    }

    document.querySelectorAll("wcm-modal").forEach((el) => el.remove());

    const walletConnectModal = new WalletConnectModal({
      projectId,
      chains: [chain],
      mobileWallets: walletConnectMobileWallets(),
      walletImages: mobileWalletImages(),
      enableExplorer: true,
    });

    const walletConnectModule = new WalletConnectModule({
      projectId,
      name: "Paiflow",
      description: "Trigger contract deployments",
      url: typeof window !== "undefined" ? window.location.origin : "",
      icons: ["/logo.png"],
      method: WalletConnectAllowedMethods.SIGN,
      network: walletNetwork,
      client:
        walletConnectClient as unknown as typeof import("@walletconnect/sign-client").SignClient,
      modal: walletConnectModal,
    });

    const modules = isMobile()
      ? [walletConnectModule]
      : [new FreighterModule(), walletConnectModule];

    const kit = new StellarWalletsKit({
      network: walletNetwork,
      modules,
    });

    return {
      kit,
      module: walletConnectModule,
      client: walletConnectClient,
      method: WalletConnectAllowedMethods.SIGN,
    };
  })().then((value) => {
    initialized.set(key, value);
    return value;
  });

  cache.set(key, promise);
  promise.catch(() => cache.delete(key));
  return promise;
}
