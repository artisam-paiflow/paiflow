/**
 * True/False branches on a time condition (#721). A time condition compiles to
 * the timelock_branch contract (`contracts/conditions/timelock_branch`), which
 * holds the funds and pays its "before" list when released strictly before
 * `unlock_time` and its "after" list at or after it. The mapping under test:
 *
 * | kind          | True (met)  | False (not met) |
 * | ------------- | ----------- | --------------- |
 * | `time_before` | before list | after list      |
 * | `time_after`  | after list  | before list     |
 *
 * `releaseOnChain` below restates the contract's comparison so the boundary
 * tests pin which step a release at a given time actually pays.
 */
import { describe, expect, it } from "vitest";
import { TemplateKind } from "@prisma/client";
import { FlowGraphSchema, type FlowGraph } from "@/lib/flows/schema";
import {
  branchTimeText,
  timelockLists,
  timelockSideBranch,
  isTimeCondition,
  type TimeCondition,
} from "@/lib/flows/branches";
import {
  flowToPipeline,
  type PipelineNode,
  type TimelockBranchNodeParams,
} from "@/lib/flows/to-params";
import { validateFlow } from "@/lib/flows/validate";
import { flowToEnglish } from "@/lib/flows/english";
import { normalizeFlowGraph } from "@/lib/ai/normalize";
import { SANDBOX_TEMPLATE_KINDS } from "@/lib/sandbox";
import { AUTO_RELEASE_TEMPLATE_KINDS } from "@/lib/timelock-release";
import { contractKeyForTemplate, CONTRACT_ERRORS } from "@/lib/stellar/soroban-errors";
import { TEMPLATE_LABELS } from "@/lib/flows/template-labels";

const ADDR_A = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const ADDR_B = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const USDC = { kind: "known", symbol: "USDC" } as const;
const AT = "2030-06-01T00:00:00.000Z";
const AT_SECONDS = Math.floor(new Date(AT).getTime() / 1000);

type Edge = { id: string; source: string; target: string; sourceHandle?: string };
type TimeConfig = { kind: "time_after" | "time_before"; at: string; timeZone?: string };

const before = { kind: "time_before", at: AT } as const;
const after = { kind: "time_after", at: AT } as const;

const trigger = { id: "t", type: "on_receive", config: { asset: USDC } };
const freelancer = {
  id: "p",
  type: "pay",
  config: { asset: USDC, recipient: ADDR_A, mode: "fixed", fullAmount: true },
};
const client = {
  id: "s",
  type: "split",
  config: { asset: USDC, recipients: [{ address: ADDR_B, mode: "percentage", bps: 10_000 }] },
};

/** Only the steps an edge reaches are included, so an unwired one is not an orphan. */
function graph(config: object, edges: Edge[], extra: object[] = []): unknown {
  const reached = new Set(edges.map((e) => e.target));
  return {
    nodes: [
      trigger,
      { id: "c", type: "condition", config },
      ...[freelancer, client].filter((n) => reached.has(n.id)),
      ...extra,
    ],
    edges: [{ id: "e0", source: "t", target: "c" }, ...edges],
  };
}

/** True → freelancer's pay, False → client's split. */
function wired(config: TimeConfig): unknown {
  return graph(config, [
    { id: "e1", source: "c", target: "p", sourceHandle: "true" },
    { id: "e2", source: "c", target: "s", sourceHandle: "false" },
  ]);
}

function parse(raw: unknown): FlowGraph {
  return FlowGraphSchema.parse(raw);
}

function lockOf(nodes: PipelineNode[]): TimelockBranchNodeParams {
  const lock = nodes.find((n) => n.templateKind === TemplateKind.TIMELOCK_BRANCH);
  if (!lock || lock.params.kind !== "timelock_branch") throw new Error("no timelock_branch");
  return lock.params;
}

/** `perform_release` in contracts/conditions/timelock_branch: `now >= unlock ? after : before`. */
function releaseOnChain(lock: TimelockBranchNodeParams, now: number): string[] {
  return now >= lock.unlockTime ? lock.afterNodeIds : lock.beforeNodeIds;
}

function codes(raw: unknown): string[] {
  const r = validateFlow(raw);
  return r.ok ? [] : r.errors.map((e) => e.code ?? e.message);
}

