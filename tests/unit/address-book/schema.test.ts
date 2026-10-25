import { describe, expect, it } from "vitest";
import { CreateAddressContactSchema } from "@/lib/address-book/schema";

const ADDRESS = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
describe("Contact creation schema", () => {
  it("trims a contact name and wallet address and retains create-only intent", () => {
    expect(
      CreateAddressContactSchema.parse({
        label: " Alice ",
        address: ` ${ADDRESS} `,
        createOnly: true,
      }),
    ).toEqual({ label: "Alice", address: ADDRESS, createOnly: true });
  });
  it("keeps existing callers' upsert behavior unless create-only is requested", () => {
    expect(CreateAddressContactSchema.parse({ label: "Alice", address: ADDRESS }).createOnly).toBe(
      false,
    );
  });
  it.each([
    { label: "" },
    { label: "   " },
    { label: "x".repeat(65) },
    { label: 123 },
    { address: "GABC" },
    { address: "PENDING:Alice" },
    { address: "S".repeat(56) },
    { address: "CAEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQTD2L" },
    { createOnly: "true" },
    { createOnly: 1 },
  ])("refuses invalid contact input %j", (override) => {
    expect(
      CreateAddressContactSchema.safeParse({ label: "Alice", address: ADDRESS, ...override })
        .success,
    ).toBe(false);
  });
});
