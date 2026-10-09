import { describe, expect, it } from "vitest";
import { fieldErrorUnder, nodeIssues } from "@/lib/flows/issue-paths";
import type { ValidationIssue } from "@/lib/flows/validate";

const issue = (path: string, friendlyMessage: string): ValidationIssue => ({
  path,
  message: `tech: ${friendlyMessage}`,
  friendlyMessage,
});

describe("nodeIssues", () => {
  it("keys a semantic path by its config field", () => {
    const r = nodeIssues([issue("nodes.s.config.slippageBps", "too low")], "s", 1);
    expect([...r.field]).toEqual([["slippageBps", "too low"]]);
    expect(r.general).toEqual([]);
  });

  it("matches a positional (Zod) path by the node's index", () => {
    const r = nodeIssues(
      [issue("nodes.1.config.recipients.0.address", "bad address")],
      "split-a",
      1,
    );
    expect(r.field.get("recipients.0.address")).toBe("bad address");
  });

  it("puts a node-level issue in general", () => {
    const r = nodeIssues(
      [issue("nodes.s", "needs a next step"), issue("nodes.s.config", "whole config")],
      "s",
      0,
    );
    expect(r.field.size).toBe(0);
    expect(r.general).toEqual(["needs a next step", "whole config"]);
  });

  it("keeps the first issue when two land on one field", () => {
    const r = nodeIssues(
      [issue("nodes.s.config.assetOut", "first"), issue("nodes.s.config.assetOut", "second")],
      "s",
      0,
    );
    expect(r.field.get("assetOut")).toBe("first");
  });

  it("ignores other nodes, other indices, edges and graph-level paths", () => {
    const r = nodeIssues(
      [
        issue("nodes.other.config.asset", "x"),
        issue("nodes.2.config.asset", "x"),
        issue("edges.e1", "x"),
        issue("nodes", "x"),
        issue("senderKyc", "x"),
      ],
      "s",
      0,
    );
    expect(r.field.size).toBe(0);
    expect(r.general).toEqual([]);
  });
});

describe("fieldErrorUnder", () => {
  const map = (entries: [string, string][]) => new Map(entries);

  it("returns the field's own message", () => {
    expect(fieldErrorUnder(map([["asset", "mismatch"]]), "asset")).toBe("mismatch");
  });

  it("falls back to a nested key's message", () => {
    expect(fieldErrorUnder(map([["asset.issuer", "Invalid issuer"]]), "asset")).toBe(
      "Invalid issuer",
    );
  });

  it("prefers the field's own message over a nested one", () => {
    expect(
      fieldErrorUnder(
        map([
          ["asset.code", "bad code"],
          ["asset", "mismatch"],
        ]),
        "asset",
      ),
    ).toBe("mismatch");
  });

  it("does not match a sibling that only shares the prefix", () => {
    expect(
      fieldErrorUnder(
        map([
          ["assetIn", "x"],
          ["assetOut.code", "y"],
        ]),
        "asset",
      ),
    ).toBeNull();
  });

  it("returns null with nothing under the field", () => {
    expect(fieldErrorUnder(map([["recipient", "x"]]), "asset")).toBeNull();
  });

  it("reads a Zod positional path end to end through nodeIssues", () => {
    const r = nodeIssues([issue("nodes.0.config.asset.code", "bad code")], "t", 0);
    expect(fieldErrorUnder(r.field, "asset")).toBe("bad code");
  });
});
