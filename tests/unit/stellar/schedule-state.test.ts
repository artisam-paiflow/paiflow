import { beforeEach, describe, expect, it, vi } from "vitest";
import { Account, Keypair, StrKey, nativeToScVal } from "@stellar/stellar-sdk";
const mocks = vi.hoisted(() => ({
  config: vi.fn(),
  account: vi.fn(),
  sim: vi.fn(),
  balance: vi.fn(),
}));
vi.mock("@/lib/stellar/streamer-config", () => ({ readStreamerConfig: mocks.config }));
vi.mock("@/lib/stellar/client", () => ({
  sorobanRpc: () => ({ getAccount: mocks.account, simulateTransaction: mocks.sim }),
}));
vi.mock("@/lib/stellar/balance", () => ({ fetchTokenBalance: mocks.balance }));
import { readScheduleState } from "@/lib/stellar/schedule-state";
const contract = StrKey.encodeContract(Buffer.alloc(32, 1));
const asset = StrKey.encodeContract(Buffer.alloc(32, 2));
const admin = Keypair.random().publicKey();
let values: Record<string, boolean | bigint>;
beforeEach(() => {
  vi.clearAllMocks();
  values = {
    is_paused: false,
    pause_allowed: true,
    retrieve_allowed: true,
    available: 50n,
    claimed: 20n,
  };
  mocks.config.mockResolvedValue({ admin, asset });
  mocks.account.mockResolvedValue(new Account(admin, "123"));
  mocks.balance.mockResolvedValue(100n);
  mocks.sim.mockImplementation(async (tx) => ({
    result: {
      retval: nativeToScVal(
        values[tx.operations[0].func.invokeContract().functionName().toString()]!,
      ),
    },
  }));
});
describe("Schedule live state", () => {
  it("distinguishes holding funds, vested payout entitlement and actual retrievable amount", async () => {
    expect(await readScheduleState(contract, admin)).toMatchObject({
      balanceStroops: "100",
      availableStroops: "50",
      claimedStroops: "20",
      unvestedStroops: "50",
      retrievableStroops: "0",
      retrievalRecipient: admin,
    });
    values.is_paused = true;
    expect((await readScheduleState(contract, admin)).retrievableStroops).toBe("50");
    values.retrieve_allowed = false;
    expect((await readScheduleState(contract, admin)).retrievableStroops).toBe("0");
  });
  it("does not mistake underfunding for unvested funds", async () => {
    values.available = 200n;
    values.is_paused = true;
    expect(await readScheduleState(contract, admin)).toMatchObject({
      availableStroops: "200",
      balanceStroops: "100",
      unvestedStroops: "0",
      retrievableStroops: "0",
    });
  });
  it("retains precision above JS safe integer", async () => {
    mocks.balance.mockResolvedValue(900719925474099300n);
    expect((await readScheduleState(contract, admin)).unvestedStroops).toBe("900719925474099250");
  });
  it("uses live asset and a fresh read context without signing/submitting", async () => {
    await readScheduleState(contract, admin);
    expect(mocks.balance).toHaveBeenCalledWith({
      tokenAddress: asset,
      holderAddress: contract,
      sourceAccount: admin,
    });
    for (const [tx] of mocks.sim.mock.calls) {
      expect(tx.source).toBe(admin);
      expect(tx.sequence).toBe("124");
      expect(tx.signatures).toHaveLength(0);
      expect(Number(tx.timeBounds.maxTime)).toBeGreaterThan(0);
    }
  });
  it.each(["is_paused", "pause_allowed", "retrieve_allowed", "available", "claimed"])(
    "refuses incorrect type for %s",
    async (method) => {
      values[method] = method === "available" || method === "claimed" ? true : 10n;
      await expect(readScheduleState(contract, admin)).rejects.toMatchObject({
        code: "UPSTREAM_RPC",
      });
    },
  );
  it.each([-1n, 1n << 127n])("refuses invalid amount %s", async (amount) => {
    mocks.balance.mockResolvedValue(amount);
    await expect(readScheduleState(contract, admin)).rejects.toMatchObject({
      code: "UPSTREAM_RPC",
    });
  });
  it("does not synthesize zeros on failed state simulations", async () => {
    mocks.sim.mockResolvedValue({ error: "unavailable", events: [] });
    await expect(readScheduleState(contract, admin)).rejects.toMatchObject({
      code: "UPSTREAM_RPC",
    });
  });
  it("can fall back to live account controller when provenance source is absent", async () => {
    await readScheduleState(contract, null);
    expect(mocks.account).toHaveBeenCalledWith(admin);
  });
});
