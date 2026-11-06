import type { WalletConnectModal } from "@walletconnect/modal";
import { stellarChainId } from "./wallet-connect-config";
import { walletConnectIdentity, type ApprovedWalletConnection } from "./wallet-connect-connection";
import type { WalletConnectClient } from "./wallet-kit";

// WCmodal 2.x has one global controller, even across different modal instances.
// Never allow one surface's cleanup to close another surface's QR.
let active: object | undefined;
const acceptedTopics = new WeakMap<WalletConnectClient, Set<string>>();

/** Own the QR lifecycle rather than SWK 1.x's uncancellable approval() handler. */
export function pairWalletConnect(
  client: WalletConnectClient,
  modal: WalletConnectModal,
  network: "testnet" | "mainnet",
  signal: AbortSignal,
): Promise<ApprovedWalletConnection | null> {
  signal.throwIfAborted();
  if (active) return Promise.reject(new Error("Another wallet connection is in progress."));
  const owner = {};
  const existingTopics = new Set(client.session.values.map((session) => session.topic));
  const accepted = acceptedTopics.get(client) ?? new Set<string>();
  acceptedTopics.set(client, accepted);
  active = owner;

  return new Promise((resolve, reject) => {
    let settled = false;
    let opened = false;
    let opening = false;
    let unsubscribe: (() => void) | undefined;
    const release = () => {
      if (!opening && active === owner) active = undefined;
    };
    const finish = (value: ApprovedWalletConnection | null, error?: unknown) => {
      if (settled) return;
      settled = true;
      try {
        unsubscribe?.();
      } catch {
        /* Cleanup must not strand the caller. */
      }
      signal.removeEventListener("abort", abort);
      // Unsubscribe and mark settled before the programmatic close notification.
      try {
        if (opened && active === owner) modal.closeModal();
      } catch {
        /* Connection settlement must survive a failed UI close. */
      }
      release();
      if (error !== undefined) reject(error);
      else resolve(value);
    };
    const abort = () => finish(null);
    const discardLateSession = (topic: string) => {
      // Only this attempt's newly approved session is eligible for cleanup.
      // Existing or subsequently accepted topics belong to other user actions.
      if (existingTopics.has(topic) || accepted.has(topic)) return;
      void Promise.resolve()
        .then(() =>
          client.disconnect({
            topic,
            reason: { code: 6000, message: "Connection attempt cancelled" },
          }),
        )
        .catch(() => {
          // A failed disconnect never makes this cancelled approval usable here.
        });
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      finish(null);
      return;
    }
    void (async () => {
      try {
        const { uri, approval } = await client.connect({
          requiredNamespaces: {
            stellar: {
              methods: ["stellar_signXDR"],
              chains: [stellarChainId(network)],
              events: [],
            },
          },
        });
        // Always consume the approval, including when cancellation preceded connect().
        void approval().then(
          (session) => {
            if (settled || signal.aborted) {
              discardLateSession(session.topic);
              return;
            }
            try {
              const identity = walletConnectIdentity(client, network, session.topic);
              accepted.add(identity.topic);
              finish(identity);
            } catch (error) {
              discardLateSession(session.topic);
              finish(null, error);
            }
          },
          (error: unknown) => finish(null, error),
        );
        if (settled) return;
        if (!uri) throw new Error("WalletConnect returned no pairing URI.");
        unsubscribe = modal.subscribeModal((state) => {
          if (state.open) opened = true;
          else if (opened) finish(null);
        });
        if (settled) {
          // Also handle a controller that emits open/close synchronously while
          // subscribing, before it has returned the unsubscribe function.
          unsubscribe();
          return;
        }
        opening = true;
        try {
          await modal.openModal({ uri });
        } finally {
          opening = false;
          if (settled) {
            // openModal can wait for UI initialization. Retain ownership until it
            // settles, so an old late open cannot replace a newer attempt's QR.
            try {
              if (active === owner) modal.closeModal();
            } finally {
              release();
            }
          }
        }
      } catch (error) {
        finish(null, error);
      }
    })();
  });
}
