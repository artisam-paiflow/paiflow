import { describe, expect, it, vi } from "vitest";
import {
  availableMobileWallets,
  currentMobileWalletPlatform,
  findMobileWallet,
  MOBILE_WALLETS,
  mobilePickerWallets,
  mobileWalletImages,
  mobileWalletPlatform,
  nativeMobileWalletLink,
  walletConnectMobileWallets,
  type MobileWalletDefinition,
} from "@/components/deploy/mobile-wallet-registry";

const restricted: MobileWalletDefinition = {
  id: "android-test-fixture",
  name: "Android test fixture",
  icon: "/fixture-icon.svg",
  nativeLink: "fixture-wallet://",
  walletConnectLinks: { native: "fixture-wallet", universal: "https://example.test/wc" },
  peerKeyword: "fixture",
  pickerOrder: 3,
  platforms: ["android"],
};

describe("mobile wallet registry", () => {
  it("can build existing wallet metadata without browser globals", () => {
    vi.stubGlobal("navigator", undefined);
    try {
      expect(currentMobileWalletPlatform()).toBe("other");
      expect(walletConnectMobileWallets().map(({ id }) => id)).toEqual([
        "lobstr",
        "xbull",
        "freighter",
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("preserves every existing modal name, link, icon and order", () => {
    expect(walletConnectMobileWallets("other")).toEqual([
      {
        id: "lobstr",
        name: "LOBSTR",
        links: { native: "lobstr", universal: "https://lobstr.co/uni/wc" },
      },
      { id: "xbull", name: "xBull", links: { native: "xbull", universal: "https://xbull.app" } },
      {
        id: "freighter",
        name: "Freighter",
        links: { native: "freighterwallet://wc-redirect", universal: "" },
      },
    ]);
    expect(mobilePickerWallets("other").map(({ id, name }) => ({ id, name }))).toEqual([
      { id: "freighter", name: "Freighter" },
      { id: "lobstr", name: "LOBSTR" },
      { id: "xbull", name: "xBull" },
    ]);
    expect(mobileWalletImages("other")).toEqual({
      lobstr: "https://stellar.creit.tech/wallet-icons/lobstr.png",
      xbull: "https://stellar.creit.tech/wallet-icons/xbull.png",
      freighter: "https://stellar.creit.tech/wallet-icons/freighter.png",
    });
    expect(MOBILE_WALLETS.map(({ peerKeyword }) => peerKeyword)).toEqual([
      "lobstr",
      "xbull",
      "freighter",
    ]);
  });
  it.each(["android", "ios", "other"] as const)(
    "does not restrict current wallets on %s",
    (platform) => {
      expect(availableMobileWallets(platform).map(({ id }) => id)).toEqual([
        "lobstr",
        "xbull",
        "freighter",
      ]);
      expect(findMobileWallet("lantern", platform)).toBeUndefined();
    },
  );
  it.each([
    ["Mozilla Android 14", 5, "android"],
    ["Mozilla iPhone OS 18", 5, "ios"],
    ["Mozilla iPad", 5, "ios"],
    ["Mozilla Macintosh Intel Mac OS X", 5, "ios"],
    ["Mozilla Macintosh Intel Mac OS X", 0, "other"],
    ["Mozilla Windows NT 10", 0, "other"],
    ["unknown", 0, "other"],
    ["", 0, "other"],
  ] as const)("detects %s with %s touch points", (agent, touches, expected) => {
    expect(mobileWalletPlatform(agent, touches)).toBe(expected);
  });
  it("shows a synthetic Android-only wallet only on Android", () => {
    const registry = [...MOBILE_WALLETS, restricted];
    expect(availableMobileWallets("android", registry).at(-1)).toEqual(restricted);
    expect(findMobileWallet(restricted.id, "android", registry)).toEqual(restricted);
    expect(nativeMobileWalletLink(restricted.id, "wc:test@2", "android", registry)).toBe(
      "fixture-wallet://wc?uri=wc%3Atest%402",
    );
    for (const platform of ["ios", "other"] as const) {
      expect(availableMobileWallets(platform, registry)).toEqual(MOBILE_WALLETS);
      expect(findMobileWallet(restricted.id, platform, registry)).toBeUndefined();
      expect(nativeMobileWalletLink(restricted.id, "wc:test@2", platform, registry)).toBeNull();
    }
    expect(MOBILE_WALLETS.some(({ id }) => id === restricted.id || id === "lantern")).toBe(false);
  });
  it.each([
    ["freighter", "freighterwallet://wc-redirect", "freighterwallet://wc-redirect/wc?uri="],
    ["lobstr", "lobstr://", "lobstr://wc?uri="],
    ["xbull", "xbull://", "xbull://wc?uri="],
  ])(
    "preserves %s handoff, including encoding an already-escaped pairing URI once",
    (id, nativeLink, pairedPrefix) => {
      const uri = "wc:abc@2?relay-protocol=irn&symKey=abc%2Fdef&expiryTimestamp=123";
      expect(nativeMobileWalletLink(id, undefined, "android")).toBe(nativeLink);
      expect(nativeMobileWalletLink(id, uri, "android")).toBe(
        pairedPrefix + encodeURIComponent(uri),
      );
      expect(nativeMobileWalletLink(id, uri, "android")).toContain("abc%252Fdef");
    },
  );
  it.each(["unknown", "lantern", "constructor", "toString", "__proto__"])(
    "does not navigate unknown wallet %s",
    (id) => {
      expect(nativeMobileWalletLink(id, "wc:test@2", "android")).toBeNull();
    },
  );
});
