import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPendingContractCall,
  contractCallPendingKey,
  readPendingContractCall,
  savePendingContractCall,
  withContractCallLock,
} from "@/lib/contract-call-pending";

const HASH = "a".repeat(64);
const OTHER = "b".repeat(64);
const KEY = contractCallPendingKey("deployment", "testnet");
let values: Map<string, string>;
let storage: {
  getItem: ReturnType<typeof vi.fn>;
  setItem: ReturnType<typeof vi.fn>;
  removeItem: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  values = new Map();
  storage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    removeItem: vi.fn((key: string) => values.delete(key)),
  };
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("navigator", {
    locks: {
      request: async (_key: string, _options: unknown, action: (lock: object) => Promise<void>) =>
        action({}),
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("contract action recovery storage", () => {
  it("scopes deployments/networks and persists only the public hash", () => {
    expect(contractCallPendingKey("deployment", "mainnet")).not.toBe(KEY);
    expect(contractCallPendingKey("other", "testnet")).not.toBe(KEY);
    const value = { txHash: HASH, actionKey: "not-persisted", arbitrary: "not-persisted" };
    savePendingContractCall(KEY, value);
    expect(values.get(KEY)).toBe(JSON.stringify({ txHash: HASH }));
    expect(readPendingContractCall(KEY)).toEqual({ txHash: HASH });
  });

  it.each([
    "",
    "broken",
    "null",
    "{}",
    '"hash"',
    JSON.stringify({ txHash: "a".repeat(63) }),
    JSON.stringify({ txHash: "A".repeat(64) }),
  ])("refuses invalid stored recovery state without clearing it: %s", (raw) => {
    values.set(KEY, raw);
    expect(() => readPendingContractCall(KEY)).toThrow();
    expect(values.get(KEY)).toBe(raw);
  });

  it("never overwrites an existing pending hash, including the same unknown hash", () => {
    savePendingContractCall(KEY, { txHash: HASH });
    expect(() => savePendingContractCall(KEY, { txHash: OTHER })).toThrow();
    expect(() => savePendingContractCall(KEY, { txHash: HASH })).toThrow();
    expect(readPendingContractCall(KEY)?.txHash).toBe(HASH);
  });

  it("clears only the matching hash, preserving a replacement marker", () => {
    savePendingContractCall(KEY, { txHash: HASH });
    clearPendingContractCall(KEY, OTHER);
    expect(readPendingContractCall(KEY)?.txHash).toBe(HASH);
    clearPendingContractCall(KEY, HASH);
    expect(readPendingContractCall(KEY)).toBeNull();
  });

  it("fails closed on inaccessible storage or failed write verification", () => {
    storage.getItem.mockImplementationOnce(() => {
      throw new Error("Storage disabled");
    });
    expect(() => readPendingContractCall(KEY)).toThrow();
    storage.getItem.mockReturnValue(null);
    expect(() => savePendingContractCall(KEY, { txHash: HASH })).toThrow(/could not be saved/);
  });
});

describe("contract action write exclusion", () => {
  it("excludes another same-page action while retaining the first lock", async () => {
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const held = withContractCallLock(KEY, async () => {
      entered();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    await started;
    await expect(withContractCallLock(KEY, async () => {})).rejects.toThrow(/being processed/);
    release();
    await held;
    await expect(withContractCallLock(KEY, async () => {})).resolves.toBeUndefined();
  });

  it("rejects an unavailable origin lock without running the action", async () => {
    vi.stubGlobal("navigator", {
      locks: {
        request: async (_key: string, _options: unknown, action: (lock: null) => Promise<void>) =>
          action(null),
      },
    });
    const action = vi.fn();
    await expect(withContractCallLock(KEY, action)).rejects.toThrow(/Another tab/);
    expect(action).not.toHaveBeenCalled();
  });

  it("requires Web Locks instead of silently falling back to an unsafe write", async () => {
    vi.stubGlobal("navigator", {});
    const action = vi.fn();
    await expect(withContractCallLock(KEY, action)).rejects.toThrow(/cannot safely coordinate/);
    expect(action).not.toHaveBeenCalled();
  });
});

describe("signing reservation CAS", () => {
  it("promotes only its exact signing attempt and preserves only public fields", async () => {
    const { markPendingContractCallSubmitted, rejectPendingContractCallSigning } =
      await import("@/lib/contract-call-pending");
    const attempt = { txHash: HASH, phase: "signing" as const, attemptId: crypto.randomUUID() };
    savePendingContractCall(KEY, { ...attempt, signedXdr: "never copy" } as typeof attempt);
    expect(readPendingContractCall(KEY)).toEqual(attempt);
    const stale = { ...attempt, attemptId: crypto.randomUUID() };
    expect(() => markPendingContractCallSubmitted(KEY, stale)).toThrow(/ended or changed/);
    rejectPendingContractCallSigning(KEY, stale);
    expect(readPendingContractCall(KEY)).toEqual(attempt);
    markPendingContractCallSubmitted(KEY, attempt);
    expect(readPendingContractCall(KEY)).toEqual({ ...attempt, phase: "submitted" });
    rejectPendingContractCallSigning(KEY, attempt);
    expect(readPendingContractCall(KEY)?.phase).toBe("submitted");
    expect(values.get(KEY)).not.toContain("never copy");
    expect(() => markPendingContractCallSubmitted(KEY, attempt)).toThrow();
  });
  it("does not cancel a legacy marker or a newer same-hash reservation", async () => {
    const { rejectPendingContractCallSigning } = await import("@/lib/contract-call-pending");
    const attempt = { txHash: HASH, phase: "signing" as const, attemptId: crypto.randomUUID() };
    savePendingContractCall(KEY, { txHash: HASH });
    rejectPendingContractCallSigning(KEY, attempt);
    expect(readPendingContractCall(KEY)).toEqual({ txHash: HASH });
    clearPendingContractCall(KEY, HASH);
    savePendingContractCall(KEY, attempt);
    rejectPendingContractCallSigning(KEY, attempt);
    expect(readPendingContractCall(KEY)).toBeNull();
  });
});
