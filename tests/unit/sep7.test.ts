import { describe, expect, it } from "vitest";
import { sep7PaymentUri } from "@/lib/stellar/sep7";

describe("sep7PaymentUri", () => {
  it("encodes destination and message", () => {
    const uri = sep7PaymentUri({
      destination: "CONTRACTADDRESS",
      asset: { kind: "native" },
      message: "hi",
    });
    expect(uri.startsWith("web+stellar:pay?")).toBe(true);
    expect(uri).toContain("destination=CONTRACTADDRESS");
    expect(uri).toContain("msg=hi");
  });
});
