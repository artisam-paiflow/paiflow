import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it, vi } from "vitest";
import {
  completeWallet,
  DISCLAIMER,
  decimal,
  maxSend,
  planShortfall,
  quoteShortfall,
  readWallets,
  remainingWork,
  renderTeamFile,
  stroops,
  type Balance,
} from "@/lib/hackathon/wallets";

const missing: Balance = { exists: false, xlm: "0", usdc: "0", trustline: false };
const funded: Balance = { exists: true, xlm: "9999", usdc: "1000", trustline: true };
const key = Keypair.random();
const wallet = { number: 1, publicKey: key.publicKey(), secretKey: key.secret() };

describe("funding plan", () => {
  it("plans the 36-wallet budget and only buys the shortfall", () => {
    expect(
      planShortfall(
        Array.from({ length: 36 }, () => missing),
        "1000",
        "0",
      ),
    ).toEqual({ total: "36000.0000000", shortfall: "36000.0000000" });
    expect(
      planShortfall([missing, funded, { ...funded, usdc: "999.9999999" }], "1000", "500"),
    ).toEqual({ total: "1000.0000001", shortfall: "500.0000001" });
    expect(planShortfall([funded], "1000", "5000")).toEqual({
      total: "0.0000000",
      shortfall: "0.0000000",
    });
  });
  it("caps send with 5% slippage, rounding up to a stroop", () => {
    expect(maxSend("37852")).toBe("39744.6000000");
    expect(maxSend("0.0000001")).toBe("0.0000002");
  });
  it.each(["-1", "1e3", "0.00000001", "Infinity", "922337203686"])(
    "rejects invalid money %s",
    (amount) => {
      expect(() => stroops(amount)).toThrow();
    },
  );
  it("keeps amounts beyond floating-point precision exact", () => {
    expect(decimal(stroops("900719925.4740993"))).toBe("900719925.4740993");
  });
});

describe("idempotent progress", () => {
  it("distinguishes missing account, trustline and partial funding", () => {
    expect(remainingWork(missing, "1000")).toEqual({
      friendbot: true,
      trustline: true,
      payment: "1000.0000000",
    });
    expect(remainingWork({ ...funded, trustline: false, usdc: "0" }, "1000")).toEqual({
      friendbot: false,
      trustline: true,
      payment: "1000.0000000",
    });
    expect(remainingWork({ ...funded, usdc: "1200" }, "1000").payment).toBe("0.0000000");
  });
  it("does nothing on a completed rerun", async () => {
    const network = {
      balance: vi.fn().mockResolvedValue(funded),
      friendbot: vi.fn(),
      trust: vi.fn(),
      pay: vi.fn(),
    };
    await completeWallet(wallet, "1000", network);
    expect(network.friendbot).not.toHaveBeenCalled();
    expect(network.trust).not.toHaveBeenCalled();
    expect(network.pay).not.toHaveBeenCalled();
  });
  it("resumes after Friendbot and pays only a remaining deficit", async () => {
    const network = {
      balance: vi
        .fn()
        .mockResolvedValueOnce({ ...missing, exists: true, xlm: "10000" })
        .mockResolvedValueOnce({ ...missing, exists: true })
        .mockResolvedValueOnce({ ...funded, usdc: "750" })
        .mockResolvedValue(funded),
      friendbot: vi.fn(),
      trust: vi.fn(),
      pay: vi.fn(),
    };
    await completeWallet(wallet, "1000", network);
    expect(network.friendbot).not.toHaveBeenCalled();
    expect(network.trust).toHaveBeenCalledWith(wallet);
    expect(network.pay).toHaveBeenCalledWith(wallet.publicKey, "250.0000000");
  });
  it("funds a new wallet in order and stops after a failed step", async () => {
    const order: string[] = [];
    const network = {
      balance: vi
        .fn()
        .mockResolvedValueOnce(missing)
        .mockResolvedValueOnce({ ...missing, exists: true })
        .mockResolvedValueOnce({ ...funded, usdc: "0" })
        .mockResolvedValue(funded),
      friendbot: vi.fn(async () => {
        order.push("friendbot");
      }),
      trust: vi.fn(async () => {
        order.push("trust");
      }),
      pay: vi.fn(async () => {
        order.push("pay");
      }),
    };
    await completeWallet(wallet, "1000", network);
    expect(order).toEqual(["friendbot", "trust", "pay"]);
    network.balance.mockResolvedValue(missing);
    network.friendbot.mockRejectedValueOnce(new Error("offline"));
    network.pay.mockClear();
    await expect(completeWallet(wallet, "1000", network)).rejects.toThrow("offline");
    expect(network.pay).not.toHaveBeenCalled();
  });
});

