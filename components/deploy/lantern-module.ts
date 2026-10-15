"use client";

import type { ModuleInterface } from "@creit.tech/stellar-wallets-kit";
import { ModuleType, WalletNetwork } from "@creit.tech/stellar-wallets-kit/types";
import type { StellarNetwork } from "@/lib/stellar/explorer";
import {
  assertLanternTransactionSource,
  lanternIdentity,
  lanternSignedResponse,
  provisionalLanternProvider,
  type ProvisionalLanternProvider,
} from "@/lib/stellar/lantern-provider";
import { LanternWalletError, lanternProviderFailure } from "@/lib/stellar/lantern-wallet-error";
import { assertSignedWalletTransaction } from "@/lib/stellar/wallet-signature";

export const LANTERN_ID = "lantern";

/**
 * Experimental SWK 1.x adapter for a declared provisional fake-provider API.
 * No provider reader is supplied by the shared kit, so real browser activation
 * fails closed even when window.lantern exists. Enabling that integration needs
 * upstream API/network/sign-only verification and real-extension acceptance.
 */
export class LanternModule implements ModuleInterface {
  moduleType = ModuleType.HOT_WALLET;
  productId = LANTERN_ID;
  productName = "Lantern (not yet supported)";
  // Official product information, NOT a claim that browser connect has shipped.
  productUrl = "https://golantern.xyz";
  productIcon = "/wallets/lantern.jpg";
  private connection: { provider: ProvisionalLanternProvider; address: string } | null = null;

  constructor(
    private readonly network: StellarNetwork,
    /** Explicit test injection only; never fall back to unverified window APIs. */
    private readonly readProvisionalProvider?: () => unknown,
  ) {}

  async isAvailable(): Promise<boolean> {
    try {
      return (
        this.network === "testnet" &&
        !!this.readProvisionalProvider &&
        provisionalLanternProvider(this.readProvisionalProvider()) !== null
      );
    } catch {
      return false;
    }
  }
  async isPlatformWrapper(): Promise<boolean> {
    return false;
  }

  private provider(): ProvisionalLanternProvider {
    if (this.network !== "testnet") throw new LanternWalletError("LANTERN_TESTNET_ONLY");
    if (!this.readProvisionalProvider) throw new LanternWalletError("LANTERN_UNVERIFIED");
    const provider = provisionalLanternProvider(this.readProvisionalProvider());
    if (!provider) throw new LanternWalletError("LANTERN_UNAVAILABLE");
    return provider;
  }

  async getAddress(
    options?: Parameters<ModuleInterface["getAddress"]>[0],
  ): Promise<{ address: string }> {
    try {
      const provider = this.provider();
      if (options?.path !== undefined) throw new LanternWalletError("LANTERN_UNSUPPORTED");
      const identity = lanternIdentity(
        await provider.getAddress({ networkPassphrase: WalletNetwork.TESTNET }),
        WalletNetwork.TESTNET,
      );
      if (this.provider() !== provider) throw new LanternWalletError("LANTERN_WRONG_ACCOUNT");
      this.connection = { provider, address: identity.address };
      return { address: identity.address };
    } catch (error) {
      this.connection = null;
      throw lanternProviderFailure(error);
    }
  }

  async signTransaction(
    transactionXdr: string,
    options?: Parameters<ModuleInterface["signTransaction"]>[1],
  ): Promise<{ signedTxXdr: string; signerAddress: string }> {
    try {
      const provider = this.provider();
      if (options?.submit || options?.submitUrl !== undefined || options?.path !== undefined)
        throw new LanternWalletError("LANTERN_UNSUPPORTED");
      const address = options?.address;
      const passphrase = options?.networkPassphrase;
      if (passphrase !== WalletNetwork.TESTNET)
        throw new LanternWalletError("LANTERN_WRONG_NETWORK");
      if (!address || this.connection?.address !== address || this.connection.provider !== provider)
        throw new LanternWalletError("LANTERN_WRONG_ACCOUNT");
      const current = lanternIdentity(
        await provider.getAddress({ networkPassphrase: passphrase }),
        passphrase,
      );
      if (current.address !== address || this.provider() !== provider)
        throw new LanternWalletError("LANTERN_WRONG_ACCOUNT");
      assertLanternTransactionSource(transactionXdr, address, passphrase);
      const result = lanternSignedResponse(
        await provider.signTransaction(transactionXdr, {
          address,
          networkPassphrase: passphrase,
          submit: false,
        }),
        address,
        passphrase,
      );
      if (this.provider() !== provider) throw new LanternWalletError("LANTERN_WRONG_ACCOUNT");
      try {
        assertSignedWalletTransaction(transactionXdr, result.signedTxXdr, address, passphrase);
      } catch {
        throw new LanternWalletError("LANTERN_INVALID_RESPONSE");
      }
      return result;
    } catch (error) {
      this.connection = null;
      throw lanternProviderFailure(error);
    }
  }

  async getNetwork(): Promise<{ network: string; networkPassphrase: string }> {
    await this.getAddress();
    return { network: "TESTNET", networkPassphrase: WalletNetwork.TESTNET };
  }
  async disconnect(): Promise<void> {
    this.connection = null;
  }
  async signAuthEntry(): Promise<never> {
    throw new LanternWalletError("LANTERN_UNSUPPORTED");
  }
  async signMessage(): Promise<never> {
    throw new LanternWalletError("LANTERN_UNSUPPORTED");
  }
}
