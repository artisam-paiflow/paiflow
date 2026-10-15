/** Wallet transport metadata only; peer names are ranking hints, never identity. */
export type MobileWalletPlatform = "android" | "ios" | "other";

export type MobileWalletDefinition = {
  id: string;
  name: string;
  icon: string;
  nativeLink: string;
  walletConnectLinks: { native: string; universal: string };
  peerKeyword: string;
  /** The hand picker and WalletConnect modal historically use different orders. */
  pickerOrder: number;
  /** Omitted means available on every platform, including unknown user agents. */
  platforms?: readonly MobileWalletPlatform[];
};

// Freighter filters WalletConnect links against this exact native redirect.
export const FREIGHTER_NATIVE_LINK = "freighterwallet://wc-redirect";

// No Lantern entry until its official WalletConnect metadata and Android build
// are available. See #1002 and docs/testing/lantern-mobile-wallet-readiness.md.
export const MOBILE_WALLETS: readonly MobileWalletDefinition[] = [
  {
    id: "lobstr",
    name: "LOBSTR",
    icon: "https://stellar.creit.tech/wallet-icons/lobstr.png",
    nativeLink: "lobstr://",
    walletConnectLinks: { native: "lobstr", universal: "https://lobstr.co/uni/wc" },
    peerKeyword: "lobstr",
    pickerOrder: 1,
  },
  {
    id: "xbull",
    name: "xBull",
    icon: "https://stellar.creit.tech/wallet-icons/xbull.png",
    nativeLink: "xbull://",
    walletConnectLinks: { native: "xbull", universal: "https://xbull.app" },
    peerKeyword: "xbull",
    pickerOrder: 2,
  },
  {
    id: "freighter",
    name: "Freighter",
    icon: "https://stellar.creit.tech/wallet-icons/freighter.png",
    nativeLink: FREIGHTER_NATIVE_LINK,
    walletConnectLinks: { native: FREIGHTER_NATIVE_LINK, universal: "" },
    peerKeyword: "freighter",
    pickerOrder: 0,
  },
];

export function mobileWalletPlatform(userAgent: string, maxTouchPoints = 0): MobileWalletPlatform {
  if (/Android/i.test(userAgent)) return "android";
  if (/iPhone|iPad|iPod/i.test(userAgent) || (/Macintosh/i.test(userAgent) && maxTouchPoints > 1)) {
    return "ios";
  }
  return "other";
}

export function currentMobileWalletPlatform(): MobileWalletPlatform {
  return typeof navigator === "undefined"
    ? "other"
    : mobileWalletPlatform(navigator.userAgent, navigator.maxTouchPoints);
}

export function availableMobileWallets(
  platform: MobileWalletPlatform,
  registry: readonly MobileWalletDefinition[] = MOBILE_WALLETS,
): MobileWalletDefinition[] {
  return registry.filter((wallet) => !wallet.platforms || wallet.platforms.includes(platform));
}

export function findMobileWallet(
  walletId: string,
  platform: MobileWalletPlatform = currentMobileWalletPlatform(),
  registry: readonly MobileWalletDefinition[] = MOBILE_WALLETS,
): MobileWalletDefinition | undefined {
  return availableMobileWallets(platform, registry).find((wallet) => wallet.id === walletId);
}

export function mobilePickerWallets(
  platform: MobileWalletPlatform = currentMobileWalletPlatform(),
  registry: readonly MobileWalletDefinition[] = MOBILE_WALLETS,
): MobileWalletDefinition[] {
  return availableMobileWallets(platform, registry).sort(
    (left, right) => left.pickerOrder - right.pickerOrder,
  );
}

export function walletConnectMobileWallets(
  platform: MobileWalletPlatform = currentMobileWalletPlatform(),
  registry: readonly MobileWalletDefinition[] = MOBILE_WALLETS,
) {
  return availableMobileWallets(platform, registry).map((wallet) => ({
    id: wallet.id,
    name: wallet.name,
    links: { ...wallet.walletConnectLinks },
  }));
}

export function mobileWalletImages(
  platform: MobileWalletPlatform = currentMobileWalletPlatform(),
  registry: readonly MobileWalletDefinition[] = MOBILE_WALLETS,
): Record<string, string> {
  return Object.fromEntries(
    availableMobileWallets(platform, registry).map((wallet) => [wallet.id, wallet.icon]),
  );
}

export function nativeMobileWalletLink(
  walletId: string,
  pairingUri?: string,
  platform: MobileWalletPlatform = currentMobileWalletPlatform(),
  registry: readonly MobileWalletDefinition[] = MOBILE_WALLETS,
): string | null {
  const wallet = findMobileWallet(walletId, platform, registry);
  if (!wallet) return null;
  const { nativeLink } = wallet;
  if (!pairingUri) return nativeLink;
  const base = nativeLink.endsWith("/") ? nativeLink : `${nativeLink}/`;
  return `${base}wc?uri=${encodeURIComponent(pairingUri)}`;
}