describe("private team handout", () => {
  it("preserves login credentials, renders the exact disclaimer and round-trips keys", () => {
    const login = "# team01\n\nUsername: team01\nPassword: private-password\n";
    const rendered = renderTeamFile(login, [wallet]);
    expect(rendered).toContain(login.trimEnd());
    expect(rendered).toContain(DISCLAIMER);
    expect(readWallets(rendered)).toEqual([wallet]);
    expect(renderTeamFile(rendered, [wallet])).toBe(rendered);
    expect(rendered.match(/## Wallets/g)).toHaveLength(1);
  });
  it("appends extra wallets while keeping notes and refuses replacement keys", () => {
    const existing = renderTeamFile("# team01", [wallet]) + "\nPrivate note for this team.\n";
    const second = Keypair.random();
    const wallets = [
      wallet,
      { number: 2, publicKey: second.publicKey(), secretKey: second.secret() },
    ];
    const rendered = renderTeamFile(existing, wallets);
    expect(rendered).toContain(existing.trimEnd());
    expect(readWallets(rendered)).toEqual(wallets);
    expect(() => renderTeamFile(existing, [wallets[1]!])).toThrow(/replace saved/);
    expect(() => renderTeamFile(existing, [])).toThrow(/replace saved/);
  });
  it("refuses malformed sections, mismatched keys, duplicate wallets and gaps", () => {
    expect(() => readWallets("\n## Wallets\n\n### Wallet 1\nSecret key: broken")).toThrow(
      /Malformed/,
    );
    expect(() =>
      readWallets(renderTeamFile("", [{ ...wallet, publicKey: Keypair.random().publicKey() }])),
    ).toThrow(/Invalid/);
    expect(() => readWallets(renderTeamFile("", [wallet, { ...wallet, number: 2 }]))).toThrow(
      /Invalid/,
    );
    expect(() => readWallets(renderTeamFile("", [{ ...wallet, number: 2 }]))).toThrow(/Invalid/);
    expect(readWallets("# team01\nPassword: private")).toEqual([]);
  });
});

describe("whole-shortfall quote (mocked Horizon)", () => {
  const path = { source_asset_type: "native", source_amount: "37852", destination_amount: "36000" };
  it("requests the entire amount and selects the cheapest whole path", async () => {
    const horizon = vi
      .fn()
      .mockResolvedValue([
        path,
        { ...path, source_amount: "40000" },
        { ...path, destination_amount: "18000", source_amount: "1" },
      ]);
    expect(await quoteShortfall("36000", horizon)).toEqual(path);
    expect(horizon).toHaveBeenCalledExactlyOnceWith("36000");
  });
  it("fails on no liquidity or partial liquidity, with no funding callback", async () => {
    const fund = vi.fn();
    for (const records of [[], [{ ...path, destination_amount: "18000" }]]) {
      await expect(
        quoteShortfall("36000", vi.fn().mockResolvedValue(records)).then(fund),
      ).rejects.toThrow(/entire USDC shortfall/);
    }
    expect(fund).not.toHaveBeenCalled();
  });
  it("skips Horizon when the organiser already has enough USDC", async () => {
    const horizon = vi.fn();
    expect(await quoteShortfall("0", horizon)).toBeUndefined();
    expect(horizon).not.toHaveBeenCalled();
  });
  it("propagates network failures before funding", async () => {
    const fund = vi.fn();
    await expect(
      quoteShortfall("36000", vi.fn().mockRejectedValue(new Error("offline"))).then(fund),
    ).rejects.toThrow("offline");
    expect(fund).not.toHaveBeenCalled();
  });
});
