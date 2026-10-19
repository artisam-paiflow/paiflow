"use client";

import type { ModuleInterface } from "@creit.tech/stellar-wallets-kit";
import { ModuleType, WalletNetwork } from "@creit.tech/stellar-wallets-kit/types";
import type { StellarNetwork } from "@/lib/stellar/explorer";
import {
  assertLanternTransactionSource,
  desktopLanternProvider,
  lanternIdentity,
  lanternSignedResponse,
  type LanternProvider,
} from "@/lib/stellar/lantern-provider";
import { LanternWalletError, lanternProviderFailure } from "@/lib/stellar/lantern-wallet-error";
import { assertSignedWalletTransaction } from "@/lib/stellar/wallet-signature";
import {
  LanternModule as UpstreamLanternModule,
  LANTERN_ID,
} from "@/lib/stellar/vendor/lantern/lantern.module";

export { LANTERN_ID };

/** SWK 1.x wrapper: official transport, with Paiflow's Testnet and signing safeguards. */
export class LanternModule implements ModuleInterface {
  moduleType = ModuleType.HOT_WALLET;
  productId = LANTERN_ID;
  productName = "Lantern";
  productUrl = "https://github.com/kimerran/stellar-lantern/releases/tag/v0.7.0-testnet.21";
  productIcon = "/wallets/lantern.jpg";
  private readonly upstream = new UpstreamLanternModule();
  private generation = 0;
  private connection: { provider: LanternProvider; address: string } | null = null;
  private observed: LanternProvider | null = null;
  private readonly changed = () => {
    this.generation++;
    this.connection = null;
  };

  constructor(private readonly network: StellarNetwork) {}

  /** Bind each selected surface to the grant it actually approved. */
  get connectionGeneration(): number {
    return this.generation;
  }
  assertConnectionGeneration(generation: number): void {
    const connection = this.connection;
    if (generation !== this.generation || !connection || this.provider() !== connection.provider)
      throw new LanternWalletError("LANTERN_WRONG_ACCOUNT");
  }

  private observe(provider: LanternProvider): void {
    if (this.observed === provider) return;
    this.detach();
    this.observed = provider;
    provider.on("change", this.changed);
  }

  private detach(): void {
    const previous = this.observed;
    this.observed = null;
    this.changed();
    previous?.off("change", this.changed);
  }

