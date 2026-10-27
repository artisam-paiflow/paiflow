import { IncomingMessage } from "node:http";
import { createRequire } from "node:module";
import { Socket } from "node:net";

import { Client } from "minio";
import { describe, expect, it, vi } from "vitest";

const { Client: CommonJsClient } = createRequire(import.meta.url)("minio") as {
  Client: typeof Client;
};

describe("patched MinIO notification parser", () => {
  for (const [format, ClientConstructor] of [
    ["CommonJS", CommonJsClient],
    ["ESM", Client],
  ] as const) {
    it(`${format} handles heartbeat lines and split UTF-8 records`, async () => {
      const client = new ClientConstructor({ endPoint: "localhost", useSSL: false });
      const response = new IncomingMessage(new Socket());
      const request = vi.spyOn(client, "makeRequestAsync").mockResolvedValue(response);
      const poller = client.listenBucketNotification("uploads", "", "", ["s3:ObjectCreated:*"]);
      const records: unknown[] = [];
      const finished = new Promise<void>((resolve, reject) => {
        poller.on("error", reject);
        poller.on("notification", (record) => {
          records.push(record);
          if (records.length === 2) {
            poller.stop();
            resolve();
          }
        });
      });
      try {
        await new Promise<void>((resolve) => setImmediate(resolve));
        const bytes = Buffer.from(
          '\n{"Records":null}\n{"Records":[{"key":"支付"},{"__proto__":{"polluted":true},"key":"second"}]}\n',
        );
        // Splitting every byte exercises the decoder across multibyte code points.
        for (const byte of bytes) response.push(Buffer.from([byte]));
        response.push(null);
        await finished;
        expect(records).toEqual([
          { key: "支付" },
          JSON.parse('{"__proto__":{"polluted":true},"key":"second"}'),
        ]);
        expect(Object.getPrototypeOf(records[1])).toBe(Object.prototype);
        expect({}).not.toHaveProperty("polluted");
        expect(request).toHaveBeenCalledTimes(1);
      } finally {
        poller.stop();
        response.destroy();
        request.mockRestore();
      }
    });

    it(`${format} reports malformed JSON without emitting a notification`, async () => {
      const client = new ClientConstructor({ endPoint: "localhost", useSSL: false });
      const response = new IncomingMessage(new Socket());
      const request = vi.spyOn(client, "makeRequestAsync").mockResolvedValue(response);
      const poller = client.listenBucketNotification("uploads", "", "", []);
      const notification = vi.fn();
      poller.on("notification", notification);
      const failed = new Promise<unknown>((resolve) => poller.on("error", resolve));
      try {
        await new Promise<void>((resolve) => setImmediate(resolve));
        response.push('{"Records":invalid}\n');
        response.push(null);
        expect(await failed).toBeInstanceOf(Error);
        expect(notification).not.toHaveBeenCalled();
      } finally {
        poller.stop();
        response.destroy();
        request.mockRestore();
      }
    });
  }
});

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
