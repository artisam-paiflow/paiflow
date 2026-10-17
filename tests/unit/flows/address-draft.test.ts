/**
 * #588: a half-typed or cleared Stellar address is a draft the builder must be
 * able to autosave, so every address field parses any string under the shape
 * schema, and `validateFlow` is what keeps anything but a complete strkey (or a
 * PENDING: placeholder) off the chain.
 */
import { describe, expect, it } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import { FlowGraphSchema, FlowPatchSchema, getPendingLabels } from "@/lib/flows/schema";
import { validateFlow } from "@/lib/flows/validate";
import { addressFields, addressIssues, isAcceptedFlowAddress } from "@/lib/flows/address-rules";
import { SECRET_SEED_MESSAGE } from "@/lib/flows/secret-seed";

const ADDR_A = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const ADDR_B = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const CONTRACT = "CAEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQTD2L";
// ADDR_A with its last character changed: right length and prefix, bad checksum.
const BAD_CHECKSUM = ADDR_A.slice(0, -1) + (ADDR_A.endsWith("A") ? "B" : "A");
const USDC = { kind: "known", symbol: "USDC" } as const;

// Every draft the panel can autosave while an address is being typed or fixed.
const DRAFTS = [
  "",
  "G",
  "GABC",
  ADDR_A.slice(0, 55),
  BAD_CHECKSUM,
  ADDR_A.toLowerCase(),
  ` ${ADDR_A} `,
  `${ADDR_A}X`,
  // A valid muxed (M…) form of ADDR_A: never accepted, before or after #588.
  "MBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLEAAAAAAAAAAAFJN3W",
];

function payFlow(recipient: string) {
  return {
    nodes: [
      { id: "t", type: "on_receive", config: { asset: USDC } },
      {
        id: "p",
        type: "pay",
        config: { recipient, asset: USDC, mode: "fixed", amountStroops: "10000000" },
      },
    ],
    edges: [{ id: "e1", source: "t", target: "p" }],
  };
}

function splitFlow(addresses: string[], payoutMode?: "fiat") {
  return {
    nodes: [
      { id: "t", type: "on_receive", config: { asset: USDC } },
      {
        id: "s",
        type: "split",
        config: {
          asset: USDC,
          recipients: addresses.map((address, i) => ({
            address,
            mode: "percentage",
            bps: i === 0 ? 10_000 - (addresses.length - 1) * 1000 : 1000,
            ...(payoutMode ? { payoutMode } : {}),
          })),
        },
      },
    ],
    edges: [{ id: "e1", source: "t", target: "s" }],
  };
}

const payTo = (id: string) => ({
  id,
  type: "pay",
  config: { recipient: ADDR_B, asset: USDC, mode: "fixed", amountStroops: "10000000" },
});

