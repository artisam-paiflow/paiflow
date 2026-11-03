import { describe, expect, it } from "vitest";
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import {
  ConfirmedNodeConfigurationSchema,
  FlowFieldPoliciesSchema,
  type ExecutionArguments,
} from "@/lib/flows/field-policies";
import { assertExecutionValues } from "@/lib/api/v1/execution-values";
import { executionIdempotencyKey, executionRequestDigest } from "@/lib/api/v1/execution-intent";

const platform = Keypair.random().publicKey();
const worker = Keypair.random().publicKey();
const other = Keypair.random().publicKey();
const contract = StrKey.encodeContract(Buffer.alloc(32, 4));
function split(mode: "percentage" | "fixed" = "percentage") {
  const policies = FlowFieldPoliciesSchema.parse({
    version: 1,
    nodes: [
      {
        kind: "split",
        nodeId: "split",
        allocationMode: mode,
        rows: [{ rowId: "platform" }],
        additionalRecipients: "execution",
      },
    ],
  });
  const configuration = ConfirmedNodeConfigurationSchema.parse({
    version: 1,
    nodeId: "split",
    contractAddress: contract,
    confirmedLedger: 10,
    revision: "0",
    policy: policies.nodes[0],
    configuration: {
      kind: "split",
      configuredRows: [
        {
          rowId: "platform",
          recipient: platform,
          allocation:
            mode === "percentage"
              ? { kind: "percentage", bps: 1000 }
              : { kind: "fixed", amountStroops: "100" },
        },
      ],
      additionalRecipients: [],
    },
  });
  const args: ExecutionArguments = {
    version: 1,
    inputs: [
      {
        kind: "split",
        nodeId: "split",
        rows: [],
        additionalRecipients: [
          {
            rowId: "worker",
            recipient: worker,
            allocation:
              mode === "percentage"
                ? { kind: "percentage", bps: 9000 }
                : { kind: "fixed", amountStroops: "900" },
          },
        ],
      },
    ],
  };
  return { policies, configuration, args };
}
describe("reviewed execution allocation preflight", () => {
  it("preserves constant-only fixed Split batching while recipient parameters require the exact entering total", () => {
    const policy = {
      kind: "split" as const,
      nodeId: "split",
      allocationMode: "fixed" as const,
      rows: [{ rowId: "row", recipient: "constant" as const, allocation: "constant" as const }],
      additionalRecipients: "constant" as const,
    };
    const base = {
      version: 1,
      nodeId: "split",
      contractAddress: contract,
      confirmedLedger: 10,
      revision: "0",
    };
    const constant = ConfirmedNodeConfigurationSchema.parse({
      ...base,
      policy,
      configuration: {
        kind: "split",
        configuredRows: [
          {
            rowId: "row",
            recipient: platform,
            allocation: { kind: "fixed", amountStroops: "1000" },
          },
        ],
        additionalRecipients: [],
      },
    });
    expect(() =>
      assertExecutionValues(
        { version: 1, nodes: [policy] },
        [constant],
        { version: 1, inputs: [] },
        "10",
      ),
    ).not.toThrow();
    const variablePolicy = {
      ...policy,
      rows: [{ rowId: "row", recipient: "execution" as const, allocation: "constant" as const }],
    };
    const variable = ConfirmedNodeConfigurationSchema.parse({
      ...base,
      policy: variablePolicy,
      configuration: {
        kind: "split",
        configuredRows: [{ rowId: "row", allocation: { kind: "fixed", amountStroops: "1000" } }],
        additionalRecipients: [],
      },
    });
    const args: ExecutionArguments = {
      version: 1,
      inputs: [{ kind: "split", nodeId: "split", rows: [{ rowId: "row", recipient: worker }] }],
    };
    expect(() =>
      assertExecutionValues({ version: 1, nodes: [variablePolicy] }, [variable], args, "10"),
    ).toThrow("exactly");
    expect(() =>
      assertExecutionValues({ version: 1, nodes: [variablePolicy] }, [variable], args, "1000"),
    ).not.toThrow();
  });
  it.each(["percentage", "fixed"] as const)(
    "preserves constant platform recipient/share and validates %s workers",
    (mode) => {
      const { policies, configuration, args } = split(mode);
      expect(() => assertExecutionValues(policies, [configuration], args, "1000")).not.toThrow();
      expect(
        configuration.configuration.kind === "split" &&
          configuration.configuration.configuredRows[0]!.recipient,
      ).toBe(platform);
    },
  );
  it.each(["999", "1001"])("refuses fixed under/excess entering amount %s", (amount) => {
    const { policies, configuration, args } = split("fixed");
    expect(() => assertExecutionValues(policies, [configuration], args, amount)).toThrow("exactly");
  });
  it("cannot collide with a constant recipient or overwrite its row", () => {
    const { policies, configuration, args } = split();
    const input = args.inputs[0]!;
    if (input.kind !== "split") throw new Error();
    input.additionalRecipients![0]!.recipient = platform;
    expect(() => assertExecutionValues(policies, [configuration], args, "1000")).toThrow("unique");
    input.additionalRecipients![0]!.recipient = worker;
    input.additionalRecipients![0]!.rowId = "platform";
    expect(() => assertExecutionValues(policies, [configuration], args, "1000")).toThrow(
      "configured row",
    );
  });
  it("refuses missing, unknown and constant inputs before signing", () => {
    const { policies, configuration, args } = split();
    expect(() =>
      assertExecutionValues(policies, [configuration], { version: 1, inputs: [] }, "1000"),
    ).toThrow();
    const input = args.inputs[0]!;
    if (input.kind !== "split") throw new Error();
    input.rows.push({ rowId: "platform", recipient: other });
    expect(() => assertExecutionValues(policies, [configuration], args, "1000")).toThrow(
      "constant",
    );
  });
  it("requires the whole final percentage total", () => {
    const { policies, configuration, args } = split();
    const input = args.inputs[0]!;
    if (input.kind !== "split") throw new Error();
    input.additionalRecipients![0]!.allocation = { kind: "percentage", bps: 8999 };
    expect(() => assertExecutionValues(policies, [configuration], args, "1000")).toThrow("10000");
  });
  it("binds a downstream fixed Split to the per-hop remainder, not the original deposit", () => {
    const { policies, configuration, args } = split("fixed");
    const payPolicy = {
      kind: "pay" as const,
      nodeId: "fee",
      recipient: "constant" as const,
      payoutValue: "constant" as const,
    };
    const pay = ConfirmedNodeConfigurationSchema.parse({
      version: 1,
      nodeId: "fee",
      contractAddress: contract,
      confirmedLedger: 10,
      revision: "0",
      policy: payPolicy,
      configuration: {
        kind: "pay",
        recipient: other,
        payoutValue: { kind: "fixed", amountStroops: "10" },
      },
    });
    expect(() =>
      assertExecutionValues(
        { version: 1, nodes: [payPolicy, ...policies.nodes] },
        [pay, configuration],
        args,
        "1010",
      ),
    ).not.toThrow();
    expect(() => assertExecutionValues(policies, [pay, configuration], args, "1000")).toThrow(
      "exactly",
    );
  });
  it("refuses underfunded fixed Pay and empty forwarding, preserves terminal payer refund budget", () => {
    const policy = {
      kind: "pay" as const,
      nodeId: "pay",
      recipient: "execution" as const,
      payoutValue: "constant" as const,
    };
    const pay = ConfirmedNodeConfigurationSchema.parse({
      version: 1,
      nodeId: "pay",
      contractAddress: contract,
      confirmedLedger: 10,
      revision: "0",
      policy,
      configuration: { kind: "pay", payoutValue: { kind: "fixed", amountStroops: "100" } },
    });
    const args: ExecutionArguments = {
      version: 1,
      inputs: [{ kind: "pay", nodeId: "pay", recipient: worker }],
    };
    expect(() => assertExecutionValues({ version: 1, nodes: [policy] }, [pay], args, "99")).toThrow(
      "insufficient",
    );
    expect(() =>
      assertExecutionValues({ version: 1, nodes: [policy] }, [pay], args, "101"),
    ).not.toThrow();
    expect(() =>
      assertExecutionValues({ version: 1, nodes: [policy] }, [pay, pay], args, "100"),
    ).toThrow("positive");
  });
});
describe("execution idempotency fingerprint", () => {
  it("ignores object property ordering but preserves roster ordering", () => {
    expect(executionRequestDigest({ a: 1, b: { c: 2 } })).toBe(
      executionRequestDigest({ b: { c: 2 }, a: 1 }),
    );
    expect(executionRequestDigest([1, 2])).not.toBe(executionRequestDigest([2, 1]));
  });
  it("bounds keys and stores only digests", () => {
    expect(executionIdempotencyKey(null)).toBeNull();
    expect(executionIdempotencyKey("order:123")).toMatch(/^[a-f0-9]{64}$/);
    expect(() => executionIdempotencyKey("bad\nkey")).toThrow();
    expect(() => executionIdempotencyKey("a".repeat(129))).toThrow();
  });
});
