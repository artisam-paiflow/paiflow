import { describe, expect, it } from "vitest";
import { nodeIssues } from "@/lib/flows/issue-paths";
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
