import { afterEach, describe, expect, it, vi } from "vitest";
import { NotFoundError } from "@stellar/stellar-sdk";
import { horizon } from "@/lib/stellar/client";
import { checkPayoutTrustlines } from "@/lib/stellar/trustline-check";
import { payoutRecipients } from "@/lib/flows/payout-recipients";
import type { FlowGraph } from "@/lib/flows/schema";

vi.mock("@/lib/stellar/client", () => ({ horizon: vi.fn() }));

// Circle's testnet USDC, which `resolveAsset` maps `known:USDC` to on testnet.
const USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
// Stands in for the other testnet "USDC" a real recipient trusted by mistake (#574).
const WRONG_ISSUER = "GCF323WKLA4IEBYRRSUSIXKFECZDQDMIFPB5EENSQY26QWRRG7VIDLRK";
const RECIPIENT = "GAUF2ILE2UGAAFJZBUSICBTRMOL5TDGBZRXHYO4O5P5RMAPJ24YCV2XQ";
const USDC = { kind: "known" as const, symbol: "USDC" as const };

function mockLoadAccount(impl: () => Promise<unknown>) {
  const loadAccount = vi.fn(impl);
  vi.mocked(horizon).mockReturnValue({ loadAccount } as unknown as ReturnType<typeof horizon>);
  return loadAccount;
}
const mockBalances = (balances: unknown[]) => mockLoadAccount(async () => ({ balances }));

const trustline = (code: string, issuer: string) => ({
  asset_type: "credit_alphanum4",
  asset_code: code,
  asset_issuer: issuer,
  balance: "0.0000000",
});
const xlm = { asset_type: "native", balance: "10.0000000" };

afterEach(() => vi.mocked(horizon).mockReset());

describe("checkPayoutTrustlines", () => {
  it("is ok when the recipient trusts the payout asset from the flow's issuer", async () => {
    mockBalances([xlm, trustline("USDC", WRONG_ISSUER), trustline("USDC", USDC_ISSUER)]);
    const [r] = await checkPayoutTrustlines([{ nodeId: "p", address: RECIPIENT, asset: USDC }]);
    expect(r).toMatchObject({ status: "ok", assetCode: "USDC", assetIssuer: USDC_ISSUER });
  });

  it("warns, naming the expected issuer, when the only USDC trustline is to another issuer", async () => {
    mockBalances([xlm, trustline("USDC", WRONG_ISSUER)]);
    const [r] = await checkPayoutTrustlines([{ nodeId: "p", address: RECIPIENT, asset: USDC }]);
    expect(r).toEqual({
      nodeId: "p",
      address: RECIPIENT,
      status: "no_trustline",
      assetCode: "USDC",
      assetIssuer: USDC_ISSUER,
      otherIssuers: [WRONG_ISSUER],
    });
  });

  it("warns when the account holds XLM only", async () => {
    mockBalances([xlm]);
    const [r] = await checkPayoutTrustlines([{ nodeId: "p", address: RECIPIENT, asset: USDC }]);
    expect(r).toMatchObject({ status: "no_trustline", otherIssuers: [] });
  });

  it("checks a custom asset against its own issuer", async () => {
    mockBalances([trustline("ABC", WRONG_ISSUER)]);
    const [r] = await checkPayoutTrustlines([
      {
        nodeId: "p",
        address: RECIPIENT,
        asset: { kind: "custom", code: "ABC", issuer: USDC_ISSUER },
      },
    ]);
    expect(r).toMatchObject({ status: "no_trustline", assetIssuer: USDC_ISSUER });
  });

  it("warns when Horizon has no such account (404)", async () => {
    mockLoadAccount(async () => {
      throw new NotFoundError("Account not found", {
        type: "https://stellar.org/horizon-errors/not_found",
        title: "Resource Missing",
        status: 404,
      });
    });
    const [r] = await checkPayoutTrustlines([{ nodeId: "p", address: RECIPIENT, asset: USDC }]);
    expect(r).toMatchObject({ status: "no_account", assetCode: "USDC", assetIssuer: USDC_ISSUER });
  });

  it("reports unknown, without throwing, when Horizon fails", async () => {
    mockLoadAccount(async () => {
      throw new Error("socket hang up");
    });
    const [r] = await checkPayoutTrustlines([{ nodeId: "p", address: RECIPIENT, asset: USDC }]);
    expect(r).toMatchObject({ status: "unknown", assetIssuer: USDC_ISSUER });
  });

  it("does not look up a native payout", async () => {
    const loadAccount = mockBalances([]);
    const [r] = await checkPayoutTrustlines([
      { nodeId: "p", address: RECIPIENT, asset: { kind: "native" } },
    ]);
    expect(r).toMatchObject({ status: "not_needed" });
    expect(loadAccount).not.toHaveBeenCalled();
  });

  it("skips a PENDING recipient without a lookup", async () => {
    const loadAccount = mockBalances([]);
    const [r] = await checkPayoutTrustlines([
      { nodeId: "p", address: "PENDING:alice", asset: USDC },
    ]);
    expect(r).toMatchObject({ status: "skipped" });
    expect(loadAccount).not.toHaveBeenCalled();
  });

  it("looks each account up once however many payouts it receives", async () => {
    const loadAccount = mockBalances([trustline("USDC", USDC_ISSUER)]);
    const out = await checkPayoutTrustlines([
      { nodeId: "a", address: RECIPIENT, asset: USDC },
      { nodeId: "b", address: RECIPIENT, asset: USDC },
    ]);
    expect(out.map((r) => r.status)).toEqual(["ok", "ok"]);
    expect(loadAccount).toHaveBeenCalledTimes(1);
  });
});

describe("payoutRecipients", () => {
  it("collects crypto Pay and Split recipients with their node's asset, not fiat ones", () => {
    const graph = {
      nodes: [
        { id: "t", type: "on_receive", position: { x: 0, y: 0 }, config: { asset: USDC } },
        {
          id: "p",
          type: "pay",
          position: { x: 0, y: 0 },
          config: { recipient: RECIPIENT, asset: USDC, fullAmount: true },
        },
        {
          id: "f",
          type: "pay",
          position: { x: 0, y: 0 },
          config: { recipient: RECIPIENT, asset: USDC, fullAmount: true, payoutMode: "fiat" },
        },
        {
          id: "s",
          type: "split",
          position: { x: 0, y: 0 },
          config: {
            asset: { kind: "native" },
            recipients: [
              { address: WRONG_ISSUER, label: "Bob", mode: "percentage", bps: 5000 },
              { address: RECIPIENT, mode: "percentage", bps: 5000, payoutMode: "fiat" },
            ],
          },
        },
      ],
      edges: [],
    } as unknown as FlowGraph;

    expect(payoutRecipients(graph)).toEqual([
      { nodeId: "p", address: RECIPIENT, asset: USDC },
      { nodeId: "s", address: WRONG_ISSUER, label: "Bob", asset: { kind: "native" } },
    ]);
  });
});
