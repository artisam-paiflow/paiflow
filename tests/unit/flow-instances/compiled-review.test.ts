import { describe, expect, it } from "vitest";
import { InstanceCompiledTermsSchema } from "@/lib/flow-instances/compiled-review-schema";
import type { PipelineNodeParams } from "@/lib/flows/to-params";
import { compiledTerms, recipient } from "@/tests/unit/flow-templates/ui-fixtures";

const asset = { asset: { kind: "native" as const } };
const next = { nextStepNodeIds: [] };
const schedule = { startTs: 1793527200, endTs: 1793700000, intervalSeconds: 86400 };
const recipients = [{ address: recipient, bps: 10000, amount: "0" }];
const cases = [
  ["DEPOSIT_TRIGGER", { kind: "deposit_trigger", ...asset, ...next }],
  ["SPLITTER", { kind: "splitter", ...asset, ...next, recipients, minAmountStroops: "0" }],
  [
    "STREAMER",
    {
      kind: "streamer",
      ...asset,
      recipients,
      ...schedule,
      amountPerIntervalStroops: "100",
      pauseAllowed: true,
      retrieveAllowed: false,
    },
  ],
  [
    "CONDITIONAL",
    {
      kind: "conditional",
      ...asset,
      ...next,
      recipients,
      amountStroops: "100",
      condition: { kind: "oracle_gte", oracle: recipient, key: "price", threshold: "100" },
    },
  ],
  ["ROUTER", { kind: "router", ...asset, threshold: "100", pathANodeIds: [], pathBNodeIds: [] }],
  ["TIMELOCK", { kind: "timelock", ...asset, ...next, unlockTime: schedule.endTs, mode: "after" }],
  [
    "TIMELOCK_BRANCH",
    {
      kind: "timelock_branch",
      ...asset,
      unlockTime: schedule.endTs,
      beforeNodeIds: [],
      afterNodeIds: [],
    },
  ],
  ["WEBHOOK", { kind: "webhook_trigger", ...asset, ...next, relayer: recipient }],
  [
    "SUBSCRIPTION",
    {
      kind: "subscription_trigger",
      ...asset,
      ...next,
      ...schedule,
      subscriber: recipient,
      amountPerPeriodStroops: "100",
    },
  ],
  ["ORACLE", { kind: "oracle_trigger", ...asset, ...next, threshold: "100" }],
  [
    "MULTISIG",
    {
      kind: "multisig",
      ...asset,
      ...next,
      signers: [{ address: recipient, bps: 10000 }],
      threshold: 1,
    },
  ],
  [
    "SWAPPER",
    {
      kind: "swapper",
      assetIn: { kind: "native" },
      assetOut: { kind: "native" },
      ...next,
      slippageBps: 100,
      deadlineSecs: 300,
    },
  ],
  ["YIELD", { kind: "yield", ...asset, ...next, vault: recipient }],
  ["PAYER", { kind: "payer", ...asset, ...next, recipient, amountStroops: "100", mode: "fixed" }],
] satisfies [string, PipelineNodeParams][];
describe("persisted instance compiled review validation", () => {
  it.each(cases)(
    "retains complete %s compiled terms without rewriting or recompiling them",
    (templateKind, params) => {
      const node = { ...compiledTerms[0]!, nodeId: "node", templateKind, params };
      expect(InstanceCompiledTermsSchema.parse([node])).toEqual([node]);
    },
  );
  it("refuses missing, wrong-kind, duplicate and unexpected persisted evidence", () => {
    expect(InstanceCompiledTermsSchema.safeParse([]).success).toBe(false);
    expect(
      InstanceCompiledTermsSchema.safeParse([{ ...compiledTerms[0], templateKind: "PAYER" }])
        .success,
    ).toBe(false);
    expect(
      InstanceCompiledTermsSchema.safeParse([compiledTerms[0], compiledTerms[0]]).success,
    ).toBe(false);
    expect(
      InstanceCompiledTermsSchema.safeParse([
        { ...compiledTerms[0], params: { ...compiledTerms[0]!.params, invented: "value" } },
      ]).success,
    ).toBe(false);
  });
  it("refuses numeric/overflow money, malformed timestamps, empty intervals and reversed windows", () => {
    const base = { ...compiledTerms[0]!, templateKind: "STREAMER", params: cases[2]![1] };
    for (const patch of [
      { amountPerIntervalStroops: 100 },
      { amountPerIntervalStroops: "1.5" },
      { amountPerIntervalStroops: (2n ** 127n).toString() },
      { intervalSeconds: 0 },
      { startTs: "2026-11-01" },
      { endTs: schedule.startTs - 1 },
    ]) {
      expect(
        InstanceCompiledTermsSchema.safeParse([{ ...base, params: { ...base.params, ...patch } }])
          .success,
      ).toBe(false);
    }
  });
});
