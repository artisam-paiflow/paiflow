import type { ApiResponse, ExecutePrepared } from "@paiflow/sdk";

// Structural adapter for @stellar/freighter-api; the Node SDK is not imported at runtime.
export interface FreighterAdapter {
  isConnected(): Promise<{ isConnected: boolean; error?: unknown }>;
  requestAccess(): Promise<{ address: string; error?: unknown }>;
  signTransaction(
    xdr: string,
    options: { networkPassphrase: string; address: string },
  ): Promise<{
    signedTxXdr: string;
    signerAddress?: string;
    error?: unknown;
  }>;
}
interface CheckoutPrepared {
  preparation: ApiResponse<ExecutePrepared>;
  walletAddress: string;
  amountStroops: string;
  paymentDescription: string;
}
async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    redirect: "error",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error("Checkout request failed; retain the original payment");
  return (await response.json()) as T; // own application response; validate at your app boundary
}

// Mount chip/button/error in your existing accessible UI; inject Freighter from your bundler.
export function bindCheckout(
  button: HTMLButtonElement,
  chip: HTMLElement,
  error: HTMLElement,
  orderId: string,
  wallet: FreighterAdapter,
  review: (details: CheckoutPrepared) => Promise<boolean>,
) {
  chip.dataset.testid = "network-chip";
  chip.textContent = "NETWORK: awaiting preparation";
  error.setAttribute("role", "alert");
  let original: CheckoutPrepared | undefined;
  let signedXdr: string | undefined;
  button.addEventListener("click", async () => {
    button.disabled = true;
    error.textContent = "";
    try {
      const connected = await wallet.isConnected();
      if (connected.error || !connected.isConnected) throw new Error();
      const account = await wallet.requestAccess();
      if (account.error || !account.address) throw new Error();
      original ??= await post<CheckoutPrepared>("/checkout/prepare", { orderId });
      const prepared = original.preparation.data;
      chip.textContent = prepared.network.toUpperCase(); // server network, never wallet config
      if (
        account.address !== original.walletAddress ||
        Date.parse(prepared.expiresAt) <= Date.now()
      )
        throw new Error();
      // Application review renders price and configured rules and awaits explicit consent.
      if (!(await review(original))) throw new Error();
      if (!signedXdr) {
        const signed = await wallet.signTransaction(prepared.xdr, {
          networkPassphrase: prepared.networkPassphrase,
          address: account.address,
        });
        if (
          signed.error ||
          !signed.signedTxXdr ||
          (signed.signerAddress && signed.signerAddress !== account.address)
        )
          throw new Error();
        signedXdr = signed.signedTxXdr;
      }
      const result = await post<{ txHash: string; status: string }>("/checkout/submit", {
        orderId,
        signedXdr,
      });
      button.textContent = result.status === "PAID" ? "Paid" : "Payment awaiting verification";
      // Keep disabled: refresh status from your server; do not start another payment.
    } catch {
      error.textContent =
        "Payment interrupted. Check the original payment with the server before trying again.";
      // Do not print wallet errors, signed envelopes, tokens, intents or request bodies.
    }
  });
}
