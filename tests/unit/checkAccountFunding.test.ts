import { describe, expect, it, vi, beforeEach } from "vitest";
import { NotFoundError } from "@stellar/stellar-sdk";
import { checkAccountFunding } from "@/lib/stellar/deploy";
import { horizon } from "@/lib/stellar/client";

vi.mock("@/lib/stellar/client");

describe("checkAccountFunding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws INSUFFICIENT_FUNDS when balance is below minimum", async () => {
    const mockAcct = { balances: [{ asset_type: "native", balance: "0.5" }] };
    vi.mocked(horizon).mockReturnValue({
      loadAccount: async () => mockAcct,
    } as unknown as unknown as ReturnType<typeof horizon>);

    await expect(
      checkAccountFunding("GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"),
    ).rejects.toMatchObject({
      code: "INSUFFICIENT_FUNDS",
    });
  });

  it("throws INSUFFICIENT_FUNDS when balance is zero", async () => {
    const mockAcct = { balances: [{ asset_type: "native", balance: "0" }] };
    vi.mocked(horizon).mockReturnValue({
      loadAccount: async () => mockAcct,
    } as unknown as ReturnType<typeof horizon>);

    await expect(
      checkAccountFunding("GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"),
    ).rejects.toMatchObject({
      code: "INSUFFICIENT_FUNDS",
    });
  });

  it("throws INSUFFICIENT_FUNDS when account is not funded (NotFoundError)", async () => {
    const error = new NotFoundError("Account not found", {
      type: "https://stellar.org/horizon-errors/not_found",
      title: "Resource Missing",
      status: 404,
      detail: "The resource at the url requested was not found.",
    });
    vi.mocked(horizon).mockReturnValue({
      loadAccount: async () => {
        throw error;
      },
    } as unknown as ReturnType<typeof horizon>);

    await expect(
      checkAccountFunding("GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"),
    ).rejects.toMatchObject({
      code: "INSUFFICIENT_FUNDS",
    });
  });

  it("succeeds when balance is at minimum (2 XLM)", async () => {
    const mockAcct = { balances: [{ asset_type: "native", balance: "2" }] };
    vi.mocked(horizon).mockReturnValue({
      loadAccount: async () => mockAcct,
    } as unknown as ReturnType<typeof horizon>);

    await expect(
      checkAccountFunding("GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"),
    ).resolves.toBeUndefined();
  });

  it("succeeds when balance exceeds minimum", async () => {
    const mockAcct = { balances: [{ asset_type: "native", balance: "100.5" }] };
    vi.mocked(horizon).mockReturnValue({
      loadAccount: async () => mockAcct,
    } as unknown as ReturnType<typeof horizon>);

    await expect(
      checkAccountFunding("GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"),
    ).resolves.toBeUndefined();
  });

  it("uses custom minLumens when provided", async () => {
    const mockAcct = { balances: [{ asset_type: "native", balance: "0.04" }] };
    vi.mocked(horizon).mockReturnValue({
      loadAccount: async () => mockAcct,
    } as unknown as ReturnType<typeof horizon>);

    await expect(
      checkAccountFunding("GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5", 500_000n),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_FUNDS" });
  });

  it("passes with custom minLumens when balance meets it", async () => {
    const mockAcct = { balances: [{ asset_type: "native", balance: "0.06" }] };
    vi.mocked(horizon).mockReturnValue({
      loadAccount: async () => mockAcct,
    } as unknown as ReturnType<typeof horizon>);

    await expect(
      checkAccountFunding("GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5", 500_000n),
    ).resolves.toBeUndefined();
  });
});
