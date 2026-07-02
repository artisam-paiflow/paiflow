import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";

const testKp = Keypair.random();
const testSecret = testKp.secret();
const testPublic = testKp.publicKey();
const testDestination = "GCK2MUVH6TABTXT4247CIEC5EO24CQQ4MZNW7EGBTP3TPGALLQI7P34G";

const { mockHorizon, mockTransactionFn, mockTransactionCall } = vi.hoisted(() => {
  const mockTransactionCall = vi.fn();
  const mockTransactionFn = vi.fn(() => ({ call: mockTransactionCall }));
  const mockHorizon = {
    loadAccount: vi.fn(),
    submitTransaction: vi.fn(),
    transactions: vi.fn(() => ({
      transaction: mockTransactionFn,
    })),
  };
  return { mockHorizon, mockTransactionFn, mockTransactionCall };
});

vi.mock("@/lib/env", () => ({
  env: () => ({ LOG_LEVEL: "silent" }),
  stellarRelayerSecretKey: () => testSecret,
  stellarPassphrase: () => "Test SDF Network ; September 2015",
  stellarRelayerAddress: () => testPublic,
  offRampTreasuryAddress: () => testPublic,
}));

vi.mock("@/lib/stellar/client", () => ({
  horizon: () => mockHorizon,
  withRelayerLock: (fn: () => Promise<unknown>) => fn(),
}));

import { depositNativeToProvider } from "@/lib/stellar/dev-mutate";

function makeAccount(seq = "1") {
  return {
    accountId: () => testPublic,
    sequenceNumber: () => seq,
    incrementSequenceNumber: () => {},
  };
}

describe("depositNativeToProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHorizon.loadAccount.mockResolvedValue(makeAccount());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns SUCCESS when Horizon submit resolves successfully", async () => {
    mockHorizon.submitTransaction.mockResolvedValue({ successful: true, hash: "tx-1" });

    const result = await depositNativeToProvider({
      destination: testDestination,
      memo: "3777239912",
      amountStroops: "10000000",
    });

    expect(result.status).toBe("SUCCESS");
    expect(result.txHash).toBe("tx-1");
  });

  it("returns FAILED when Horizon submit resolves unsuccessful", async () => {
    mockHorizon.submitTransaction.mockResolvedValue({ successful: false, hash: "tx-1" });

    const result = await depositNativeToProvider({
      destination: testDestination,
      memo: "3777239912",
      amountStroops: "10000000",
    });

    expect(result.status).toBe("FAILED");
    expect(result.txHash).toBe("tx-1");
  });

  it("returns SUCCESS when submit throws but Horizon lookup confirms success", async () => {
    mockHorizon.submitTransaction.mockRejectedValue(new Error("timeout"));
    mockTransactionCall.mockResolvedValue({ successful: true });

    const result = await depositNativeToProvider({
      destination: testDestination,
      memo: "3777239912",
      amountStroops: "10000000",
    });

    expect(result.status).toBe("SUCCESS");
    expect(result.txHash).toMatch(/^[0-9a-f]{64}$/);
    expect(mockTransactionFn).toHaveBeenCalledWith(result.txHash);
  });

  it("returns FAILED when submit throws but Horizon lookup confirms failure", async () => {
    mockHorizon.submitTransaction.mockRejectedValue(new Error("timeout"));
    mockTransactionCall.mockResolvedValue({ successful: false });

    const result = await depositNativeToProvider({
      destination: testDestination,
      memo: "3777239912",
      amountStroops: "10000000",
    });

    expect(result.status).toBe("FAILED");
    expect(result.txHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns UNKNOWN when submit throws and Horizon lookup cannot confirm", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockHorizon.submitTransaction.mockRejectedValue(new Error("timeout"));
    mockTransactionCall.mockRejectedValue(new Error("not found"));

    const promise = depositNativeToProvider({
      destination: testDestination,
      memo: "3777239912",
      amountStroops: "10000000",
    });
    await vi.advanceTimersByTimeAsync(11_000);
    const result = await promise;

    expect(result.status).toBe("UNKNOWN");
    expect(result.txHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.errorMessage).toMatch(/timeout/);
  });

  it("returns FAILED when loadAccount fails before any tx is built", async () => {
    mockHorizon.loadAccount.mockRejectedValue(new Error("horizon unavailable"));

    const result = await depositNativeToProvider({
      destination: testDestination,
      memo: "3777239912",
      amountStroops: "10000000",
    });

    expect(result.status).toBe("FAILED");
    expect(result.errorMessage).toMatch(/horizon unavailable/);
  });
});
