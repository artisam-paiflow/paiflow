/**
 * `redactDeep` is the browser's `before_send`, the layer that runs on every
 * event posthog-js emits, autocaptured ones included. Person properties travel
 * inside `properties.$set` / `$set_once`, so the allowlist has to hold at depth
 * or the wallet_address person property ships as "<address>" and the feature
 * looks like it works while the data is garbage.
 */
import { describe, expect, it } from "vitest";
import { redactDeep } from "@/lib/analytics/client";

const SEED = `S${"A".repeat(55)}`;
const ACCOUNT = `G${"B".repeat(55)}`;
const CONTRACT = `C${"D".repeat(55)}`;

describe("redactDeep", () => {
  it("passes an allowlisted address at the top level and inside $set / $set_once", () => {
    expect(
      redactDeep({
        signer_address: ACCOUNT,
        $set: { wallet_address: ACCOUNT, role: "USER" },
        $set_once: { wallet_address_first: ACCOUNT },
      }),
    ).toEqual({
      signer_address: ACCOUNT,
      $set: { wallet_address: ACCOUNT, role: "USER" },
      $set_once: { wallet_address_first: ACCOUNT },
    });
  });

  it("still redacts an address on any other key, at any depth", () => {
    expect(
      redactDeep({
        $el_text: ACCOUNT,
        $set: { $el_text: ACCOUNT, recipient: ACCOUNT },
        $exception_list: [{ value: `sent to ${CONTRACT}` }],
      }),
    ).toEqual({
      $el_text: "<address>",
      $set: { $el_text: "<address>", recipient: "<address>" },
      $exception_list: [{ value: "sent to <address>" }],
    });
  });

  it("drops a non-address on an allowlisted key instead of sending it", () => {
    expect(redactDeep({ $set: { wallet_address: SEED, role: "USER" } })).toEqual({
      $set: { role: "USER" },
    });
    expect(redactDeep({ signer_address: `pay ${ACCOUNT}`, ok: true })).toEqual({ ok: true });
  });

  it("keeps non-string leaves and honours the depth cap", () => {
    expect(redactDeep({ n: 3, ok: false, none: null, list: [1, "x"] })).toEqual({
      n: 3,
      ok: false,
      none: null,
      list: [1, "x"],
    });
    const deep = { a: { b: { c: { d: { e: { f: { g: { h: ACCOUNT } } } } } } } };
    const out = redactDeep(deep) as typeof deep;
    // Past the cap the value is returned as-is; the cap only bounds the walk.
    expect(out.a.b.c.d.e.f.g).toEqual({ h: ACCOUNT });
  });
});
