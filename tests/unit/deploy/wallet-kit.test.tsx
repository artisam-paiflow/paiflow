import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  init: vi.fn(),
  kit: vi.fn(),
  module: vi.fn(),
  modal: vi.fn(),
}));
vi.mock("@walletconnect/sign-client", () => ({ SignClient: { init: mocks.init } }));
vi.mock("@walletconnect/modal", () => ({
  WalletConnectModal: class {
    constructor(options: unknown) {
      mocks.modal(options);
    }
  },
}));
vi.mock("@creit.tech/stellar-wallets-kit", () => ({
  StellarWalletsKit: class {
    constructor(options: unknown) {
      mocks.kit(options);
    }
  },
  FreighterModule: class Freighter {},
  WalletNetwork: { TESTNET: "testnet-passphrase", PUBLIC: "mainnet-passphrase" },
}));
vi.mock("@creit.tech/stellar-wallets-kit/modules/walletconnect.module", () => ({
  WalletConnectModule: class WalletConnect {
    constructor(options: unknown) {
      mocks.module(options);
    }
  },
  WalletConnectAllowedMethods: { SIGN: "stellar_signXDR" },
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID", "test-project");
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  mocks.init.mockResolvedValue({ session: { values: [] } });
});
afterEach(() => {
  document.querySelectorAll("wcm-modal").forEach((element) => element.remove());
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("shared wallet initialization", () => {
  it("joins concurrent callers and exposes the same pre-warmed client synchronously", async () => {
    const { getWalletKit, getCachedWalletKit } = await import("@/components/deploy/wallet-kit");
    expect(getCachedWalletKit("testnet")).toBeUndefined();
    const [first, second] = await Promise.all([getWalletKit("testnet"), getWalletKit("testnet")]);
    expect(first).toBe(second);
    expect(await getWalletKit("testnet")).toBe(first);
    expect(getCachedWalletKit("testnet")).toBe(first);
    expect(getCachedWalletKit("mainnet")).toBeUndefined();
    expect(mocks.init).toHaveBeenCalledOnce();
    expect(mocks.kit).toHaveBeenCalledOnce();
    expect(first.method).toBe("stellar_signXDR");
    expect(first).not.toHaveProperty("modal");
  });

  it.each([false, true])("preserves desktop/mobile module choice (mobile=%s)", async (mobile) => {
    vi.stubGlobal("matchMedia", () => ({ matches: mobile }));
    const staleModal = document.createElement("wcm-modal");
    document.body.append(staleModal);
    const { getWalletKit } = await import("@/components/deploy/wallet-kit");
    await getWalletKit("testnet");
    expect(staleModal.isConnected).toBe(false);
    const options = mocks.kit.mock.calls[0]?.[0] as {
      modules: Array<{
        productId?: string;
        productName?: string;
        productUrl?: string;
        isAvailable?: () => Promise<boolean>;
      }>;
    };
    const lantern = options.modules.find((module) => module.productId === "lantern");
    if (mobile) expect(lantern).toBeUndefined();
    else {
      expect(lantern?.productName).toBe("Lantern");
      expect(lantern?.productUrl).toContain("v0.7.0-testnet.21");
      expect(await lantern?.isAvailable?.()).toBe(false);
    }

    expect(mocks.kit).toHaveBeenCalledWith({
      network: "testnet-passphrase",
      modules: mobile
        ? [expect.anything()]
        : [expect.anything(), expect.anything(), expect.anything()],
    });
    expect(mocks.modal).toHaveBeenCalledWith(
      expect.objectContaining({
        chains: ["stellar:testnet"],
        mobileWallets: [
          {
            id: "lobstr",
            name: "LOBSTR",
            links: { native: "lobstr", universal: "https://lobstr.co/uni/wc" },
          },
          {
            id: "xbull",
            name: "xBull",
            links: { native: "xbull", universal: "https://xbull.app" },
          },
          {
            id: "freighter",
            name: "Freighter",
            links: { native: "freighterwallet://wc-redirect", universal: "" },
          },
        ],
        walletImages: {
          lobstr: "https://stellar.creit.tech/wallet-icons/lobstr.png",
          xbull: "https://stellar.creit.tech/wallet-icons/xbull.png",
          freighter: "https://stellar.creit.tech/wallet-icons/freighter.png",
        },
      }),
    );
  });

  it("keeps Lantern out of desktop mainnet while preserving Freighter and WalletConnect", async () => {
    const { getWalletKit } = await import("@/components/deploy/wallet-kit");
    const shared = await getWalletKit("mainnet");
    const options = mocks.kit.mock.calls[0]?.[0] as { modules: Array<{ productId?: string }> };
    expect(options.modules).toHaveLength(2);
    expect(options.modules.some((module) => module.productId === "lantern")).toBe(false);
    expect(shared.lantern).toBeUndefined();
  });

  it("keeps the network caches and WalletConnect chain configuration separate", async () => {
    const { getWalletKit, getCachedWalletKit } = await import("@/components/deploy/wallet-kit");
    const testnet = await getWalletKit("testnet");
    const mainnet = await getWalletKit("mainnet");
    expect(mainnet).not.toBe(testnet);
    expect(getCachedWalletKit("testnet")).toBe(testnet);
    expect(getCachedWalletKit("mainnet")).toBe(mainnet);
    expect(mocks.module).toHaveBeenLastCalledWith(
      expect.objectContaining({
        network: "mainnet-passphrase",
        method: "stellar_signXDR",
      }),
    );
    expect(mocks.modal).toHaveBeenLastCalledWith(
      expect.objectContaining({ chains: ["stellar:pubnet"] }),
    );
  });

  it("keeps desktop Freighter available without a WalletConnect project", async () => {
    vi.stubEnv("NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID", "");
    const { getWalletKit } = await import("@/components/deploy/wallet-kit");
    const result = await getWalletKit("testnet");
    expect(result.module).toBeNull();
    expect(result.client).toBeNull();
    expect(mocks.init).not.toHaveBeenCalled();
    expect(mocks.modal).not.toHaveBeenCalled();
    expect(mocks.kit).toHaveBeenCalledWith({
      network: "testnet-passphrase",
      modules: [expect.anything(), expect.anything()],
    });
  });

  it("fails early on unconfigured mobile and can retry after configuration is restored", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    vi.stubEnv("NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID", " ");
    const { getWalletKit, getCachedWalletKit } = await import("@/components/deploy/wallet-kit");
    await expect(getWalletKit("testnet")).rejects.toThrow("not configured");
    expect(getCachedWalletKit("testnet")).toBeUndefined();
    expect(mocks.init).not.toHaveBeenCalled();
    vi.stubEnv("NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID", "restored-project");
    await getWalletKit("testnet");
    expect(mocks.init).toHaveBeenCalledOnce();
  });

  it("restores console errors and clears the failed initialization so a caller can retry", async () => {
    const original = console.error;
    mocks.init.mockRejectedValueOnce(new Error("relay unavailable"));
    const { getWalletKit, getCachedWalletKit } = await import("@/components/deploy/wallet-kit");
    await expect(getWalletKit("testnet")).rejects.toThrow("relay unavailable");
    expect(console.error).toBe(original);
    expect(getCachedWalletKit("testnet")).toBeUndefined();
    expect(mocks.kit).not.toHaveBeenCalled();
    await getWalletKit("testnet");
    expect(console.error).toBe(original);
    expect(mocks.init).toHaveBeenCalledTimes(2);
  });
});