describe("timelockSideBranch: the mapping in one place", () => {
  it.each([
    ["time_before", "before", "true"],
    ["time_before", "after", "false"],
    ["time_after", "after", "true"],
    ["time_after", "before", "false"],
  ] as const)("%s: the %s list is the %s output", (kind, side, branch) => {
    expect(timelockSideBranch(kind, side)).toBe(branch);
  });

  it("splits targets by list for each kind", () => {
    const targets = { true: ["yes"], false: ["no"] };
    expect(timelockLists("time_before", targets)).toEqual({
      beforeNodeIds: ["yes"],
      afterNodeIds: ["no"],
    });
    expect(timelockLists("time_after", targets)).toEqual({
      beforeNodeIds: ["no"],
      afterNodeIds: ["yes"],
    });
  });

  it("recognises both time kinds and nothing else", () => {
    const cond = (config: object) =>
      parse(graph(config, [])).nodes.find((n) => n.id === "c") as TimeCondition;
    expect(isTimeCondition(cond(before))).toBe(true);
    expect(isTimeCondition(cond(after))).toBe(true);
    expect(isTimeCondition(cond({ kind: "amount_gt", amountStroops: "1" }))).toBe(false);
  });

  it("words each side with the deadline and its zone", () => {
    const cond = parse(graph({ ...before, timeZone: "Asia/Manila" }, [])).nodes.find(
      (n) => n.id === "c",
    ) as TimeCondition;
    expect(branchTimeText(cond.config, "true")).toBe(
      "before June 1, 2030 at 8:00 AM (Asia/Manila)",
    );
    expect(branchTimeText(cond.config, "false")).toBe(
      "at or after June 1, 2030 at 8:00 AM (Asia/Manila)",
    );
  });
});

describe("flowToPipeline: branches onto the timelock's two lists", () => {
  it("time_before: True is the before list, False the after list, and both steps deploy", () => {
    const pipeline = flowToPipeline(parse(wired(before)));
    const lock = lockOf(pipeline);
    expect(lock).toMatchObject({
      kind: "timelock_branch",
      unlockTime: AT_SECONDS,
      beforeNodeIds: ["p"],
      afterNodeIds: ["s"],
    });
    expect(pipeline.map((n) => n.templateKind)).toEqual([
      TemplateKind.DEPOSIT_TRIGGER,
      TemplateKind.TIMELOCK_BRANCH,
      TemplateKind.PAYER,
      TemplateKind.SPLITTER,
    ]);
  });

  it("time_after: True is the after list, False the before list", () => {
    const lock = lockOf(flowToPipeline(parse(wired(after))));
    expect(lock.afterNodeIds).toEqual(["p"]);
    expect(lock.beforeNodeIds).toEqual(["s"]);
  });

  it("never emits the older single-list TIMELOCK for a time condition", () => {
    for (const config of [before, after]) {
      const kinds = flowToPipeline(parse(wired(config))).map((n) => n.templateKind);
      expect(kinds).not.toContain(TemplateKind.TIMELOCK);
    }
  });

  it("time_before pays True's step for a release just before the deadline, False's at it", () => {
    const lock = lockOf(flowToPipeline(parse(wired(before))));
    expect(releaseOnChain(lock, AT_SECONDS - 1)).toEqual(["p"]);
    expect(releaseOnChain(lock, AT_SECONDS)).toEqual(["s"]);
    expect(releaseOnChain(lock, AT_SECONDS + 1)).toEqual(["s"]);
  });

  it("time_after pays False's step just before the deadline, True's at it", () => {
    const lock = lockOf(flowToPipeline(parse(wired(after))));
    expect(releaseOnChain(lock, AT_SECONDS - 1)).toEqual(["s"]);
    expect(releaseOnChain(lock, AT_SECONDS)).toEqual(["p"]);
    expect(releaseOnChain(lock, AT_SECONDS + 1)).toEqual(["p"]);
  });

  it("reads a handle-less edge as True (a flow saved before branches)", () => {
    const lock = lockOf(
      flowToPipeline(parse(graph(before, [{ id: "e1", source: "c", target: "p" }]))),
    );
    expect(lock.beforeNodeIds).toEqual(["p"]);
    expect(lock.afterNodeIds).toEqual([]);
  });

  it("the same step on both outputs is one deployed step, listed on both sides", () => {
    const pipeline = flowToPipeline(
      parse(
        graph(before, [
          { id: "e1", source: "c", target: "p", sourceHandle: "true" },
          { id: "e2", source: "c", target: "p", sourceHandle: "false" },
        ]),
      ),
    );
    const lock = lockOf(pipeline);
    expect(lock.beforeNodeIds).toEqual(["p"]);
    expect(lock.afterNodeIds).toEqual(["p"]);
    expect(pipeline.filter((n) => n.nodeId === "p")).toHaveLength(1);
  });
});