// One graph per remaining address field, with `value` in that field.
const OTHER_FIELDS: { name: string; path: string; graph: (value: string) => unknown }[] = [
  {
    name: "webhook relayer",
    path: "nodes.t.config.relayer",
    graph: (v) => ({
      nodes: [{ id: "t", type: "webhook", config: { asset: USDC, relayer: v } }, payTo("p")],
      edges: [{ id: "e1", source: "t", target: "p" }],
    }),
  },
  {
    name: "subscription subscriber",
    path: "nodes.t.config.subscriber",
    graph: (v) => ({
      nodes: [
        {
          id: "t",
          type: "subscription",
          config: { asset: USDC, subscriber: v, amountPerPeriodStroops: "10000000" },
        },
        payTo("p"),
      ],
      edges: [{ id: "e1", source: "t", target: "p" }],
    }),
  },
  {
    name: "payroll employer",
    path: "nodes.t.config.employer",
    graph: (v) => ({
      nodes: [{ id: "t", type: "payroll", config: { asset: USDC, employer: v } }, payTo("p")],
      edges: [{ id: "e1", source: "t", target: "p" }],
    }),
  },
  {
    name: "yield vault",
    path: "nodes.y.config.vault",
    graph: (v) => ({
      nodes: [
        { id: "t", type: "webhook", config: { asset: USDC, relayer: ADDR_A } },
        { id: "y", type: "yield", config: { asset: USDC, vault: v } },
      ],
      edges: [{ id: "e1", source: "t", target: "y" }],
    }),
  },
  {
    name: "oracle condition",
    path: "nodes.c.config.oracle",
    graph: (v) => ({
      nodes: [
        { id: "t", type: "on_receive", config: { asset: USDC } },
        {
          id: "c",
          type: "condition",
          config: { kind: "oracle_gte", oracle: v, key: "price", threshold: "100" },
        },
        payTo("p"),
      ],
      edges: [
        { id: "e1", source: "t", target: "c" },
        { id: "e2", source: "c", target: "p" },
      ],
    }),
  },
  {
    name: "multisig signer",
    path: "nodes.c.config.signers.1",
    graph: (v) => ({
      nodes: [
        { id: "t", type: "on_receive", config: { asset: USDC } },
        {
          id: "c",
          type: "condition",
          config: { kind: "multisig", signers: [ADDR_A, v], threshold: 1 },
        },
        payTo("p"),
      ],
      edges: [
        { id: "e1", source: "t", target: "c" },
        { id: "e2", source: "c", target: "p" },
      ],
    }),
  },
];

const ALL_FIELDS = [
  { name: "pay recipient", path: "nodes.p.config.recipient", graph: payFlow },
  {
    name: "split recipient",
    path: "nodes.s.config.recipients.1.address",
    graph: (v: string) => splitFlow([ADDR_A, v]),
  },
  ...OTHER_FIELDS,
];

function errorsOf(graph: unknown) {
  const r = validateFlow(graph);
  return r.ok ? [] : r.errors;
}

describe("a draft address saves (#588)", () => {
  it.each(ALL_FIELDS)(
    "$name: every draft parses under FlowGraphSchema and FlowPatchSchema",
    ({ graph }) => {
      for (const draft of DRAFTS) {
        const g = graph(draft);
        expect(FlowGraphSchema.safeParse(g).success, JSON.stringify(draft)).toBe(true);
        expect(FlowPatchSchema.safeParse({ graph: g }).success, JSON.stringify(draft)).toBe(true);
      }
    },
  );

  it("stores the draft exactly as typed: parse neither trims, upper-cases nor rewrites it", () => {
    for (const draft of DRAFTS) {
      const parsed = FlowGraphSchema.parse(payFlow(draft));
      const pay = parsed.nodes.find((n) => n.id === "p");
      expect(pay?.type === "pay" && pay.config.recipient).toBe(draft);
    }
  });

  it("a custom asset's issuer is typed in no panel and stays strict at parse time", () => {
    const g = {
      nodes: [
        {
          id: "t",
          type: "on_receive",
          config: { asset: { kind: "custom", code: "ABC", issuer: "GABC" } },
        },
      ],
      edges: [],
    };
    expect(FlowGraphSchema.safeParse(g).success).toBe(false);
  });

  it("a contract (C…) as a crypto split recipient saves, and validateFlow refuses it on its address", () => {
    const crypto = splitFlow([ADDR_A, CONTRACT]);
    expect(FlowPatchSchema.safeParse({ graph: crypto }).success).toBe(true);
    const [issue] = errorsOf(crypto).filter(
      (e) => e.path === "nodes.s.config.recipients.1.address",
    );
    expect(issue!.message).toBe("Contract addresses (C...) must use fiat payout.");
    expect(issue!.friendlyMessage).toContain("can only receive a fiat payout");
    expect(FlowGraphSchema.safeParse(splitFlow([ADDR_A, CONTRACT], "fiat")).success).toBe(true);
    expect(
      errorsOf(splitFlow([ADDR_A, CONTRACT], "fiat")).some(
        (e) => e.path === "nodes.s.config.recipients.1.address",
      ),
    ).toBe(false);
  });

  it.each(ALL_FIELDS)(
    "$name: a secret seed, whole or partial, is refused at parse and never stored",
    ({ graph }) => {
      const seed = Keypair.random().secret();
      for (const v of [seed, seed.slice(0, 10), "S", ` ${seed.toLowerCase()}`]) {
        const r = FlowPatchSchema.safeParse({ graph: graph(v) });
        expect(r.success, v.slice(0, 3)).toBe(false);
        if (!r.success) expect(r.error.issues[0]!.message).toBe(SECRET_SEED_MESSAGE);
      }
      const v = validateFlow(graph(seed));
      expect(v.ok).toBe(false);
      if (!v.ok) {
        expect(v.errors.every((e) => !e.friendlyMessage.includes(seed))).toBe(true);
        expect(v.errors.some((e) => e.friendlyMessage === SECRET_SEED_MESSAGE)).toBe(true);
      }
    },
  );
});

