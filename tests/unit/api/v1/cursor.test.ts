import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor } from "@/lib/api/v1/cursor";

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");

describe("v1 opaque cursor", () => {
  it("round-trips a head and tail", () => {
    const c = encodeCursor("123456", "0000123456-0000000001");
    expect(c).not.toContain("|");
    expect(decodeCursor(c)).toEqual({ head: "123456", tail: "0000123456-0000000001" });
  });

  it("splits on the first separator, so the tail may contain one", () => {
    expect(decodeCursor(encodeCursor("7", "a|b"))).toEqual({ head: "7", tail: "a|b" });
  });

  it.each([
    ["no separator", b64("123456")],
    ["empty head", b64("|abc")],
    ["empty tail", b64("123|")],
    ["empty string", ""],
  ])("rejects %s", (_name, cursor) => {
    expect(decodeCursor(cursor)).toBeNull();
  });
});
