import { describe, expect, it } from "vitest";
import { messageKey, redactString, sanitizeProps } from "@/lib/analytics/sanitize";

// Valid-shaped StrKeys (base32 body, right length); checksums don't matter to a regex.
const SEED = `S${"A".repeat(55)}`;
const ACCOUNT = `G${"B".repeat(55)}`;
const CONTRACT = `C${"D".repeat(55)}`;
const MUXED = `M${"E".repeat(68)}`;
const XDR = "AAAAAgAAAAB".repeat(20);
const TX_HASH = "a".repeat(64);
const UUID = "3f2b8c1e-9a4d-4e2f-8b1a-2c3d4e5f6a7b";

describe("redactString", () => {
  it("removes secret seeds, addresses and XDR blobs", () => {
    expect(redactString(`seed ${SEED}`)).toBe("seed <secret>");
    expect(redactString(`pay ${ACCOUNT} via ${CONTRACT}`)).toBe("pay <address> via <address>");
    expect(redactString(`to ${MUXED}`)).toBe("to <address>");
    expect(redactString(`envelope ${XDR}`)).toBe("envelope <blob>");
  });

  it("keeps identifiers analytics joins on", () => {
    expect(redactString(TX_HASH)).toBe(TX_HASH);
    expect(redactString(UUID)).toBe(UUID);
  });

  it("caps length", () => {
    expect(redactString("word ".repeat(100))).toHaveLength(200);
  });
});

describe("sanitizeProps", () => {
  it("redacts strings, including inside arrays, and drops nested objects", () => {
    expect(
      sanitizeProps({
        tx_hash: TX_HASH,
        node_types: ["swap", ACCOUNT],
        count: 3,
        ok: true,
        missing: null,
        graph: { nodes: [{ recipient: ACCOUNT }] },
      }),
    ).toEqual({
      tx_hash: TX_HASH,
      node_types: ["swap", "<address>"],
      count: 3,
      ok: true,
      missing: null,
    });
  });
});

describe("messageKey", () => {
  it("groups messages that differ only by numbers and identifiers", () => {
    const a = messageKey(`Account ${ACCOUNT} has 1.5 XLM. Minimum 2 XLM required`);
    const b = messageKey(`Account ${CONTRACT} has 0 XLM. Minimum 150 XLM required`);
    expect(a).toBe(b);
    expect(a).toBe("Account <address> has # XLM. Minimum # XLM required");
  });

  it("normalizes hashes and ids", () => {
    expect(messageKey(`tx ${TX_HASH} for ${UUID}`)).toBe("tx <hash> for <id>");
  });
});

describe("address allowlist", () => {
  const ALLOWED = ["wallet_address", "wallet_address_first", "signer_address"] as const;

  it("passes the signing wallet's own account address intact on an allowed key", () => {
    for (const key of ALLOWED) {
      expect(sanitizeProps({ [key]: ACCOUNT })).toEqual({ [key]: ACCOUNT });
    }
  });

  it("drops anything that is not exactly an account address, rather than sending it redacted", () => {
    for (const value of [
      SEED,
      XDR,
      CONTRACT,
      MUXED,
      `pay ${ACCOUNT} now`,
      ` ${ACCOUNT}`,
      ACCOUNT.toLowerCase(),
      ACCOUNT.slice(0, 55),
      42,
      null,
      true,
      [ACCOUNT],
      { address: ACCOUNT },
    ]) {
      const out = sanitizeProps({ signer_address: value, tx_hash: TX_HASH });
      expect(out, String(value)).toEqual({ tx_hash: TX_HASH });
      expect(out, String(value)).not.toHaveProperty("signer_address");
    }
  });

  it("leaves every other key on today's redaction", () => {
    expect(sanitizeProps({ recipient_address: ACCOUNT })).toEqual({
      recipient_address: "<address>",
    });
    expect(sanitizeProps({ $el_text: ACCOUNT })).toEqual({ $el_text: "<address>" });
    expect(sanitizeProps({ wallet_addresses: ACCOUNT })).toEqual({
      wallet_addresses: "<address>",
    });
    expect(sanitizeProps({ WALLET_ADDRESS: ACCOUNT })).toEqual({ WALLET_ADDRESS: "<address>" });
  });
});
