"use client";

import { useRef, useState, useEffect } from "react";
import { toast } from "sonner";
import { WalletConnectModal } from "@walletconnect/modal";
import { SignClient } from "@walletconnect/sign-client";

type TriggerButtonProps = {
  deploymentId: string;
  network: "testnet" | "mainnet";
  amount: string;
};

function isMobile() {
  if (typeof window === "undefined") return false;
  return Boolean(
    window.matchMedia("(pointer:coarse)").matches ||
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|Opera Mini/u.test(navigator.userAgent),
  );
}

const PENDING_KEY = "pinkraft_pending_wallet_connect";

function pollTxStatus(
  deploymentId: string,
  txHash: string,
  signal: AbortSignal,
): Promise<{ status: string; errorMessage?: string }> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 60_000;
    const interval = 2_000;

    const check = async () => {
      if (signal.aborted) {
        reject(new Error("Polling aborted"));
        return;
      }
      if (Date.now() > deadline) {
        reject(new Error("Timed out waiting for finality"));
        return;
      }
      try {
        const res = await fetch(`/api/deployments/${deploymentId}/tx-status?txHash=${txHash}`);
        if (!res.ok) {
          reject(new Error("Failed to check transaction status"));
          return;
        }
        const json = (await res.json()) as {
          data: { status: string; errorMessage?: string };
        };
        if (json.data.status === "SUCCESS") {
          resolve({ status: "SUCCESS" });
          return;
        }
        if (json.data.status === "FAILED") {
          resolve({
            status: "FAILED",
            errorMessage: json.data.errorMessage,
          });
          return;
        }
        setTimeout(check, interval);
      } catch {
        reject(new Error("Network error while polling status"));
      }
    };

    setTimeout(check, interval);
  });
}

type MobileWallet = {
  id: string;
  name: string;
  scheme: string;
  icon: string;
};

const MOBILE_WALLETS: MobileWallet[] = [
  {
    id: "freighter",
    name: "Freighter",
    scheme: "freighterwallet",
    icon: "account_balance_wallet",
  },
  { id: "lobstr", name: "LOBSTR", scheme: "lobstr", icon: "toll" },
  { id: "xbull", name: "xBull", scheme: "xbull", icon: "rocket_launch" },
];

async function initWalletConnectClient() {
  const projectId = process.env.NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID!;
  return SignClient.init({
    projectId,
    metadata: {
      name: "Pinkraft",
      description: "Trigger contract deployments",
      url: typeof window !== "undefined" ? window.location.origin : "",
      icons: ["https://pinkraft.xyz/logo.png"],
    },
  });
}

async function findSession(
  signClient: InstanceType<typeof SignClient>,
  network: "testnet" | "mainnet",
) {
  const chain = network === "mainnet" ? "stellar:pubnet" : "stellar:testnet";
  const sessions = signClient.session.getAll();
  return sessions.find((s) => s.namespaces.stellar?.chains?.includes(chain));
}

