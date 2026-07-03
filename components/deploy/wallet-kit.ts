"use client";

import { WalletConnectModal } from "@walletconnect/modal";
import { SignClient } from "@walletconnect/sign-client";

function isMobile() {
  if (typeof window === "undefined") return false;
  return Boolean(
    window.matchMedia("(pointer:coarse)").matches ||
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|Opera Mini/u.test(navigator.userAgent),
  );
}

export type WalletKit = {
  kit: any;
  module: any;
  client: InstanceType<typeof SignClient>;
};

const cache = new Map<string, Promise<WalletKit>>();

export async function getWalletKit(network: "testnet" | "mainnet"): Promise<WalletKit> {
  const key = network;
  if (cache.has(key)) return cache.get(key)!;

  const promise = (async () => {
    const [
      { StellarWalletsKit, WalletNetwork, FreighterModule },
      { WalletConnectModule, WalletConnectAllowedMethods },
    ] = await Promise.all([
      import("@creit.tech/stellar-wallets-kit"),
      import("@creit.tech/stellar-wallets-kit/modules/walletconnect.module"),
    ]);

    const projectId = process.env.NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID!;
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
      icons: ["https://paiflow.xyz/logo.png"],
      method: WalletConnectAllowedMethods.SIGN,
      network: network === "mainnet" ? WalletNetwork.PUBLIC : WalletNetwork.TESTNET,
      client:
        walletConnectClient as unknown as typeof import("@walletconnect/sign-client").SignClient,
      modal: walletConnectModal,
    });

    const modules = isMobile()
      ? [walletConnectModule]
      : [new FreighterModule(), walletConnectModule];

    const kit = new StellarWalletsKit({
      network: network === "mainnet" ? WalletNetwork.PUBLIC : WalletNetwork.TESTNET,
      modules,
    });

    return { kit, module: walletConnectModule, client: walletConnectClient };
  })();

  cache.set(key, promise);
  promise.catch(() => cache.delete(key));
  return promise;
}
