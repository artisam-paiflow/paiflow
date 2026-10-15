import { nativeMobileWalletLink } from "./mobile-wallet-registry";

export { FREIGHTER_NATIVE_LINK } from "./mobile-wallet-registry";

export function mobileWalletLink(walletId: string, pairingUri?: string): string | null {
  return nativeMobileWalletLink(walletId, pairingUri);
}