describe("validateFlow: time branches", () => {
  it("accepts both outputs wired, for either kind", () => {
    for (const config of [before, after]) {
      const r = validateFlow(wired(config));
      expect(r.ok ? [] : r.errors).toEqual([]);
      expect(r.ok && r.pipeline).toEqual([
        TemplateKind.DEPOSIT_TRIGGER,
        TemplateKind.TIMELOCK_BRANCH,
        TemplateKind.PAYER,
        TemplateKind.SPLITTER,
      ]);
    }
  });

  it("refuses time_before with no False branch, naming the release and the output", () => {
    const r = validateFlow(
      graph(before, [{ id: "e1", source: "c", target: "p", sourceHandle: "true" }]),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toHaveLength(1);
    const issue = r.errors[0]!;
    expect(issue).toMatchObject({
      code: "TIMELOCK_EMPTY_SIDE",
      path: "nodes.c",
      nodeId: "c",
    });
    expect(issue.friendlyMessage).toContain(
      "If the funds are released at or after June 1, 2030 at 12:00 AM (UTC)",
    );
    expect(issue.friendlyMessage).toContain("False output");
    expect(issue.friendlyMessage).toContain("stuck in the contract");
  });

  it("refuses time_after with no True branch (the after side), naming it", () => {
    const r = validateFlow(
      graph(after, [{ id: "e1", source: "c", target: "s", sourceHandle: "false" }]),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]?.friendlyMessage).toContain(
      "If the funds are released at or after June 1, 2030 at 12:00 AM (UTC)",
    );
    expect(r.errors[0]?.friendlyMessage).toContain("True output");
  });

  it("refuses two steps on one output", () => {
    const r = validateFlow(
      graph(
        before,
        [
          { id: "e1", source: "c", target: "p", sourceHandle: "true" },
          { id: "e2", source: "c", target: "s", sourceHandle: "true" },
          { id: "e3", source: "c", target: "x", sourceHandle: "false" },
        ],
        [{ id: "x", type: "pay", config: { ...freelancer.config, recipient: ADDR_B } }],
      ),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const issue = r.errors.find((e) => e.code === "BRANCH_FAN_OUT");
    expect(issue?.friendlyMessage).toContain("True output of this time condition connects to 2");
  });

  it("refuses an email hung off a time condition", () => {
    const codesFound = codes(
      graph(
        before,
        [
          { id: "e1", source: "c", target: "p", sourceHandle: "true" },
          { id: "e2", source: "c", target: "s", sourceHandle: "false" },
          { id: "e3", source: "c", target: "m" },
        ],
        [
          {
            id: "m",
            type: "email_notify",
            config: {
              recipients: [{ address: ADDR_A, email: "a@example.com" }],
              subject: "Hi",
              body: "",
            },
          },
        ],
      ),
    );
    expect(codesFound).toContain("BRANCH_EMAIL");
  });

  it("refuses a time condition under a schedule trigger, which would drop the deadline", () => {
    const r = validateFlow({
      nodes: [
        {
          id: "t",
          type: "on_schedule",
          config: { intervalAmount: 1, intervalUnit: "hour", startsAt: "2030-01-01T00:00:00.000Z" },
        },
        { id: "c", type: "condition", config: before },
        {
          id: "p",
          type: "pay",
          config: {
            asset: { kind: "native" },
            recipient: ADDR_A,
            mode: "fixed",
            amountStroops: "1000",
          },
        },
      ],
      edges: [
        { id: "e1", source: "t", target: "c" },
        { id: "e2", source: "c", target: "p" },
      ],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const issue = r.errors.find((e) => e.code === "BRANCH_TRIGGER");
    expect(issue?.friendlyMessage).toContain("A time condition can't follow");
  });

  it("refuses another condition as a direct next step", () => {
    const r = validateFlow(
      graph(
        before,
        [
          { id: "e1", source: "c", target: "c2", sourceHandle: "true" },
          { id: "e2", source: "c", target: "s", sourceHandle: "false" },
          { id: "e3", source: "c2", target: "p" },
        ],
        [{ id: "c2", type: "condition", config: { kind: "amount_gt", amountStroops: "1" } }],
      ),
    );
    expect(r.ok ? [] : r.errors.map((e) => e.code)).toContain("BRANCH_TARGET");
  });

  it("refuses a step reached from both sides through different parents", () => {
    const r = validateFlow(
      graph(
        before,
        [
          { id: "e1", source: "c", target: "p", sourceHandle: "true" },
          { id: "e2", source: "c", target: "s", sourceHandle: "false" },
          { id: "e3", source: "p", target: "m" },
          { id: "e4", source: "s", target: "m" },
        ],
        [{ id: "m", type: "pay", config: { ...freelancer.config, recipient: ADDR_B } }],
      ),
    );
    expect(r.ok ? [] : r.errors.map((e) => e.code)).toContain("BRANCH_MERGE");
  });

  it("refuses a cycle that runs through a branch", () => {
    const r = validateFlow(
      graph(before, [
        { id: "e1", source: "c", target: "p", sourceHandle: "true" },
        { id: "e2", source: "c", target: "s", sourceHandle: "false" },
        { id: "e3", source: "p", target: "c" },
      ]),
    );
    expect(r.ok).toBe(false);
  });
});

describe("flowToEnglish: time branches", () => {
  it("says what each release pays, who can release early, and when the automatic one runs", () => {
    const text = flowToEnglish(parse(wired({ ...before, timeZone: "UTC" })));
    expect(text).toContain("hold the funds");
    expect(text).toContain("if they are released before June 1, 2030 at 12:00 AM (UTC), pay");
    expect(text).toContain("otherwise, split USDC");
    expect(text).toContain("released early by the deploying wallet");
    expect(text).toContain("automatic release runs only at or after the deadline");
  });

  it("puts the after side first for time_after", () => {
    const text = flowToEnglish(parse(wired(after)));
    expect(text).toContain("released at or after June 1, 2030 at 12:00 AM (UTC), pay");
  });

  it("names a side with nothing connected", () => {
    const text = flowToEnglish(
      parse(graph(before, [{ id: "e1", source: "c", target: "p", sourceHandle: "true" }])),
    );
    expect(text).toContain(
      "otherwise, nothing is connected yet (connect a step to the False output)",
    );
  });
});

describe("the AI assistant path", () => {
  it("keeps a False handle on an edge out of a time condition", () => {
    // Two pays: the normalizer rebuilds split recipients its own way, which is
    // beside the point here.
    const r = normalizeFlowGraph({
      nodes: [
        trigger,
        { id: "c", type: "condition", config: before },
        freelancer,
        { ...freelancer, id: "p2" },
      ],
      edges: [
        { id: "e0", source: "t", target: "c" },
        { id: "e1", source: "c", target: "p", sourceHandle: "true" },
        { id: "e2", source: "c", target: "p2", sourceHandle: "false" },
      ],
    });
    expect(r.ok ? "ok" : r).toBe("ok");
    if (!r.ok) return;
    expect(r.graph.edges.find((e) => e.id === "e2")?.sourceHandle).toBe("false");
  });
});

describe("wiring of the new kind", () => {
  it("is not deployable from a sandbox session: the relayer acts on it", () => {
    expect(SANDBOX_TEMPLATE_KINDS).not.toContain(TemplateKind.TIMELOCK_BRANCH);
    expect(SANDBOX_TEMPLATE_KINDS).not.toContain(TemplateKind.TIMELOCK);
  });

  it("is released by the auto-release cron", () => {
    expect(AUTO_RELEASE_TEMPLATE_KINDS).toContain(TemplateKind.TIMELOCK_BRANCH);
    expect(AUTO_RELEASE_TEMPLATE_KINDS).toContain(TemplateKind.TIMELOCK);
  });

  it("has a label and contract errors matching the Rust enum", () => {
    expect(TEMPLATE_LABELS.TIMELOCK_BRANCH).toBeTruthy();
    const key = contractKeyForTemplate("TIMELOCK_BRANCH");
    expect(key).toBe("timelock_branch");
    const table = CONTRACT_ERRORS.timelock_branch;
    // Mirrors `Error` in contracts/conditions/timelock_branch/src/lib.rs.
    expect(Object.entries(table).map(([code, e]) => [Number(code), e.name])).toEqual([
      [1, "AlreadyInitialized"],
      [2, "Unauthorized"],
      [3, "ConditionNotMet"],
      [4, "NothingToRelease"],
      [5, "Overflow"],
      [6, "InvalidBranch"],
    ]);
  });
});
