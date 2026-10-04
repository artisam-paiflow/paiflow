/**
 * #759: relayer channel accounts. Keys are derived from the relayer secret, the
 * pool hands each channel to one caller at a time, channels=0 is the old single
 * lock, an unfunded channel is skipped, and the relayer key (not the channel)
 * signs the Soroban auth entries.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Address,
  Contract,
  Keypair,
  Operation,
  SorobanDataBuilder,
  nativeToScVal,
  xdr,
} from "@stellar/stellar-sdk";

const { mockRpc, warn } = vi.hoisted(() => ({
  mockRpc: {
    getAccount: vi.fn(),
    getTransaction: vi.fn(),
    getLatestLedger: vi.fn(),
    simulateTransaction: vi.fn(),
    sendTransaction: vi.fn(),
  },
  warn: vi.fn(),
}));

vi.mock("@/lib/log", () => ({ log: { warn, info: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/stellar/client", () => {
  // The same in-process promise chain as the real withRelayerLock.
  let queue: Promise<unknown> = Promise.resolve();
  let barrier: (() => Promise<void>) | undefined;
  return {
    sorobanRpc: () => mockRpc,
    decodeContractAddress: () => Buffer.alloc(32),
    horizon: vi.fn(),
    registerRelayerPendingBarrier: (fn: () => Promise<void>) => {
      barrier = fn;
    },
    withRelayerLock: <T>(fn: () => Promise<T>): Promise<T> => {
      const run = queue.then(async () => {
        await barrier?.();
        return fn();
      });
      queue = run.then(
        () => {},
        () => {},
      );
      return run;
    },
  };
});

const RELAYER = Keypair.random();

async function load(channels: number) {
  process.env.STELLAR_RELAYER_SECRET_KEY = RELAYER.secret();
  process.env.STELLAR_RELAYER_CHANNELS = String(channels);
  vi.resetModules();
  const mod = await import("@/lib/stellar/relayer-channels");
  mod.resetRelayerChannelPoolForTests();
  return mod;
}

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  vi.clearAllMocks();
  mockRpc.getAccount.mockImplementation(async (address: string) => ({
    accountId: () => address,
    sequenceNumber: () => "1",
    incrementSequenceNumber: () => {},
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.STELLAR_RELAYER_SECRET_KEY;
  delete process.env.STELLAR_RELAYER_CHANNELS;
  delete process.env.STELLAR_TTL_MAX_FEE_STROOPS;
});

describe("deriveChannelKeypair", () => {
  it("is deterministic and differs per index, per relayer, and from the relayer itself", async () => {
    const { deriveChannelKeypair } = await load(0);
    const a0 = deriveChannelKeypair(RELAYER.secret(), 0);
    const a1 = deriveChannelKeypair(RELAYER.secret(), 1);
    expect(deriveChannelKeypair(RELAYER.secret(), 0).publicKey()).toBe(a0.publicKey());
    expect(a0.publicKey()).not.toBe(a1.publicKey());
    expect(a0.publicKey()).not.toBe(RELAYER.publicKey());
    expect(deriveChannelKeypair(Keypair.random().secret(), 0).publicKey()).not.toBe(a0.publicKey());
  });

  it("does not confuse index 1 followed by 1 with index 11", async () => {
    const { deriveChannelKeypair } = await load(0);
    const keys = new Set(
      Array.from({ length: 30 }, (_, i) => deriveChannelKeypair(RELAYER.secret(), i).publicKey()),
    );
    expect(keys.size).toBe(30);
  });

  it("rejects a negative or fractional index", async () => {
    const { deriveChannelKeypair } = await load(0);
    expect(() => deriveChannelKeypair(RELAYER.secret(), -1)).toThrow();
    expect(() => deriveChannelKeypair(RELAYER.secret(), 1.5)).toThrow();
  });
});

describe("withRelayerChannel", () => {
  function tracker() {
    let active = 0;
    let max = 0;
    const perChannel = new Map<string, number>();
    let overlapOnChannel = false;
    return {
      run: async (channel: { publicKey: string }) => {
        active++;
        max = Math.max(max, active);
        const n = (perChannel.get(channel.publicKey) ?? 0) + 1;
        perChannel.set(channel.publicKey, n);
        if (n > 1) overlapOnChannel = true;
        await tick(15);
        perChannel.set(channel.publicKey, n - 1);
        active--;
        return channel.publicKey;
      },
      get max() {
        return max;
      },
      get overlapOnChannel() {
        return overlapOnChannel;
      },
    };
  }

  it("with 0 channels behaves as before: the relayer is the source, one caller at a time", async () => {
    const { withRelayerChannel } = await load(0);
    const t = tracker();
    const seen = await Promise.all(Array.from({ length: 4 }, () => withRelayerChannel(t.run)));
    expect(new Set(seen)).toEqual(new Set([RELAYER.publicKey()]));
    expect(t.max).toBe(1);
    expect(mockRpc.getAccount).not.toHaveBeenCalled();
  });

  it("runs N callers at once and never gives a channel to two callers at the same time", async () => {
    const { withRelayerChannel } = await load(3);
    const t = tracker();
    const seen = await Promise.all(Array.from({ length: 9 }, () => withRelayerChannel(t.run)));
    expect(t.max).toBe(3);
    expect(t.overlapOnChannel).toBe(false);
    expect(new Set(seen).size).toBe(3);
    expect(seen).not.toContain(RELAYER.publicKey());
  });

  it("releases the channel when the callback throws", async () => {
    const { withRelayerChannel } = await load(1);
    await expect(
      withRelayerChannel(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    await expect(withRelayerChannel(async (c) => c.index)).resolves.toBe(0);
  });

  it("skips an unfunded channel with a warning and uses the funded ones", async () => {
    const { withRelayerChannel, deriveChannelKeypair } = await load(3);
    const unfunded = deriveChannelKeypair(RELAYER.secret(), 1).publicKey();
    mockRpc.getAccount.mockImplementation(async (address: string) => {
      if (address === unfunded) throw new Error(`Account not found: ${address}`);
      return { accountId: () => address, sequenceNumber: () => "1" };
    });
    const t = tracker();
    const seen = await Promise.all(Array.from({ length: 6 }, () => withRelayerChannel(t.run)));
    expect(seen).not.toContain(unfunded);
    expect(new Set(seen).size).toBe(2);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("falls back to the relayer as source when no channel is funded", async () => {
    const { withRelayerChannel } = await load(2);
    mockRpc.getAccount.mockRejectedValue(new Error("Account not found"));
    const seen = await withRelayerChannel(async (c) => ({
      key: c.publicKey,
      isRelayerSource: c.isRelayerSource,
    }));
    expect(seen).toEqual({ key: RELAYER.publicKey(), isRelayerSource: true });
  });

  it("does not strand queued callers when the only channel turns out unfunded", async () => {
    const { withRelayerChannel } = await load(1);
    mockRpc.getAccount.mockRejectedValue(new Error("Account not found"));
    const seen = await Promise.race([
      Promise.all(Array.from({ length: 4 }, () => withRelayerChannel(async (c) => c.publicKey))),
      new Promise<string>((_, reject) => setTimeout(() => reject(new Error("stranded")), 1000)),
    ]);
    expect(new Set(seen)).toEqual(new Set([RELAYER.publicKey()]));
  });

  it("takes a channel out of the pool when a call on it fails for lack of funds", async () => {
    const { withRelayerChannel } = await load(1);
    const { AppError } = await import("@/lib/errors");
    await expect(
      withRelayerChannel(async () => {
        throw new AppError("INSUFFICIENT_FUNDS", "drained");
      }),
    ).rejects.toThrow("drained");
    const next = await withRelayerChannel(async (c) => c.isRelayerSource);
    expect(next).toBe(true);
  });

  it("does not hold an RPC hiccup against a channel", async () => {
    const { withRelayerChannel } = await load(1);
    mockRpc.getAccount.mockRejectedValue(new Error("socket hang up"));
    await expect(withRelayerChannel(async (c) => c.index)).resolves.toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it("makes the next holder wait for a transaction the last one left pending", async () => {
    const { withRelayerChannel } = await load(1);
    mockRpc.getTransaction
      .mockResolvedValueOnce({ status: "NOT_FOUND" })
      .mockResolvedValueOnce({ status: "SUCCESS" });
    await withRelayerChannel(async (c) => c.trackPending("abc"));
    await withRelayerChannel(async () => {
      expect(mockRpc.getTransaction).toHaveBeenCalledTimes(2);
      expect(mockRpc.getTransaction).toHaveBeenCalledWith("abc");
    });
  });

  it.each([0, 1])("retains pending hashes across RPC failures on lane %i", async (lanes) => {
    const { withRelayerChannel } = await load(lanes);
    await withRelayerChannel(async (channel) => channel.trackPending("uncertain"));
    mockRpc.getTransaction.mockReset().mockRejectedValueOnce(new Error("RPC unavailable"));
    const callback = vi.fn();
    await expect(withRelayerChannel(callback)).rejects.toThrow("RPC unavailable");
    expect(callback).not.toHaveBeenCalled();
    mockRpc.getTransaction.mockResolvedValue({ status: "SUCCESS" });
    await withRelayerChannel(callback);
    expect(mockRpc.getTransaction).toHaveBeenLastCalledWith("uncertain");
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it.each([0, 1])("retains pending hashes across timeout on lane %i", async (lanes) => {
    const { withRelayerChannel } = await load(lanes);
    await withRelayerChannel(async (channel) => channel.trackPending("uncertain"));
    let now = 0;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => (now += 30_000));
    const callback = vi.fn();
    await expect(withRelayerChannel(callback)).rejects.toThrow("finality is unknown");
    expect(callback).not.toHaveBeenCalled();
    clock.mockRestore();
    mockRpc.getTransaction.mockReset().mockResolvedValue({ status: "FAILED" });
    await withRelayerChannel(callback);
    expect(mockRpc.getTransaction).toHaveBeenLastCalledWith("uncertain");
  });

  it("direct source-lock users must reconcile unknown source-lane rent submissions", async () => {
    const { withRelayerChannel } = await load(0);
    const { withRelayerLock } = await import("@/lib/stellar/client");
    await withRelayerChannel(async (channel) => channel.trackPending("rent"));
    mockRpc.getTransaction.mockReset().mockRejectedValueOnce(new Error("RPC unavailable"));
    const callback = vi.fn();
    await expect(withRelayerLock(callback)).rejects.toThrow("RPC unavailable");
    expect(callback).not.toHaveBeenCalled();
    mockRpc.getTransaction.mockResolvedValue({ status: "SUCCESS" });
    await withRelayerLock(callback);
    expect(mockRpc.getTransaction).toHaveBeenLastCalledWith("rent");
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it.each([0, 1])(
    "releases ambiguous rent only beyond envelope expiry in closed ledger time, lane %i",
    async (lanes) => {
      const { withRelayerChannel } = await load(lanes);
      await withRelayerChannel(async (channel) => channel.trackPending("rent", "50"));
      mockRpc.getTransaction.mockReset().mockResolvedValue({ status: "NOT_FOUND" });
      mockRpc.getLatestLedger
        .mockReset()
        .mockResolvedValueOnce({ closeTime: "50" })
        .mockResolvedValueOnce({ closeTime: "51" });
      const callback = vi.fn();
      await withRelayerChannel(callback);
      expect(mockRpc.getLatestLedger).toHaveBeenCalledTimes(2);
      expect(callback).toHaveBeenCalledTimes(1);
      mockRpc.getTransaction.mockClear();
      await withRelayerChannel(callback);
      expect(mockRpc.getTransaction).not.toHaveBeenCalled();
    },
  );
});

describe("buildRelayerTx", () => {
  const CONTRACT = "CA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA";

  function relayerAuthEntry(address: string) {
    return new xdr.SorobanAuthorizationEntry({
      credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
        new xdr.SorobanAddressCredentials({
          address: new Address(address).toScAddress(),
          nonce: xdr.Int64.fromString("7"),
          signatureExpirationLedger: 0,
          signature: xdr.ScVal.scvVoid(),
        }),
      ),
      rootInvocation: new xdr.SorobanAuthorizedInvocation({
        function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
          new xdr.InvokeContractArgs({
            contractAddress: new Address(CONTRACT).toScAddress(),
            functionName: "charge_by_relayer",
            args: [],
          }),
        ),
        subInvocations: [],
      }),
    });
  }

  function simSuccess(auth: xdr.SorobanAuthorizationEntry[]) {
    return {
      _parsed: true,
      id: "1",
      latestLedger: 1000,
      events: [],
      transactionData: new SorobanDataBuilder().setResourceFee("1000"),
      minResourceFee: "1000",
      result: { auth, retval: nativeToScVal(true) },
    };
  }

  const operation = () =>
    Operation.invokeContractFunction({
      contract: CONTRACT,
      function: "charge_by_relayer",
      args: [],
    });

  it("on a channel: relayer signs the auth entry, the channel is source and signs the envelope", async () => {
    const { buildRelayerTx, withRelayerChannel } = await load(1);
    mockRpc.simulateTransaction.mockResolvedValue(
      simSuccess([relayerAuthEntry(RELAYER.publicKey())]),
    );

    const tx = await withRelayerChannel((channel) =>
      buildRelayerTx({ channel, operation: operation(), onSimulationError: (m) => new Error(m) }),
    );

    const channelKey = tx.source;
    expect(channelKey).not.toBe(RELAYER.publicKey());
    expect(tx.signatures).toHaveLength(1);
    expect(tx.signatures[0]!.hint()).toEqual(Keypair.fromPublicKey(channelKey).signatureHint());

    const auth = tx.toEnvelope().v1().tx().operations()[0]!.body().invokeHostFunctionOp().auth();
    expect(auth).toHaveLength(1);
    const creds = auth[0]!.credentials().address();
    expect(Address.fromScAddress(creds.address()).toString()).toBe(RELAYER.publicKey());
    // authorizeEntry replaced the void signature and set the expiry ledger.
    expect(creds.signature().switch().name).not.toBe("scvVoid");
    expect(creds.signatureExpirationLedger()).toBeGreaterThan(1000);
    // Simulated twice: once to record auth, once with the signature attached.
    expect(mockRpc.simulateTransaction).toHaveBeenCalledTimes(2);
  });

  it("keeps a caller's signed entry for another address and adds the relayer's", async () => {
    const { buildRelayerTx, withRelayerChannel } = await load(1);
    const user = Keypair.random();
    const userEntry = relayerAuthEntry(user.publicKey());
    userEntry.credentials().address().signatureExpirationLedger(4242);
    mockRpc.simulateTransaction.mockResolvedValue(
      simSuccess([relayerAuthEntry(RELAYER.publicKey()), relayerAuthEntry(user.publicKey())]),
    );
    const op = Operation.invokeHostFunction({
      func: xdr.HostFunction.hostFunctionTypeInvokeContract(
        new xdr.InvokeContractArgs({
          contractAddress: new Address(CONTRACT).toScAddress(),
          functionName: "execute",
          args: [],
        }),
      ),
      auth: [userEntry],
    });

    const tx = await withRelayerChannel((channel) =>
      buildRelayerTx({ channel, operation: op, onSimulationError: (m) => new Error(m) }),
    );

    const auth = tx.toEnvelope().v1().tx().operations()[0]!.body().invokeHostFunctionOp().auth();
    const byAddress = new Map(
      auth.map((e) => [
        Address.fromScAddress(e.credentials().address().address()).toString(),
        e.credentials().address(),
      ]),
    );
    expect(byAddress.get(user.publicKey())!.signatureExpirationLedger()).toBe(4242);
    expect(byAddress.get(RELAYER.publicKey())!.signature().switch().name).not.toBe("scvVoid");
  });

  it("with 0 channels: the relayer is the source and signs the envelope, auth left to the simulation", async () => {
    const { buildRelayerTx, withRelayerChannel } = await load(0);
    mockRpc.simulateTransaction.mockResolvedValue(simSuccess([]));

    const tx = await withRelayerChannel((channel) =>
      buildRelayerTx({ channel, operation: operation(), onSimulationError: (m) => new Error(m) }),
    );

    expect(tx.source).toBe(RELAYER.publicKey());
    expect(tx.signatures[0]!.hint()).toEqual(RELAYER.signatureHint());
    expect(mockRpc.simulateTransaction).toHaveBeenCalledTimes(1);
  });

  it("turns a failed simulation into the caller's error", async () => {
    const { buildRelayerTx, withRelayerChannel } = await load(1);
    mockRpc.simulateTransaction.mockResolvedValue({ id: "1", latestLedger: 1, error: "HostError" });
    await expect(
      withRelayerChannel((channel) =>
        buildRelayerTx({
          channel,
          operation: operation(),
          onSimulationError: (m) => new Error(`sim: ${m}`),
        }),
      ),
    ).rejects.toThrow("sim: HostError");
  });

  function restoreRequired(auth: xdr.SorobanAuthorizationEntry[] = []) {
    return {
      ...simSuccess(auth),
      restorePreamble: { minResourceFee: "1000", transactionData: new SorobanDataBuilder() },
    };
  }

  it("allows a restorable release probe through to the locked restore path", async () => {
    await load(0);
    const { simulateReleaseByRelayer } = await import("@/lib/stellar/relayer");
    const sim = restoreRequired();
    mockRpc.simulateTransaction.mockResolvedValue(sim);
    expect(await simulateReleaseByRelayer(CONTRACT, "after")).toEqual({
      ok: true,
      latestLedger: 1000,
      sim,
    });
    expect(mockRpc.sendTransaction).not.toHaveBeenCalled();
  });

  it("rejects excessive restoration fees before signing or sending", async () => {
    process.env.STELLAR_TTL_MAX_FEE_STROOPS = "100";
    const { buildRelayerTx, withRelayerChannel } = await load(0);
    mockRpc.simulateTransaction
      .mockReset()
      .mockResolvedValueOnce(restoreRequired())
      .mockResolvedValueOnce(simSuccess([]));
    await expect(
      withRelayerChannel((channel) =>
        buildRelayerTx({
          channel,
          operation: operation(),
          onSimulationError: (m) => new Error(m),
        }),
      ),
    ).rejects.toThrow("fee limit");
    expect(mockRpc.sendTransaction).not.toHaveBeenCalled();
  });

  it("preserves the automatic restoration list in assembled transaction data", async () => {
    const { buildRelayerTx, withRelayerChannel } = await load(0);
    const sim = simSuccess([]);
    sim.transactionData.setReadWrite([new Contract(CONTRACT).getFootprint()]);
    const data = sim.transactionData.build();
    data.ext(
      new xdr.SorobanTransactionDataExt(
        1,
        new xdr.SorobanResourcesExtV0({ archivedSorobanEntries: [0] }),
      ),
    );
    sim.transactionData = new SorobanDataBuilder(data);
    mockRpc.simulateTransaction.mockResolvedValue(sim);
    const tx = await withRelayerChannel((channel) =>
      buildRelayerTx({ channel, operation: operation(), onSimulationError: (m) => new Error(m) }),
    );
    expect(
      tx.toEnvelope().v1().tx().ext().sorobanData().ext().resourceExt().archivedSorobanEntries(),
    ).toEqual([0]);
    expect(mockRpc.sendTransaction).not.toHaveBeenCalled();
  });

  it.each([0, 1])("restores once then freshly simulates on lane %i", async (lanes) => {
    const { buildRelayerTx, withRelayerChannel } = await load(lanes);
    const auth = lanes ? [relayerAuthEntry(RELAYER.publicKey())] : [];
    mockRpc.simulateTransaction
      .mockReset()
      .mockResolvedValueOnce(restoreRequired(auth))
      .mockResolvedValueOnce(simSuccess([]))
      .mockResolvedValue(simSuccess(auth));
    mockRpc.sendTransaction.mockResolvedValue({ status: "PENDING" });
    mockRpc.getTransaction.mockResolvedValue({ status: "SUCCESS", ledger: 1001 });
    const tx = await withRelayerChannel((channel) =>
      buildRelayerTx({ channel, operation: operation(), onSimulationError: (m) => new Error(m) }),
    );
    const restore = mockRpc.sendTransaction.mock.calls[0]![0];
    expect(restore.operations[0].type).toBe("restoreFootprint");
    expect(restore.source).toBe(tx.source);
    expect(restore.signatures[0].hint()).toEqual(Keypair.fromPublicKey(tx.source).signatureHint());
    expect(mockRpc.sendTransaction).toHaveBeenCalledTimes(1);
    expect(mockRpc.simulateTransaction).toHaveBeenCalledTimes(lanes ? 4 : 3);
    expect(tx.operations[0]!.type).toBe("invokeHostFunction");
  });

  it("rechecks the release condition after restoring rather than using the probe result", async () => {
    const { buildRelayerTx, withRelayerChannel } = await load(0);
    mockRpc.simulateTransaction
      .mockReset()
      .mockResolvedValueOnce(simSuccess([]))
      .mockResolvedValueOnce({ error: "ConditionNotMet", latestLedger: 1001 });
    mockRpc.sendTransaction.mockResolvedValue({ status: "PENDING" });
    mockRpc.getTransaction.mockResolvedValue({ status: "SUCCESS" });
    await expect(
      withRelayerChannel((channel) =>
        buildRelayerTx({
          channel,
          operation: operation(),
          presimulated: restoreRequired(),
          onSimulationError: (m) => new Error(m),
        }),
      ),
    ).rejects.toThrow("ConditionNotMet");
    expect(mockRpc.sendTransaction).toHaveBeenCalledTimes(1);
  });

  it("tracks an unknown restore hash and never builds an invocation after timeout", async () => {
    const { buildRelayerTx, relayerSourceChannel } = await load(0);
    const trackPending = vi.fn();
    mockRpc.simulateTransaction
      .mockReset()
      .mockResolvedValueOnce(restoreRequired())
      .mockResolvedValueOnce(simSuccess([]));
    mockRpc.sendTransaction.mockResolvedValue({ status: "PENDING" });
    let now = 0;
    vi.spyOn(Date, "now").mockImplementation(() => (now += 30_000));
    await expect(
      buildRelayerTx({
        channel: { ...relayerSourceChannel(), trackPending },
        operation: operation(),
        onSimulationError: (m) => new Error(m),
      }),
    ).rejects.toThrow("finality is unknown");
    const restore = mockRpc.sendTransaction.mock.calls[0]![0];
    expect(trackPending).toHaveBeenCalledWith(
      restore.hash().toString("hex"),
      restore.timeBounds.maxTime,
    );
    expect(mockRpc.simulateTransaction).toHaveBeenCalledTimes(2);
  });

  it("re-records and signs channel auth after restoration requested by authorized simulation", async () => {
    const { buildRelayerTx, withRelayerChannel } = await load(1);
    const auth = [relayerAuthEntry(RELAYER.publicKey())];
    mockRpc.simulateTransaction
      .mockReset()
      .mockResolvedValueOnce(simSuccess(auth))
      .mockResolvedValueOnce(restoreRequired(auth))
      .mockResolvedValueOnce(simSuccess([]))
      .mockResolvedValue(simSuccess(auth));
    mockRpc.sendTransaction.mockResolvedValue({ status: "PENDING" });
    mockRpc.getTransaction.mockResolvedValue({ status: "SUCCESS" });
    const tx = await withRelayerChannel((channel) =>
      buildRelayerTx({
        channel,
        operation: operation(),
        onSimulationError: (m) => new Error(m),
      }),
    );
    expect(mockRpc.simulateTransaction).toHaveBeenCalledTimes(5);
    const freshProbe = mockRpc.simulateTransaction.mock.calls[3]![0];
    expect(freshProbe.operations[0].auth).toEqual([]);
    expect(tx.operations[0]!.type).toBe("invokeHostFunction");
  });

  it.each(["ERROR", "FAILED", "transport", "repeat"])(
    "does not return an invocation after restoration %s",
    async (failure) => {
      const { buildRelayerTx, withRelayerChannel } = await load(0);
      mockRpc.simulateTransaction
        .mockReset()
        .mockResolvedValueOnce(restoreRequired())
        .mockResolvedValueOnce(simSuccess([]))
        .mockResolvedValue(restoreRequired());
      mockRpc.sendTransaction.mockReset();
      if (failure === "transport")
        mockRpc.sendTransaction.mockRejectedValue(new Error("transport"));
      else
        mockRpc.sendTransaction.mockResolvedValue({
          status: failure === "ERROR" ? "ERROR" : "PENDING",
        });
      mockRpc.getTransaction.mockResolvedValue({
        status: failure === "FAILED" ? "FAILED" : "SUCCESS",
      });
      await expect(
        withRelayerChannel((channel) =>
          buildRelayerTx({
            channel,
            operation: operation(),
            onSimulationError: (m) => new Error(m),
          }),
        ),
      ).rejects.toThrow();
      expect(mockRpc.sendTransaction).toHaveBeenCalledTimes(1);
    },
  );
});