  private provider(): LanternProvider {
    if (this.network !== "testnet") throw new LanternWalletError("LANTERN_TESTNET_ONLY");
    const provider = desktopLanternProvider();
    if (!provider) {
      if (this.observed) this.detach();
      throw new LanternWalletError("LANTERN_UNAVAILABLE");
    }
    if (this.observed && this.observed !== provider) this.detach();
    return provider;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const provider = this.provider();
      const result = await provider.isConnected();
      return this.provider() === provider && result.isConnected === true && result.apiVersion === 1;
    } catch {
      return false;
    }
  }

  async isPlatformWrapper(): Promise<boolean> {
    return false;
  }

  private async identity(
    check: () => void,
  ): Promise<{ address: string; networkPassphrase: string }> {
    const address = await this.upstream.getAddress({ skipRequestAccess: true });
    check();
    const network = await this.upstream.getNetwork();
    return lanternIdentity({ ...address, ...network }, WalletNetwork.TESTNET);
  }

  async getAddress(
    options?: Parameters<ModuleInterface["getAddress"]>[0],
  ): Promise<{ address: string }> {
    let generation = this.generation;
    try {
      const provider = this.provider();
      if (options?.path !== undefined) throw new LanternWalletError("LANTERN_UNSUPPORTED");
      if (!options?.skipRequestAccess) {
        this.observe(provider);
        generation = ++this.generation;
        this.connection = null;
        const available = await provider.isConnected();
        if (generation !== this.generation || this.provider() !== provider)
          throw new LanternWalletError("LANTERN_WRONG_ACCOUNT");
        if (available.isConnected !== true || available.apiVersion !== 1)
          throw new LanternWalletError("LANTERN_UNAVAILABLE");
        const { address } = await this.upstream.getAddress();
        if (generation !== this.generation || this.provider() !== provider)
          throw new LanternWalletError("LANTERN_WRONG_ACCOUNT");
        const network = await this.upstream.getNetwork();
        const identity = lanternIdentity({ address, ...network }, WalletNetwork.TESTNET);
        if (generation !== this.generation || this.provider() !== provider)
          throw new LanternWalletError("LANTERN_WRONG_ACCOUNT");
        this.connection = { provider, address: identity.address };
        return { address: identity.address };
      }
      const connection = this.connection;
      if (!connection || connection.provider !== provider)
        throw new LanternWalletError("LANTERN_WRONG_ACCOUNT");
      const identity = await this.identity(() => {
        if (
          generation !== this.generation ||
          this.connection !== connection ||
          this.provider() !== provider
        )
          throw new LanternWalletError("LANTERN_WRONG_ACCOUNT");
      });
      if (
        generation !== this.generation ||
        this.connection !== connection ||
        this.provider() !== provider ||
        identity.address !== connection.address
      )
        throw new LanternWalletError("LANTERN_WRONG_ACCOUNT");
      return { address: identity.address };
    } catch (error) {
      if (generation === this.generation) this.changed();
      throw lanternProviderFailure(error);
    }
  }

  async signTransaction(
    transactionXdr: string,
    options?: Parameters<ModuleInterface["signTransaction"]>[1],
  ): Promise<{ signedTxXdr: string; signerAddress: string }> {
    const generation = this.generation;
    const connection = this.connection;
    const check = () => {
      if (
        generation !== this.generation ||
        !connection ||
        this.connection !== connection ||
        this.provider() !== connection.provider
      )
        throw new LanternWalletError("LANTERN_WRONG_ACCOUNT");
    };
    try {
      this.provider();
      if (options?.submit || options?.submitUrl !== undefined || options?.path !== undefined)
        throw new LanternWalletError("LANTERN_UNSUPPORTED");
      if (options?.networkPassphrase !== WalletNetwork.TESTNET)
        throw new LanternWalletError("LANTERN_WRONG_NETWORK");
      check();
      const address = options.address;
      if (!address || address !== connection?.address)
        throw new LanternWalletError("LANTERN_WRONG_ACCOUNT");
      await this.getAddress({ skipRequestAccess: true });
      check();
      assertLanternTransactionSource(transactionXdr, address, options.networkPassphrase);
      const response = await this.upstream.signTransaction(transactionXdr, {
        address,
        networkPassphrase: options.networkPassphrase,
      });
      check();
      const result = lanternSignedResponse(response, address);
      await this.getAddress({ skipRequestAccess: true });
      check();
      try {
        assertSignedWalletTransaction(
          transactionXdr,
          result.signedTxXdr,
          address,
          options.networkPassphrase,
        );
      } catch {
        throw new LanternWalletError("LANTERN_INVALID_RESPONSE");
      }
      return result;
    } catch (error) {
      const stale = generation !== this.generation;
      if (!stale && this.connection === connection) this.changed();
      // A lifecycle change during a request is uncertain, even if its late result
      // says rejected. Never release the persisted signing hold for that result.
      if (stale && lanternProviderFailure(error).code === "LANTERN_REJECTED")
        throw new LanternWalletError("LANTERN_CONNECTION_LOST");
      throw lanternProviderFailure(error);
    }
  }

  async getNetwork(): Promise<{ network: string; networkPassphrase: string }> {
    await this.getAddress({ skipRequestAccess: true });
    return { network: "TESTNET", networkPassphrase: WalletNetwork.TESTNET };
  }
  async disconnect(): Promise<void> {
    this.detach();
  }
  async signAuthEntry(): Promise<never> {
    throw new LanternWalletError("LANTERN_UNSUPPORTED");
  }
  async signMessage(): Promise<never> {
    throw new LanternWalletError("LANTERN_UNSUPPORTED");
  }
}
