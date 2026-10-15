// Freighter filters incoming WalletConnect links against its native redirect
// before reading the pairing URI. Keep the picker and SDK modal on that path.
export const FREIGHTER_NATIVE_LINK = "freighterwallet://wc-redirect";

const NATIVE_LINKS: Record<string, string> = {
  freighter: FREIGHTER_NATIVE_LINK,
  lobstr: "lobstr://",
  xbull: "xbull://",
};

export function mobileWalletLink(walletId: string, pairingUri?: string): string | null {
  const nativeLink = NATIVE_LINKS[walletId];
  if (!nativeLink) return null;
  if (!pairingUri) return nativeLink;
  const base = nativeLink.endsWith("/") ? nativeLink : `${nativeLink}/`;
  return `${base}wc?uri=${encodeURIComponent(pairingUri)}`;
}