async function waitForMobileSession(
  signClient: InstanceType<typeof SignClient>,
  network: "testnet" | "mainnet",
  signal: AbortSignal,
) {
  const deadline = Date.now() + 60_000;
  const interval = 2_000;

  while (Date.now() < deadline) {
    if (signal.aborted) {
      throw new Error("Session polling aborted");
    }
    const session = await findSession(signClient, network);
    if (session) {
      const account = session.namespaces.stellar?.accounts[0];
      if (!account) throw new Error("No Stellar account in session");
      const address = account.split(":")[2];
      if (!address) throw new Error("Invalid Stellar account format in session");
      return { session, address };
    }
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(
    "Session approval timed out. Copy the WalletConnect URI and paste it into your wallet manually.",
  );
}

async function startMobileWalletConnection(
  signClient: InstanceType<typeof SignClient>,
  scheme: string,
  network: "testnet" | "mainnet",
) {
  const chain = network === "mainnet" ? "stellar:pubnet" : "stellar:testnet";

  const { uri } = await signClient.connect({
    requiredNamespaces: {
      stellar: {
        methods: ["stellar_signXDR"],
        chains: [chain],
        events: [],
      },
    },
  });

  if (!uri) {
    throw new Error("No WalletConnect URI generated");
  }

  const deepLink = `${scheme}://wc?uri=${encodeURIComponent(uri)}`;
  window.open(deepLink, "_self", "noreferrer noopener");

  return uri;
}

async function finishMobileWalletConnection(
  signClient: InstanceType<typeof SignClient>,
  network: "testnet" | "mainnet",
  signal: AbortSignal,
) {
  const { session, address } = await waitForMobileSession(signClient, network, signal);
  return { session, address };
}

async function signWithMobileWallet(
  signClient: InstanceType<typeof SignClient>,
  session: { topic: string },
  xdr: string,
  networkPassphrase: string,
  network: "testnet" | "mainnet",
) {
  const chain = network === "mainnet" ? "stellar:pubnet" : "stellar:testnet";
  const result = (await signClient.request({
    topic: session.topic,
    chainId: chain,
    request: {
      method: "stellar_signXDR",
      params: {
        xdr,
        networkPassphrase,
      },
    },
  })) as { signedXDR: string; signerAddress?: string };

  return { signedTxXdr: result.signedXDR, signerAddress: result.signerAddress };
}

export function TriggerButton({ deploymentId, network, amount }: TriggerButtonProps) {
  const [busy, setBusy] = useState(false);
  const [showMobilePicker, setShowMobilePicker] = useState(false);
  const [waitingUri, setWaitingUri] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return;
    try {
      const data = JSON.parse(raw) as {
        scheme: string;
        network: string;
        timestamp: number;
      };
      if (Date.now() - data.timestamp > 120_000) {
        sessionStorage.removeItem(PENDING_KEY);
        return;
      }
      if (data.network !== network) return;
      // Resume polling
      setBusy(true);
      setWaitingUri("Resuming…");
      initWalletConnectClient()
        .then(async (signClient) => {
          const controller = new AbortController();
          abortRef.current = controller;
          const { session, address } = await finishMobileWalletConnection(
            signClient,
            network,
            controller.signal,
          );
          sessionStorage.removeItem(PENDING_KEY);
          setWaitingUri(null);
          toast.success(`Connected: ${address.slice(0, 6)}...${address.slice(-4)}`);
          await submitTrigger(address, undefined, signClient, session);
        })
        .catch((err) => {
          sessionStorage.removeItem(PENDING_KEY);
          setWaitingUri(null);
          toast.error((err as Error).message ?? "Connection failed");
        })
        .finally(() => {
          setBusy(false);
        });
    } catch {
      sessionStorage.removeItem(PENDING_KEY);
    }
  }, [network]);

  async function runDesktopFlow() {
    const [
      { StellarWalletsKit, WalletNetwork, FreighterModule },
      { WalletConnectModule, WalletConnectAllowedMethods },
    ] = await Promise.all([
      import("@creit.tech/stellar-wallets-kit"),
      import("@creit.tech/stellar-wallets-kit/modules/walletconnect.module"),
    ]);

    const projectId = process.env.NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID!;
    const chain = network === "mainnet" ? "stellar:pubnet" : "stellar:testnet";

    const walletConnectClient = await SignClient.init({
      projectId,
      metadata: {
        name: "Pinkraft",
        description: "Trigger contract deployments",
        url: typeof window !== "undefined" ? window.location.origin : "",
        icons: ["https://pinkraft.xyz/logo.png"],
      },
    });

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
            native: "freighterwallet",
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
      name: "Pinkraft",
      description: "Trigger contract deployments",
      url: typeof window !== "undefined" ? window.location.origin : "",
      icons: ["https://pinkraft.xyz/logo.png"],
      method: WalletConnectAllowedMethods.SIGN,
      network: network === "mainnet" ? WalletNetwork.PUBLIC : WalletNetwork.TESTNET,
      client:
        walletConnectClient as unknown as typeof import("@walletconnect/sign-client").SignClient,
      modal: walletConnectModal,
    });

    const kit = new StellarWalletsKit({
      network: network === "mainnet" ? WalletNetwork.PUBLIC : WalletNetwork.TESTNET,
      modules: [new FreighterModule(), walletConnectModule],
    });

    await kit.openModal({
      onWalletSelected: async (wallet) => {
        setBusy(true);
        try {
          toast.info(`Selected wallet: ${wallet.name}`);
          kit.setWallet(wallet.id);
          const isWalletConnect = wallet.id === "wallet_connect";

          if (isWalletConnect) {
            toast.info("Initiating WalletConnect session...");
            await walletConnectModule.connectWalletConnect();
            toast.info("Session established, getting address...");
          } else {
            toast.info("Connecting to Freighter extension...");
          }

          const { address } = await kit.getAddress();
          toast.success(`Connected: ${address.slice(0, 6)}...${address.slice(-4)}`);

          await submitTrigger(address, kit);
        } catch (err) {
          toast.error((err as Error).message ?? "Connection failed");
        } finally {
          setBusy(false);
        }
      },
      onClosed: () => {
        toast.warning("Connection cancelled");
        abortRef.current?.abort();
        setBusy(false);
      },
    });
  }

  async function runMobileFlow(scheme: string) {
    setShowMobilePicker(false);
    setBusy(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const signClient = await initWalletConnectClient();

      sessionStorage.setItem(
        PENDING_KEY,
        JSON.stringify({ scheme, network, timestamp: Date.now() }),
      );

      const uri = await startMobileWalletConnection(signClient, scheme, network);
      setWaitingUri(uri);

      const { session, address } = await finishMobileWalletConnection(
        signClient,
        network,
        controller.signal,
      );

      sessionStorage.removeItem(PENDING_KEY);
      setWaitingUri(null);
      toast.success(`Connected: ${address.slice(0, 6)}...${address.slice(-4)}`);

      await submitTrigger(address, undefined, signClient, session);
    } catch (err) {
      sessionStorage.removeItem(PENDING_KEY);
      setWaitingUri(null);
      toast.error((err as Error).message ?? "Connection failed");
    } finally {
      setBusy(false);
    }
  }

  async function submitTrigger(
    address: string,
    kit?: {
      getAddress: () => Promise<{ address: string }>;
      signTransaction: (
        xdr: string,
        opts: { address?: string; networkPassphrase: string },
      ) => Promise<{ signedTxXdr: string }>;
    },
    signClient?: InstanceType<typeof SignClient>,
    session?: { topic: string },
  ) {
    toast.info("Preparing transaction...");
    const res = await fetch(`/api/deployments/${deploymentId}/trigger`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amount, userAddress: address }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message ?? "Failed to prepare transaction");

    toast.info("Awaiting signature...");
    let signed: { signedTxXdr: string };
    if (kit) {
      signed = await kit.signTransaction(data.data.xdr, {
        address,
        networkPassphrase: data.data.networkPassphrase,
      });
    } else if (signClient && session) {
      signed = await signWithMobileWallet(
        signClient,
        session,
        data.data.xdr,
        data.data.networkPassphrase,
        network,
      );
    } else {
      throw new Error("No signing mechanism available");
    }

    toast.info("Submitting transaction...");
    const submit = await fetch(`/api/deployments/${deploymentId}/submit-trigger`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signedXdr: signed.signedTxXdr }),
    });
    const subData = await submit.json();
    if (!submit.ok) throw new Error(subData?.error?.message ?? "Submit failed");

    const txHash = subData.data.txHash as string;
    toast.info("Transaction submitted. Waiting for confirmation...");

    const outcome = await pollTxStatus(deploymentId, txHash, abortRef.current!.signal);
    if (outcome.status === "SUCCESS") {
      toast.success("Distribution triggered!");
    } else {
      throw new Error(outcome.errorMessage ?? "Transaction failed on the network");
    }
  }

  async function onTrigger() {
    if (!amount || !/^\d+$/.test(amount) || amount === "0") {
      toast.error("Enter a valid XLM amount");
      return;
    }
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    if (isMobile()) {
      setShowMobilePicker(true);
    } else {
      setBusy(true);
      try {
        await runDesktopFlow();
      } catch (err) {
        toast.error((err as Error).message ?? "Trigger failed");
      } finally {
        setBusy(false);
      }
    }
  }

  return (
    <>
      <button
        onClick={onTrigger}
        disabled={busy}
        className="bg-primary px-md text-label-md text-on-primary inline-flex w-full items-center justify-center gap-2 rounded-lg py-3 font-mono font-bold transition-all duration-200 hover:-translate-y-px hover:shadow-[0_0_24px_rgba(255,177,196,0.55)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none"
      >
        {busy ? (
          <>
            <span className="material-symbols-outlined animate-spin text-[16px]">
              progress_activity
            </span>
            PROCESSING…
          </>
        ) : (
          <>
            <span className="material-symbols-outlined text-[16px]">send</span>
            CONNECT WALLET &amp; TRIGGER
          </>
        )}
      </button>

      {showMobilePicker && (
        <div className="p-md fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="glass-panel space-y-md p-md w-full max-w-xs rounded-xl">
            <div className="space-y-1 text-center">
              <p className="text-label-sm text-primary font-mono">/ MOBILE WALLET</p>
              <h2 className="font-display text-headline-sm">Choose Wallet</h2>
            </div>

            <div className="space-y-sm">
              {MOBILE_WALLETS.map((wallet) => (
                <button
                  key={wallet.id}
                  onClick={() => runMobileFlow(wallet.scheme)}
                  className="bg-surface-container-high hover:border-primary/50 hover:bg-surface-container-highest gap-sm px-md py-sm inline-flex w-full items-center rounded-lg border border-transparent transition-all"
                >
                  <span className="material-symbols-outlined text-primary text-[20px]">
                    {wallet.icon}
                  </span>
                  <span className="text-label-md text-on-surface font-mono">{wallet.name}</span>
                </button>
              ))}

              <button
                onClick={() => {
                  setShowMobilePicker(false);
                  setBusy(true);
                  runDesktopFlow()
                    .catch((err) => {
                      toast.error((err as Error).message ?? "Trigger failed");
                    })
                    .finally(() => setBusy(false));
                }}
                className="border-secondary/40 bg-secondary/10 text-secondary hover:bg-secondary/20 gap-sm px-md py-sm inline-flex w-full items-center rounded-lg border transition-colors"
              >
                <span className="material-symbols-outlined text-[20px]">qr_code_scanner</span>
                <span className="text-label-md font-mono">Other Wallet</span>
              </button>
            </div>

            <button
              onClick={() => {
                setShowMobilePicker(false);
                abortRef.current?.abort();
              }}
              className="text-label-sm text-on-surface-variant hover:text-primary w-full font-mono transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {waitingUri && (
        <div className="p-md fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="glass-panel space-y-md p-md w-full max-w-xs rounded-xl">
            <div className="space-y-1 text-center">
              <p className="text-label-sm text-primary font-mono">/ WAITING FOR WALLET</p>
              <h2 className="font-display text-headline-sm">Open your wallet</h2>
            </div>

            <div className="flex justify-center py-2">
              <span className="material-symbols-outlined text-primary animate-spin text-[32px]">
                progress_activity
              </span>
            </div>

            <p className="text-body-md text-on-surface-variant text-center">
              If the wallet didn&apos;t open automatically, copy the URI below and paste it into
              your wallet app.
            </p>

            <div className="space-y-2">
              <div className="bg-surface-container-lowest border-outline-variant/50 text-on-surface p-xs rounded border font-mono text-xs break-all">
                {waitingUri}
              </div>
              <button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(waitingUri);
                    toast.success("URI copied");
                  } catch {
                    toast.error("Failed to copy");
                  }
                }}
                className="bg-primary px-md text-label-md text-on-primary inline-flex w-full items-center justify-center gap-2 rounded-lg py-2 font-mono font-bold transition-all duration-200 hover:-translate-y-px active:scale-95"
              >
                <span className="material-symbols-outlined text-[16px]">content_copy</span>
                COPY URI
              </button>
            </div>

            <button
              onClick={() => {
                abortRef.current?.abort();
                sessionStorage.removeItem(PENDING_KEY);
                setWaitingUri(null);
                setBusy(false);
              }}
              className="text-label-sm text-on-surface-variant hover:text-primary w-full font-mono transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}
