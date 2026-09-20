/**
 * #559: every Soroban and Horizon call must carry an HTTP timeout. stellar-sdk
 * 15.1.0 declares a `timeout` option on rpc.Server that its constructor ignores,
 * so this asserts the value the HTTP client actually uses, then proves that
 * value aborts a call to a server that never answers.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { rpc } from "@stellar/stellar-sdk";

vi.mock("@/lib/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/env")>()),
  stellarRpcUrl: () => "https://rpc.invalid",
  stellarHorizonUrl: () => "https://horizon.invalid",
  stellarRelayerAddress: () => undefined,
}));

import { STELLAR_HTTP_TIMEOUT_MS, horizon, sorobanRpc } from "@/lib/stellar/client";

describe("Stellar client timeouts", () => {
  it("sets a finite timeout on the Soroban RPC client", () => {
    expect(STELLAR_HTTP_TIMEOUT_MS).toBeGreaterThan(0);
    expect(sorobanRpc().httpClient.defaults.timeout).toBe(STELLAR_HTTP_TIMEOUT_MS);
  });

  it("sets a finite timeout on the Horizon client", () => {
    expect(horizon().httpClient.defaults.timeout).toBe(STELLAR_HTTP_TIMEOUT_MS);
  });

  describe("against a server that never answers", () => {
    let server: http.Server;
    let url: string;

    beforeAll(async () => {
      server = http.createServer(() => undefined);
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterAll(() => {
      server.closeAllConnections();
      server.close();
    });

    it("rejects instead of hanging when the timeout is set the way client.ts sets it", async () => {
      const hung = new rpc.Server(url, { allowHttp: true });
      hung.httpClient.defaults.timeout = 200;
      await expect(hung.getHealth()).rejects.toThrow(/timeout/i);
    });
  });
});
