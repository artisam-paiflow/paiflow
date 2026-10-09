import { describe, expect, it } from "vitest";
import { googleStartUrl } from "@/lib/auth/google-navigation";
describe("canonical Google startup navigation", () => {
  it("stays on the callback's configured host and only carries safe relative return paths", () => {
    const target = new URL(
      googleStartUrl(
        "https://canonical.example",
        "https://alias.example",
        false,
        "/flows/new?template=pay",
      )!,
    );
    expect(target.origin).toBe("https://canonical.example");
    expect(target.pathname).toBe("/login");
    expect(target.searchParams.get("from")).toBe("/flows/new?template=pay");
    for (const path of [
      "https://attacker.example",
      "//attacker.example",
      "/\\attacker.example",
      "/\t/attacker.example",
    ])
      expect(
        new URL(
          googleStartUrl("https://canonical.example", "https://alias.example", false, path)!,
        ).searchParams.get("from"),
      ).toBe("/dashboard");
  });
  it("linking aliases navigate only to canonical Account before any consent cookie is created", () => {
    expect(
      googleStartUrl(
        "https://canonical.example",
        "https://alias.example",
        true,
        "https://attacker.example",
      ),
    ).toBe("https://canonical.example/account");
  });
  it("does not navigate away when already canonical or no canonical origin is supplied", () => {
    expect(
      googleStartUrl("https://canonical.example", "https://canonical.example", false),
    ).toBeNull();
    expect(googleStartUrl(undefined, "http://localhost:3000", false)).toBeNull();
  });
});
