import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/analytics/client", () => ({ setPersonProps: vi.fn() }));
const store = new Map<string, string>();
const fetchMock = vi.fn();
let client: typeof import("@/lib/wallet-tracking");
beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  store.clear();
  fetchMock.mockReset();
  vi.stubGlobal("window", { dispatchEvent: vi.fn() });
  vi.stubGlobal(
    "CustomEvent",
    class {
      constructor(
        public type: string,
        public detail: unknown,
      ) {}
    },
  );
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => store.get(key),
    setItem: (key: string, value: string) => store.set(key, value),
  });
  vi.stubGlobal("fetch", fetchMock);
  client = await import("@/lib/wallet-tracking");
  client.setWalletTrackingSubject(null);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const input = {
  address: `G${"B".repeat(55)}`,
  walletId: "freighter",
  network: "testnet" as const,
  surface: "trigger" as const,
};
async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}
describe("non-blocking wallet delivery", () => {
  it("preserves Lantern's provider identity through the existing audit delivery queue", async () => {
    fetchMock.mockImplementation(async (_url, options) => {
      const body = JSON.parse(options.body);
      return new Response(JSON.stringify({ data: { ok: true, connectionId: body.connectionId } }));
    });
    await client.trackWalletConnection({ ...input, walletId: "lantern" });
    await flush();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/audit/wallet-connection");
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1].body)).toMatchObject({
      walletId: "lantern",
      network: "testnet",
      surface: "trigger",
    });
    expect(JSON.parse([...store.values()][0]!)).toEqual([]);
  });

  it.each(["existing-user", null])(
    "defers delivery until initial session resolves to %s, including after reload",
    async (userId) => {
      client.setWalletTrackingSubject(undefined);
      await expect(client.trackWalletConnection(input)).resolves.toBeUndefined();
      await client.resumeWalletConnections();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(fetchMock).not.toHaveBeenCalled();
      const queued = JSON.parse([...store.values()][0]!)[0];
      expect(queued).not.toHaveProperty("sessionUserId");
      vi.resetModules();
      client = await import("@/lib/wallet-tracking");
      await client.resumeWalletConnections();
      expect(fetchMock).not.toHaveBeenCalled();
      fetchMock.mockImplementation(async (_url, options) => {
        const body = JSON.parse(options.body);
        // Model the server's assertion against an existing authenticated cookie.
        if (body.sessionUserId !== userId) return new Response("{}", { status: 409 });
        return new Response(
          JSON.stringify({ data: { ok: true, connectionId: body.connectionId } }),
        );
      });
      client.setWalletTrackingSubject(userId);
      await client.resumeWalletConnections();
      expect(JSON.parse(fetchMock.mock.calls[0]?.[1].body)).toMatchObject({
        connectionId: queued.connectionId,
        sessionUserId: userId,
      });
      expect(JSON.parse([...store.values()][0]!)).toEqual([]);
    },
  );
  it("retries non-OK delivery with the same connection ID and checks acknowledgement", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 503 }));
    await expect(client.trackWalletConnection(input)).resolves.toBeUndefined();
    await flush();
    const first = JSON.parse(fetchMock.mock.calls[0]?.[1].body);
    expect(store.size).toBe(1);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { ok: true, connectionId: first.connectionId } })),
    );
    await vi.advanceTimersByTimeAsync(30_000);
    await flush();
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1].body).connectionId).toBe(first.connectionId);
    expect(JSON.parse([...store.values()][0]!)).toEqual([]);
  });
  it("retains an invalid acknowledgement and resumes after reload", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ data: { ok: true, connectionId: "wrong" } })),
    );
    await client.trackWalletConnection(input);
    await flush();
    expect(JSON.parse([...store.values()][0]!)).toHaveLength(1);
    const original = JSON.parse(fetchMock.mock.calls[0]?.[1].body);
    vi.resetModules();
    client = await import("@/lib/wallet-tracking");
    client.setWalletTrackingSubject(null);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ data: { ok: true, connectionId: original.connectionId } })),
    );
    await client.resumeWalletConnections();
    expect(JSON.parse(fetchMock.mock.calls.at(-1)?.[1].body).connectionId).toBe(
      original.connectionId,
    );
  });
  it("does not attribute an old queued connection to a different session", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    client.setWalletTrackingSubject("old-user");
    await client.trackWalletConnection(input);
    await flush();
    client.setWalletTrackingSubject("new-user");
    await client.resumeWalletConnections();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse([...store.values()][0]!)).toEqual([]);
  });
});
