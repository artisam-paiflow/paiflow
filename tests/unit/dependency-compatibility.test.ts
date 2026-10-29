import { createRequire } from "node:module";

import { describe, expect, it, vi } from "vitest";

describe("wallet SDK JSON-RPC dependency", () => {
  it("retains successful and failed RPC responses through the real Solana client", async () => {
    // Resolve through the consumer so this checks the version selected by pnpm's override.
    const rootRequire = createRequire(import.meta.url);
    const kitRequire = createRequire(rootRequire.resolve("@creit.tech/stellar-wallets-kit"));
    const hotRequire = createRequire(kitRequire.resolve("@hot-wallet/sdk"));
    const solana = hotRequire("@solana/web3.js") as {
      Connection: new (
        endpoint: string,
        options: { fetch: typeof fetch; disableRetryOnRateLimit: boolean },
      ) => { getBlockHeight(): Promise<number> };
    };
    const fetchMock = vi.fn<typeof fetch>();
    const connection = new solana.Connection("https://rpc.invalid", {
      fetch: fetchMock,
      disableRetryOnRateLimit: true,
    });
    fetchMock.mockImplementationOnce(async (_url, init) => {
      const request: unknown = JSON.parse(String(init?.body));
      expect(request).toMatchObject({ jsonrpc: "2.0", method: "getBlockHeight" });
      const id = (request as { id: unknown }).id;
      expect(id).toEqual(expect.any(String));
      return new Response(JSON.stringify({ jsonrpc: "2.0", id, result: 1234 }));
    });
    await expect(connection.getBlockHeight()).resolves.toBe(1234);
    fetchMock.mockImplementationOnce(async (_url, init) => {
      const { id } = JSON.parse(String(init?.body)) as { id: unknown };
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32602, message: "Invalid params" } }),
      );
    });
    await expect(connection.getBlockHeight()).rejects.toThrow("Invalid params");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("wallet SDK TOML dependency", () => {
  function legacyResolver() {
    const rootRequire = createRequire(import.meta.url);
    const kitRequire = createRequire(rootRequire.resolve("@creit.tech/stellar-wallets-kit"));
    const trezorRequire = createRequire(kitRequire.resolve("@trezor/connect"));
    const blockchainRequire = createRequire(trezorRequire.resolve("@trezor/blockchain-link"));
    const sdkRequire = createRequire(blockchainRequire.resolve("@stellar/stellar-sdk"));
    const { StellarToml } = blockchainRequire("@stellar/stellar-sdk") as {
      StellarToml: { Resolver: { resolve(domain: string): Promise<unknown> } };
    };
    const { httpClient } = sdkRequire("./http-client") as {
      httpClient: { get(url: string, options: unknown): Promise<{ data: string }> };
    };
    return { resolver: StellarToml.Resolver, httpClient };
  }

  it("resolves ordinary stellar.toml metadata through the transitive SDK", async () => {
    const { resolver, httpClient } = legacyResolver();
    const get = vi.spyOn(httpClient, "get").mockResolvedValue({
      data: 'VERSION="2.7.0"\n[[CURRENCIES]]\ncode="USD"\ndecimals=7\n',
    });
    try {
      await expect(resolver.resolve("issuer.invalid")).resolves.toEqual({
        VERSION: "2.7.0",
        CURRENCIES: [{ code: "USD", decimals: 7 }],
      });
      expect(get).toHaveBeenCalledWith(
        "https://issuer.invalid/.well-known/stellar.toml",
        expect.any(Object),
      );
    } finally {
      get.mockRestore();
    }
  });

  it.each(["9007199254740993", "9223372036854775808"])(
    "rejects unsafe integer %s without returning rounded issuer metadata",
    async (integer) => {
      const { resolver, httpClient } = legacyResolver();
      const get = vi.spyOn(httpClient, "get").mockResolvedValue({ data: `value=${integer}` });
      try {
        await expect(resolver.resolve("issuer.invalid")).rejects.toThrow(
          "stellar.toml is invalid - Parsing error",
        );
      } finally {
        get.mockRestore();
      }
    },
  );
});
