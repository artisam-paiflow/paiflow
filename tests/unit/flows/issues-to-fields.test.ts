import { describe, expect, it } from "vitest";
import { issuesToFields } from "@/lib/flows/issues-to-fields";

describe("issuesToFields", () => {
  it("accumulates two issues on one path instead of dropping the first", () => {
    expect(
      issuesToFields([
        { path: "nodes.s", message: "a", friendlyMessage: "First." },
        { path: "nodes.s.config.slippageBps", message: "b", friendlyMessage: "Second." },
        { path: "nodes.s", message: "c", friendlyMessage: "Third." },
      ]),
    ).toEqual({
      "nodes.s": ["First.", "Third."],
      "nodes.s.config.slippageBps": ["Second."],
    });
  });

  it("carries the friendly text, not the technical message", () => {
    const fields = issuesToFields([
      {
        path: "nodes.s.config.slippageBps",
        message: "Swap slippage must be at least 30 bps",
        friendlyMessage: "Set it to at least 0.3%.",
      },
    ]);
    expect(fields["nodes.s.config.slippageBps"]).toEqual(["Set it to at least 0.3%."]);
  });

  it("is empty for no issues", () => {
    expect(issuesToFields([])).toEqual({});
  });
});
