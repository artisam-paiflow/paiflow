import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import {
  Account,
  Address,
  Asset,
  BASE_FEE,
  Contract,
  Keypair,
  Networks,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
} from "@stellar/stellar-sdk";
const mocks = vi.hoisted(() => ({ expired: vi.fn(), status: vi.fn(), limit: vi.fn() }));
vi.mock("@/lib/stellar/allowance-status", () => ({ allowanceHasExpired: mocks.expired }));
vi.mock("@/app/api/deployments/[id]/tx-status/route", () => ({ GET: mocks.status }));
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: mocks.limit,
  clientIp: () => "203.0.113.1",
}));
import { GET } from "@/app/api/deployments/[id]/subscription-allowance/status/route";
import { createAllowanceIntent } from "@/lib/subscription/intent";
import { AppError } from "@/lib/errors";
const id = "11111111-1111-4111-8111-111111111111";
const wallet = Keypair.random();
const spender = StrKey.encodeContract(Buffer.alloc(32, 1));
const token = Asset.native().contractId(Networks.TESTNET);
const tx = new TransactionBuilder(new Account(wallet.publicKey(), "1"), {
  fee: BASE_FEE,
  networkPassphrase: Networks.TESTNET,
})
  .addOperation(
    new Contract(token).call(
      "approve",
      new Address(wallet.publicKey()).toScVal(),
      new Address(spender).toScVal(),
      nativeToScVal(1n, { type: "i128" }),
      nativeToScVal(12345, { type: "u32" }),
    ),
  )
  .setTimeout(180)
  .build();
const prepared = createAllowanceIntent(
  tx.toXDR(),
  {
    preparationLedger: 90,
    deploymentId: id,
    network: "testnet",
    subscriber: wallet.publicKey(),
    tokenContractAddress: token,
    contractAddress: spender,
  },
  "1",
);
function request(intent = prepared.intent) {
  return new NextRequest(
    `https://paiflow.test/api/deployments/${id}/subscription-allowance/status?intent=${encodeURIComponent(intent)}`,
  );
}
const ctx = { params: Promise.resolve({ id }) };
afterEach(() => {
  vi.resetAllMocks();
  vi.restoreAllMocks();
});
describe("scoped approval reconciliation", () => {
  it("reuses confirmation bookkeeping on the exact prepared hash", async () => {
    mocks.expired.mockResolvedValue(false);
    mocks.status.mockResolvedValue(
      NextResponse.json({ data: { status: "SUCCESS", txHash: prepared.txHash } }),
    );
    const response = await GET(request(), ctx);
    expect((await response.json()).data.status).toBe("SUCCESS");
    expect(mocks.status.mock.calls[0]![0].nextUrl.searchParams.get("txHash")).toBe(prepared.txHash);
  });
  it("reports ledger-proven expiry even after the submit intent expires", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 11 * 60_000);
    mocks.expired.mockResolvedValue(true);
    const response = await GET(request(), ctx);
    expect((await response.json()).data).toMatchObject({
      status: "FAILED",
      errorMessage: "Approval expired without confirmation",
    });
    expect(mocks.status).not.toHaveBeenCalled();
  });
  it("keeps uncertainty when the ledger proof fails", async () => {
    mocks.expired.mockRejectedValue(new AppError("UPSTREAM_RPC", "Cannot establish finality"));
    expect((await GET(request(), ctx)).status).toBe(502);
    expect(mocks.status).not.toHaveBeenCalled();
  });
  it("refuses forged and cross-deployment status intents before chain reads", async () => {
    expect((await GET(request(prepared.intent + "x"), ctx)).status).toBe(422);
    expect(
      (
        await GET(request(), {
          params: Promise.resolve({ id: "22222222-2222-4222-8222-222222222222" }),
        })
      ).status,
    ).toBe(422);
    expect(mocks.expired).not.toHaveBeenCalled();
  });
});
