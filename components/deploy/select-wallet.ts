type SelectedWallet = { id: string; name: string };

type WalletPicker = {
  openModal: (options: {
    onWalletSelected: (wallet: SelectedWallet) => void;
    onClosed: () => void;
  }) => Promise<void>;
};

/** SWK 1.x resolves openModal when it renders, before the user chooses. */
export function selectWallet(
  kit: WalletPicker,
  signal?: AbortSignal,
): Promise<SelectedWallet | null> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let ownedModal: Element | undefined;
    const existing = new Set(document.querySelectorAll("stellar-wallets-modal"));
    const finish = (wallet: SelectedWallet | null) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      resolve(wallet);
    };
    const close = () => {
      // Use the installed kit's public DOM event so it clears its private
      // modal reference as well as removing the element. Close only our modal.
      if (ownedModal?.isConnected) ownedModal.dispatchEvent(new CustomEvent("modal-closed"));
    };
    const abort = () => {
      close();
      finish(null);
    };
    if (signal?.aborted) {
      finish(null);
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    void kit
      .openModal({
        onWalletSelected: (wallet) => finish(signal?.aborted ? null : wallet),
        onClosed: () => finish(null),
      })
      .then(() => {
        ownedModal = [...document.querySelectorAll("stellar-wallets-modal")].find(
          (element) => !existing.has(element),
        );
        if (signal?.aborted) close();
      })
      .catch((error: unknown) => {
        signal?.removeEventListener("abort", abort);
        reject(error);
      });
  });
}
