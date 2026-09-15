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
