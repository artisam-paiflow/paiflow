"use client";

import { selectLanternWallet, trustedLanternOrigin, type LanternWallet } from "./lantern-wallet";
import type { SignClient } from "@walletconnect/sign-client";
import { WALLET_CONNECT_UNCONFIGURED, walletConnectProjectId } from "./wallet-connect-config";

function isMobile() {
  if (typeof window === "undefined") return false;
  return Boolean(
    window.matchMedia("(pointer:coarse)").matches ||
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|Opera Mini/u.test(navigator.userAgent),
  );
}

export type WalletKit = {
  provider: "browser";
  kit: any;
  /** null when WalletConnect is not configured; the kit then carries Freighter only. */
  module: any;
  client: InstanceType<typeof SignClient> | null;
};

export type LanternPaymentKit = {
  provider: "lantern";
  kit: LanternWallet;
  module: null;
  client: null;
};

const cache = new Map<string, Promise<WalletKit>>();

/** Public transport opt-in; standalone authenticated callers retain browser wallets. */
export function getWalletKit(network: "testnet" | "mainnet"): Promise<WalletKit>;
export function getWalletKit(
  network: "testnet" | "mainnet",
  options: { publicPayment: true },
): Promise<WalletKit | LanternPaymentKit>;
export async function getWalletKit(
  network: "testnet" | "mainnet",
  options?: { publicPayment?: boolean },
): Promise<WalletKit | LanternPaymentKit> {
  if (trustedLanternOrigin()) {
    if (!options?.publicPayment)
      throw new Error(
        "Authenticated wallet actions inside Lantern are not enabled yet. Open Paiflow in your browser to use this action.",
      );
    if (network !== "testnet")
      throw new Error(
        "Lantern public payments currently support Testnet only. Open a Testnet deployment in Lantern.",
      );
    const lantern = selectLanternWallet(network);
    if (lantern) return { provider: "lantern", kit: lantern, module: null, client: null };
  }
  const key = network;
  if (cache.has(key)) return cache.get(key)!;

  const promise: Promise<WalletKit> = (async () => {
    const [
      { SignClient },
      { WalletConnectModal },
      { StellarWalletsKit, WalletNetwork, FreighterModule },
      { WalletConnectModule, WalletConnectAllowedMethods },
    ] = await Promise.all([
      import("@walletconnect/sign-client"),
      import("@walletconnect/modal"),
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
      return { provider: "browser", kit, module: null, client: null };
    }

    const chain = network === "mainnet" ? "stellar:pubnet" : "stellar:testnet";

    const originalConsoleError = console.error;
    console.error = (...args: any[]) => {
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
      mobileWallets: [
        {
          id: "lobstr",
          name: "LOBSTR",
          links: {
            native: "lobstr",
            universal: "https://lobstr.co/uni/wc",
          },
        },
        {
          id: "xbull",
          name: "xBull",
          links: {
            native: "xbull",
            universal: "https://xbull.app",
          },
        },
        {
          id: "freighter",
          name: "Freighter",
          links: {
            native: "freighterwallet://wc-redirect",
            universal: "",
          },
        },
      ],
      walletImages: {
        lobstr: "https://stellar.creit.tech/wallet-icons/lobstr.png",
        xbull: "https://stellar.creit.tech/wallet-icons/xbull.png",
        freighter: "https://stellar.creit.tech/wallet-icons/freighter.png",
      },
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

    return { provider: "browser", kit, module: walletConnectModule, client: walletConnectClient };
  })();

  cache.set(key, promise);
  promise.catch(() => cache.delete(key));
  return promise;
}
