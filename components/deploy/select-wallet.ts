type SelectedWallet = { id: string; name: string };

type WalletPicker = {
  openModal: (options: {
    onWalletSelected: (wallet: SelectedWallet) => void;
    onClosed: () => void;
  }) => Promise<void>;
};

/** SWK 1.x resolves openModal when it renders, before the user chooses. */
export function selectWallet(kit: WalletPicker): Promise<SelectedWallet | null> {
  return new Promise((resolve, reject) => {
    let settled = false;
    void kit
      .openModal({
        onWalletSelected: (wallet) => {
          if (settled) return;
          settled = true;
          resolve(wallet);
        },
        onClosed: () => {
          if (settled) return;
          settled = true;
          resolve(null);
        },
      })
      .catch(reject);
  });
}