describe("validateFlow refuses a draft address (#588)", () => {
  it.each(ALL_FIELDS)("$name: one issue on the field's path for every draft", ({ graph, path }) => {
    for (const draft of DRAFTS) {
      const errors = errorsOf(graph(draft));
      const onField = errors.filter((e) => e.path === path);
      expect(onField, JSON.stringify(draft)).toHaveLength(1);
      expect(onField[0]!.message).toBe(
        draft === "" ? "Missing Stellar address" : "Invalid Stellar address",
      );
    }
  });

  it("asks for an address when the field is empty", () => {
    const [issue] = errorsOf(payFlow("")).filter((e) => e.path === "nodes.p.config.recipient");
    expect(issue!.friendlyMessage).toBe(
      "Enter a complete wallet address (G…, 56 characters) for the Pay step's recipient.",
    );
    expect(issue!.nodeId).toBe("p");
    expect(issue!.field).toBe("recipient");
  });

  it("gives a concise correction without repeating the typed address", () => {
    const [issue] = errorsOf(payFlow("GABC")).filter((e) => e.path === "nodes.p.config.recipient");
    expect(issue!.friendlyMessage).toBe(
      "Enter a complete wallet address (G…, 56 characters) for the Pay step's recipient.",
    );
    expect(issue!.friendlyMessage).not.toContain("GABC");
  });

  it("says a lower-case address is lower case, without committing the upper-case one", () => {
    const lower = ADDR_A.toLowerCase();
    const [issue] = errorsOf(payFlow(lower)).filter((e) => e.path === "nodes.p.config.recipient");
    expect(issue!.friendlyMessage).toContain("lower case");
    expect(issue!.friendlyMessage).not.toContain(lower);
    expect(issue!.friendlyMessage).not.toContain(ADDR_A);
  });

  it("says a padded address has spaces around it", () => {
    const [issue] = errorsOf(payFlow(` ${ADDR_A}`)).filter(
      (e) => e.path === "nodes.p.config.recipient",
    );
    expect(issue!.friendlyMessage).toContain("Remove the spaces around the address");
  });

  it("says a contract address can't go in a wallet-only field", () => {
    const [issue] = errorsOf(payFlow(CONTRACT)).filter(
      (e) => e.path === "nodes.p.config.recipient",
    );
    expect(issue!.friendlyMessage).toContain("needs a wallet address (G…)");
  });

  it("names a split recipient by label, or by position", () => {
    const labelled = splitFlow([ADDR_A, "BAD"]);
    (labelled.nodes[1]!.config as { recipients: { label?: string }[] }).recipients[1]!.label =
      "Bob";
    const [byLabel] = errorsOf(labelled).filter(
      (e) => e.path === "nodes.s.config.recipients.1.address",
    );
    expect(byLabel!.friendlyMessage).toContain('split recipient "Bob"');
    const [byPos] = errorsOf(splitFlow([ADDR_A, "BAD"])).filter(
      (e) => e.path === "nodes.s.config.recipients.1.address",
    );
    expect(byPos!.friendlyMessage).toContain("split recipient #2");
  });

  it("two blank split recipients are missing addresses, not also duplicates", () => {
    const errors = errorsOf(splitFlow([ADDR_A, "", ""]));
    expect(errors.filter((e) => e.message.startsWith("Duplicate address"))).toEqual([]);
    expect(errors.filter((e) => e.message === "Missing Stellar address")).toHaveLength(2);
  });

  it("a real duplicate is still reported", () => {
    const errors = errorsOf(splitFlow([ADDR_A, ADDR_B, ADDR_B]));
    expect(errors.some((e) => e.message.startsWith("Duplicate address"))).toBe(true);
  });

  it("refuses a draft in dev mode too, where a PENDING: placeholder would deploy", () => {
    const errors = errorsOf({ ...payFlow("GABC"), devMode: true });
    expect(errors.some((e) => e.path === "nodes.p.config.recipient")).toBe(true);
  });

  it("refuses a fiat pay's recipient if it is not the sentinel or an address", () => {
    const g = payFlow("GABC");
    Object.assign(g.nodes[1]!.config, { payoutMode: "fiat" });
    expect(errorsOf(g).some((e) => e.path === "nodes.p.config.recipient")).toBe(true);
  });
});

describe("complete addresses and PENDING: placeholders behave as before (#588)", () => {
  it("a pay flow to a G… account validates, with nothing pending", () => {
    const r = validateFlow(payFlow(ADDR_A));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.pendingLabels).toEqual([]);
  });

  it("a split to two G… accounts validates", () => {
    expect(validateFlow(splitFlow([ADDR_A, ADDR_B])).ok).toBe(true);
  });

  it("a PENDING: pay recipient validates and is reported pending, as before", () => {
    const r = validateFlow(payFlow("PENDING:alice"));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.pendingLabels).toEqual(["alice"]);
    expect(getPendingLabels(FlowGraphSchema.parse(payFlow("PENDING:alice")))).toEqual(["alice"]);
  });

  it.each(ALL_FIELDS)(
    "$name: a G… account and a PENDING: label raise no address issue",
    ({ graph }) => {
      for (const ok of [ADDR_A, "PENDING:x", "PENDING:"]) {
        expect(addressIssues(FlowGraphSchema.parse(graph(ok))), ok).toEqual([]);
      }
    },
  );

  it("only a split recipient accepts a C… contract", () => {
    for (const f of ALL_FIELDS) {
      // Every field raises one issue, including a crypto split recipient.
      expect(addressIssues(FlowGraphSchema.parse(f.graph(CONTRACT))).map((i) => i.path)).toEqual([
        f.path,
      ]);
    }
    expect(
      addressIssues(FlowGraphSchema.parse(splitFlow([ADDR_A, CONTRACT], "fiat"))).map(
        (i) => i.path,
      ),
    ).toEqual([]);
  });

  it("isAcceptedFlowAddress keeps the old acceptance: G…, C… for splits only, PENDING:, nothing muxed", () => {
    expect(isAcceptedFlowAddress(ADDR_A, "account")).toBe(true);
    expect(isAcceptedFlowAddress(CONTRACT, "account")).toBe(false);
    expect(isAcceptedFlowAddress(CONTRACT, "account_or_contract")).toBe(true);
    expect(isAcceptedFlowAddress("PENDING:bob", "account")).toBe(true);
    expect(isAcceptedFlowAddress(DRAFTS.at(-1)!, "account_or_contract")).toBe(false);
    for (const d of DRAFTS) expect(isAcceptedFlowAddress(d, "account_or_contract")).toBe(false);
  });

  it("covers every address field a node carries", () => {
    const fields = ALL_FIELDS.flatMap((f) =>
      FlowGraphSchema.parse(f.graph(ADDR_A)).nodes.flatMap((n) =>
        addressFields(n).map((a) => `nodes.${n.id}.config.${a.field}`),
      ),
    );
    for (const f of ALL_FIELDS) expect(fields).toContain(f.path);
  });
});
