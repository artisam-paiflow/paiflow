// Admission/retirement is exercised with real PostgreSQL in retirement.test.ts.
// This suite isolates its existing domain behavior from that service boundary.
vi.mock("@/lib/deployments/service-route", () => ({
  deploymentServiceRoute: (handler: unknown) => handler,
}));
vi.mock("@/lib/deployments/service-work", () => ({
  assertDeploymentService: vi.fn(async () => undefined),
  withDeploymentWork: async (_id: string, _kind: string, fn: () => Promise<unknown>) => fn(),
  runDeploymentWork: async (_id: string, _kind: string, fn: () => Promise<unknown>) => fn(),
  beforeExternalRelayer: vi.fn(async () => undefined),
  observeExternalRelayer: vi.fn(async () => undefined),
  beforeServiceSubmission: vi.fn(async () => undefined),
  observeServiceTransaction: vi.fn(async () => undefined),
}));
/**
 * #722: the server side of the surface switches. A switched-off surface is
 * refused where it would be NEW use (prepare, submit, its own routes), while a
 * route that operates an existing deployment keeps answering.
 *
 * Each case sets the real env var and re-imports the route, so `env()` parses
 * it the way the server does after a restart.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const { mockDb, mockAuth, mockGroq, mockDeploy, mockRelayer } = vi.hoisted(() => ({
  mockDb: {
    flow: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
    employee: { findMany: vi.fn() },
    deployment: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
  mockAuth: {
    requireSession: vi.fn(async () => ({ id: "user-1", username: "u", role: "USER" })),
    requireDevAuth: vi.fn(async () => ({ user: { id: "user-1", username: "u", role: "USER" } })),
    requireDevApiToken: vi.fn(async () => ({ id: "user-1", username: "u", role: "USER" })),
  },
  mockGroq: { callGroq: vi.fn(), transcribeAudio: vi.fn(async () => "hello") },
  mockDeploy: {
    preparePipelineDeployTx: vi.fn(),
    checkAccountFunding: vi.fn(),
    deployPipelineByRelayer: vi.fn(),
  },
  mockRelayer: {
    readPayrollIsCancelled: vi.fn(async () => false),
    readSubscriptionIsCancelled: vi.fn(async () => false),
  },
}));

vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/auth", () => mockAuth);
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(async () => ({ ok: true })),
  enforceRateLimit: vi.fn(async () => undefined),
  clientIp: vi.fn(() => "127.0.0.1"),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/ai/groq", () => mockGroq);
vi.mock("@/lib/address-book", () => ({ getAddressBook: vi.fn(async () => []) }));
vi.mock("@/lib/stellar/deploy", () => mockDeploy);
vi.mock("@/lib/stellar/relayer", () => mockRelayer);
vi.mock("@/lib/stellar/config", () => ({
  getWasmHashes: vi.fn(async () => ({ get: () => "a".repeat(64) })),
}));

const SWITCHES = [
  "FEATURE_OFFRAMP_ENABLED",
  "FEATURE_PAYROLL_ENABLED",
  "FEATURE_DEV_MODE_ENABLED",
  "FEATURE_AI_ASSISTANT_ENABLED",
  "FEATURE_ORACLE_CONDITION_ENABLED",
] as const;

const ID = "11111111-1111-1111-1111-111111111111";
const SOURCE = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const ADDR_B = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const ORACLE = "GDUY7J7A33TQWOSOQGDO776GGLM3UQERL4J3SPT56F6YS4ID7MLDERI4";
const USDC = { kind: "known", symbol: "USDC" };
const XLM = { kind: "native" };

function setSwitch(name: (typeof SWITCHES)[number], value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  vi.resetModules();
}

function jsonRequest(body: unknown): NextRequest {
  return {
    json: async () => body,
    headers: { get: () => null },
  } as unknown as NextRequest;
}

function ctx(id = ID) {
  return { params: Promise.resolve({ id }) };
}

const PAYROLL_GRAPH = {
  nodes: [
    {
      id: "t",
      type: "payroll",
      config: { asset: USDC, employer: SOURCE, intervalAmount: 1, intervalUnit: "week" },
    },
    {
      id: "a",
      type: "split",
      config: {
        asset: USDC,
        recipients: [
          { address: SOURCE, mode: "fixed", amountStroops: "60000000" },
          { address: ADDR_B, mode: "fixed", amountStroops: "40000000" },
        ],
      },
    },
  ],
  edges: [{ id: "e1", source: "t", target: "a" }],
};

const ORACLE_GRAPH = {
  nodes: [
    { id: "t", type: "on_receive", config: { asset: XLM } },
    {
      id: "c",
      type: "condition",
      config: { kind: "oracle_gte", oracle: ORACLE, key: "XLMUSD", threshold: "100" },
    },
    {
      id: "p",
      type: "pay",
      config: { recipient: ADDR_B, asset: XLM, mode: "fixed", amountStroops: "5000000" },
    },
  ],
  edges: [
    { id: "e1", source: "t", target: "c" },
    { id: "e2", source: "c", target: "p" },
  ],
};

const FIAT_PAY_GRAPH = {
  senderKyc: {
    firstName: "Juan",
    lastName: "Dela Cruz",
    countryOrigin: "Philippines",
    sourceOfFunds: "Compensation",
  },
  nodes: [
    { id: "t", type: "on_receive", config: { asset: USDC } },
    {
      id: "a",
      type: "pay",
      config: {
        asset: USDC,
        recipient: "PENDING:fiat",
        mode: "fixed",
        amountStroops: "400000000",
        payoutMode: "fiat",
        accountName: "Bob",
        accountNumber: "1234567890",
        bankCode: "BASECPH",
      },
    },
  ],
  edges: [{ id: "e1", source: "t", target: "a" }],
};

const CASH_OUT_GRAPH = {
  senderKyc: FIAT_PAY_GRAPH.senderKyc,
  nodes: [
    { id: "t", type: "on_receive", config: { asset: USDC } },
    {
      id: "a",
      type: "split",
      config: {
        asset: USDC,
        recipients: [{ address: ADDR_B, mode: "fixed", amountStroops: "400000000" }],
      },
    },
    {
      id: "c",
      type: "cash_out",
      config: { asset: USDC, accountName: "Bob", accountNumber: "1", bankCode: "BASECPH" },
    },
  ],
  edges: [
    { id: "e1", source: "t", target: "a" },
    { id: "e2", source: "a", target: "c" },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.employee.findMany.mockResolvedValue([]);
  for (const s of SWITCHES) delete process.env[s];
  mockDb.deployment.create.mockResolvedValue({ id: ID });
  mockDb.deployment.update.mockResolvedValue({});
  mockDeploy.preparePipelineDeployTx.mockResolvedValue({
    xdr: "AAAA",
    pipeline: [{ nodeId: "t", contractAddress: "C1", templateKind: "X" }],
  });
});
afterEach(() => {
  for (const s of SWITCHES) delete process.env[s];
  vi.resetModules();
});

describe("env: the surface switches", () => {
  async function features() {
    vi.resetModules();
    return (await import("@/lib/features")).serverFeatures();
  }

  it("default every surface on when unset or blank", async () => {
    expect(await features()).toEqual({
      offramp: true,
      payroll: true,
      devMode: true,
      aiAssistant: true,
      oracleCondition: true,
    });
    for (const s of SWITCHES) process.env[s] = "";
    expect(Object.values(await features()).every(Boolean)).toBe(true);
  });

  it.each(["false", "0", "off", "no", "FALSE", " False "])("reads %j as off", async (v) => {
    process.env.FEATURE_PAYROLL_ENABLED = v;
    process.env.FEATURE_DEV_MODE_ENABLED = v;
    expect((await features()).payroll).toBe(false);
    expect((await features()).devMode).toBe(false);
  });

  it.each(["true", "1", "on", "yes", "TRUE"])("reads %j as on", async (v) => {
    process.env.FEATURE_OFFRAMP_ENABLED = v;
    process.env.FEATURE_DEV_MODE_ENABLED = v;
    expect((await features()).offramp).toBe(true);
    expect((await features()).devMode).toBe(true);
  });

  it("reads a value it cannot parse as OFF instead of crashing every route", async () => {
    process.env.FEATURE_AI_ASSISTANT_ENABLED = "flase";
    process.env.FEATURE_DEV_MODE_ENABLED = "flase";
    const f = await features();
    expect(f.aiAssistant).toBe(false);
    expect(f.devMode).toBe(false);
    expect(f.payroll).toBe(true);
    // env() still parses, so crons and live deployments are unaffected.
    const { env } = await import("@/lib/env");
    expect(() => env()).not.toThrow();
  });
});

describe("POST /api/deployments/prepare", () => {
  async function prepare(graph: unknown) {
    mockDb.flow.findFirst.mockResolvedValue({ id: ID, ownerId: "user-1", graph });
    const { POST } = await import("@/app/api/deployments/prepare/route");
    return POST(jsonRequest({ flowId: ID, sourceAccount: SOURCE }) as never);
  }

  it("keeps a standard subscription/splitter deploy available with payroll and off-ramp off", async () => {
    setSwitch("FEATURE_PAYROLL_ENABLED", "false");
    setSwitch("FEATURE_OFFRAMP_ENABLED", "false");
    const graph = {
      ...PAYROLL_GRAPH,
      nodes: [
        {
          id: "t",
          type: "subscription",
          config: {
            asset: USDC,
            subscriber: SOURCE,
            amountPerPeriodStroops: "100000000",
            intervalAmount: 1,
            intervalUnit: "week",
          },
        },
        PAYROLL_GRAPH.nodes[1],
      ],
    };
    const res = await prepare(graph);
    expect(res.status).toBe(200);
    expect(mockDeploy.preparePipelineDeployTx).toHaveBeenCalledOnce();
    expect(mockDb.deployment.create).toHaveBeenCalledOnce();
  });

  it("refuses a Dev graph before simulation and still prepares a standard flow", async () => {
    setSwitch("FEATURE_DEV_MODE_ENABLED", "false");
    const res = await prepare({ ...ORACLE_GRAPH, devMode: true });
    expect(res.status).toBe(422);
    expect((await res.json()).error.fields.devMode[0]).toMatch(/Dev mode is turned off/);
    expect(mockDeploy.preparePipelineDeployTx).not.toHaveBeenCalled();
    expect(mockDb.deployment.create).not.toHaveBeenCalled();
    expect((await prepare(ORACLE_GRAPH)).status).toBe(200);
  });

  it.each([
    ["payroll", "FEATURE_PAYROLL_ENABLED", PAYROLL_GRAPH, "nodes.t", /Payroll is turned off/],
    ["cash-out", "FEATURE_OFFRAMP_ENABLED", CASH_OUT_GRAPH, "nodes.c", /Fiat off-ramp/],
    ["oracle", "FEATURE_ORACLE_CONDITION_ENABLED", ORACLE_GRAPH, "nodes.c", /oracle condition/],
    ["fiat pay", "FEATURE_OFFRAMP_ENABLED", FIAT_PAY_GRAPH, "nodes.a", /Fiat off-ramp/],
  ] as const)(
    "refuses a %s flow on its node when the switch is off",
    async (_n, sw, graph, path, msg) => {
      setSwitch(sw, "false");
      const res = await prepare(graph);
      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json.error.code).toBe("VALIDATION");
      expect(json.error.fields[path].join(" ")).toMatch(msg);
      expect(mockDb.deployment.create).not.toHaveBeenCalled();
      expect(mockDeploy.preparePipelineDeployTx).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["payroll", PAYROLL_GRAPH],
    ["oracle", ORACLE_GRAPH],
    ["fiat pay", FIAT_PAY_GRAPH],
    ["cash-out", CASH_OUT_GRAPH],
  ] as const)("prepares a %s flow when every switch is left unset", async (_n, graph) => {
    setSwitch("FEATURE_PAYROLL_ENABLED", undefined);
    const res = await prepare(graph);
    expect(res.status).toBe(200);
    expect(mockDeploy.preparePipelineDeployTx).toHaveBeenCalledOnce();
  });
});

describe("pipeline kinds, the second line behind the graph check", () => {
  it("blocks prepared Dev graphs, malformed saved graphs and every _DEV pipeline kind", async () => {
    setSwitch("FEATURE_DEV_MODE_ENABLED", "false");
    const { assertPreparedDeploymentAllowed } = await import("@/lib/features");
    for (const graph of [
      { ...ORACLE_GRAPH, devMode: true },
      { devMode: true, nodes: "old" },
    ]) {
      expect(() => assertPreparedDeploymentAllowed(graph, [])).toThrow(/Dev mode is turned off/);
    }
    for (const kind of ["PAYER_DEV", "SPLITTER_DEV", "SUBSCRIPTION_DEV", "CASH_OUT_DEV"]) {
      expect(() => assertPreparedDeploymentAllowed({}, [{ templateKind: kind }])).toThrow(
        /turned off/,
      );
    }
    expect(() =>
      assertPreparedDeploymentAllowed(ORACLE_GRAPH, [{ templateKind: "PAYER" }]),
    ).not.toThrow();
  });
  it("refuses a contract kind of a switched-off surface even when no node names it", async () => {
    const { assertNoHiddenSurfaces } = await import("@/lib/features");
    const { ALL_FEATURES_ON } = await import("@/lib/feature-flags");
    const empty = { nodes: [], edges: [] };
    const off = { ...ALL_FEATURES_ON, offramp: false };
    expect(() => assertNoHiddenSurfaces(empty, ["SPLITTER", "CASH_OUT"], off)).toThrow(
      /CASH_OUT contract, which is turned off/,
    );
    expect(() =>
      assertNoHiddenSurfaces(empty, ["SPLITTER", "CASH_OUT"], ALL_FEATURES_ON),
    ).not.toThrow();
  });

  it("stops a deployment prepared before the switch went off (submit)", async () => {
    setSwitch("FEATURE_PAYROLL_ENABLED", "false");
    const { assertPreparedDeploymentAllowed } = await import("@/lib/features");
    expect(() =>
      assertPreparedDeploymentAllowed(PAYROLL_GRAPH, [
        { nodeId: "t", templateKind: "SUBSCRIPTION" },
      ]),
    ).toThrow(/Payroll is turned off/);
    setSwitch("FEATURE_PAYROLL_ENABLED", undefined);
    const again = await import("@/lib/features");
    expect(() => again.assertPreparedDeploymentAllowed(PAYROLL_GRAPH, [])).not.toThrow();
  });
});

describe("AI assistant routes", () => {
  it("POST /api/flows/:id/edit answers 404 without calling the model when off", async () => {
    setSwitch("FEATURE_AI_ASSISTANT_ENABLED", "false");
    const { POST } = await import("@/app/api/flows/[id]/edit/route");
    const res = await POST(jsonRequest({ message: "add a split" }) as never, ctx());
    expect(res.status).toBe(404);
    expect((await res.json()).error.message).toBe("The AI assistant is turned off on this server.");
    expect(mockGroq.callGroq).not.toHaveBeenCalled();
    expect(mockDb.flow.findFirst).not.toHaveBeenCalled();
  });

  it("POST /api/transcribe answers 404 when off, and transcribes when on", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "a.webm", { type: "audio/webm" });
    const form = new FormData();
    form.set("file", file);
    const req = { formData: async () => form } as unknown as NextRequest;

    setSwitch("FEATURE_AI_ASSISTANT_ENABLED", "false");
    let { POST } = await import("@/app/api/transcribe/route");
    expect((await POST(req)).status).toBe(404);
    expect(mockGroq.transcribeAudio).not.toHaveBeenCalled();

    setSwitch("FEATURE_AI_ASSISTANT_ENABLED", undefined);
    ({ POST } = await import("@/app/api/transcribe/route"));
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect((await res.json()).data.text).toBe("hello");
  });
});

describe("payroll routes", () => {
  it("refuses dev-payroll creation independently of the Payroll switch", async () => {
    setSwitch("FEATURE_DEV_MODE_ENABLED", "false");
    const { POST } = await import("@/app/api/deployments/dev-payroll/route");
    const response = await POST(jsonRequest({}));
    expect(response.status).toBe(404);
    expect((await response.json()).error.message).toMatch(/Dev mode is turned off/);
    expect(mockDeploy.deployPipelineByRelayer).not.toHaveBeenCalled();
  });

  it("blocks shared Payroll configuration routes for Dev deployments", async () => {
    setSwitch("FEATURE_DEV_MODE_ENABLED", "false");
    mockDb.deployment.findFirst.mockResolvedValue({
      id: ID,
      graphSnapshot: { devMode: true },
      pipelineSnapshot: [],
      flow: { templateKind: "PAYROLL" },
    });
    const { POST } = await import("@/app/api/deployments/[id]/payroll-update-recipients/route");
    const response = await POST(
      jsonRequest({ recipients: [{ address: SOURCE, amount: "1" }] }),
      ctx(),
    );
    expect(response.status).toBe(404);
    const bank = await import("@/app/api/deployments/[id]/employees/bank/route");
    expect((await bank.POST(jsonRequest({}), ctx())).status).toBe(404);
    expect((await bank.DELETE(jsonRequest({}), ctx())).status).toBe(404);
  });
  it("POST /api/deployments/dev-payroll (a new payroll deploy) answers 404 when off", async () => {
    setSwitch("FEATURE_PAYROLL_ENABLED", "false");
    const { POST } = await import("@/app/api/deployments/dev-payroll/route");
    const res = await POST(jsonRequest({}) as never);
    expect(res.status).toBe(404);
    expect((await res.json()).error.message).toBe("Payroll is turned off on this server.");
    expect(mockDeploy.deployPipelineByRelayer).not.toHaveBeenCalled();
  });

  it("GET payroll-status of an existing payroll still answers when off", async () => {
    setSwitch("FEATURE_PAYROLL_ENABLED", "false");
    mockDb.deployment.findFirst.mockResolvedValue({
      id: ID,
      flow: { templateKind: "PAYROLL" },
      pipelineSnapshot: [{ nodeId: "t", contractAddress: "CSUB", templateKind: "SUBSCRIPTION" }],
    });
    const { GET } = await import("@/app/api/deployments/[id]/payroll-status/route");
    const res = await GET(jsonRequest({}) as never, ctx());
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ isCancelled: false, contractAddress: "CSUB" });
  });
});

describe("Dev-specific routes", () => {
  const routes = {
    "dev-config": async () => (await import("@/app/api/deployments/[id]/dev-config/route")).GET,
    "dev-payer": async () => (await import("@/app/api/deployments/[id]/dev-payer/route")).POST,
    "dev-splitter": async () =>
      (await import("@/app/api/deployments/[id]/dev-splitter/route")).POST,
    "dev-subscription": async () =>
      (await import("@/app/api/deployments/[id]/dev-subscription/route")).POST,
    "dev-cash-out": async () =>
      (await import("@/app/api/deployments/[id]/dev-cash-out/route")).POST,
  };
  it.each(Object.entries(routes))(
    "%s is unavailable without reading the body or deployment",
    async (_route, load) => {
      setSwitch("FEATURE_DEV_MODE_ENABLED", "false");
      const handler = await load();
      const request = jsonRequest({});
      const readBody = vi.spyOn(request, "json");
      const response = await handler(request, ctx());
      expect(response.status).toBe(404);
      expect((await response.json()).error.message).toMatch(/Dev mode is turned off/);
      expect(mockDb.deployment.findFirst).not.toHaveBeenCalled();
      expect(readBody).not.toHaveBeenCalled();
    },
  );
});

describe("off-ramp routes", () => {
  const payroll = { id: ID, offRampEnabled: false, flow: { templateKind: "PAYROLL" } };

  it("refuses turning the off-ramp ON for a payroll when off", async () => {
    setSwitch("FEATURE_OFFRAMP_ENABLED", "false");
    mockDb.deployment.findFirst.mockResolvedValue(payroll);
    const { POST } = await import("@/app/api/deployments/[id]/offramp-enable/route");
    const res = await POST(jsonRequest({ enabled: true }) as never, ctx());
    expect(res.status).toBe(422);
    expect((await res.json()).error.fields.enabled[0]).toMatch(/Fiat off-ramp is turned off/);
    expect(mockDb.deployment.update).not.toHaveBeenCalled();
  });

  it("still reads the setting and turns it OFF for an existing payroll when off", async () => {
    setSwitch("FEATURE_OFFRAMP_ENABLED", "false");
    mockDb.deployment.findFirst.mockResolvedValue(payroll);
    const { GET, POST } = await import("@/app/api/deployments/[id]/offramp-enable/route");
    expect((await GET(jsonRequest({}) as never, ctx())).status).toBe(200);
    const res = await POST(jsonRequest({ enabled: false }) as never, ctx());
    expect(res.status).toBe(200);
    expect(mockDb.deployment.update).toHaveBeenCalledOnce();
  });

  it("refuses a NEW fiat recipient on the dev splitter when off", async () => {
    setSwitch("FEATURE_OFFRAMP_ENABLED", "false");
    mockDb.deployment.findFirst.mockResolvedValue({ id: ID, pipelineSnapshot: [] });
    const { POST } = await import("@/app/api/deployments/[id]/dev-splitter/route");
    const res = await POST(
      jsonRequest({
        recipients: [
          {
            mode: "fixed",
            amountStroops: "10000000",
            payoutMode: "fiat",
            bankDetail: { accountName: "B", accountNumber: "1", bankCode: "BASECPH" },
          },
        ],
      }) as never,
      ctx(),
    );
    expect(res.status).toBe(422);
    expect((await res.json()).error.fields.recipients[0]).toMatch(/Existing fiat recipients/);
  });

  it("refuses a NEW fiat employee on payroll-update-recipients when off", async () => {
    setSwitch("FEATURE_OFFRAMP_ENABLED", "false");
    mockDb.deployment.findFirst.mockResolvedValue({ id: ID, flow: { templateKind: "PAYROLL" } });
    const { POST } = await import("@/app/api/deployments/[id]/payroll-update-recipients/route");
    const res = await POST(
      jsonRequest({
        recipients: [
          {
            amount: "10000000",
            payoutMode: "fiat",
            bankDetail: { accountName: "B", accountNumber: "9", bankCode: "BASECPH" },
          },
        ],
      }) as never,
      ctx(),
    );
    expect(res.status).toBe(422);
  });
});

describe("refuseNewFiatRecipients: existing fiat recipients keep updating", () => {
  const fiat = (accountNumber: string) => ({
    payoutMode: "fiat",
    bankDetail: { accountNumber, bankCode: "BASECPH" },
  });

  it("lets a roster that keeps an existing fiat employee and edits a crypto one through", async () => {
    setSwitch("FEATURE_OFFRAMP_ENABLED", "false");
    mockDb.employee.findMany.mockResolvedValue([
      { bankDetail: { accountNumber: "111", bankCode: "BASECPH" } },
    ]);
    const { refuseNewFiatRecipients } = await import("@/lib/features");
    await expect(
      refuseNewFiatRecipients(ID, [fiat("111"), { payoutMode: "crypto" }]),
    ).resolves.toBeUndefined();
    await expect(refuseNewFiatRecipients(ID, [fiat("111"), fiat("222")])).rejects.toThrow(
      /Fiat off-ramp is turned off/,
    );
  });

  it("does not look anything up while the off-ramp is on, or for a crypto-only roster", async () => {
    const { refuseNewFiatRecipients } = await import("@/lib/features");
    await refuseNewFiatRecipients(ID, [fiat("222")]);
    setSwitch("FEATURE_OFFRAMP_ENABLED", "false");
    const off = await import("@/lib/features");
    await off.refuseNewFiatRecipients(ID, [{ payoutMode: "crypto" }]);
    expect(mockDb.employee.findMany).not.toHaveBeenCalled();
  });
});

describe("flow save and validate", () => {
  it("cannot change a saved Dev graph through address resolution while off", async () => {
    setSwitch("FEATURE_DEV_MODE_ENABLED", "false");
    mockDb.flow.findFirst.mockResolvedValue({ id: ID, graph: { ...ORACLE_GRAPH, devMode: true } });
    const { POST } = await import("@/app/api/flows/[id]/resolve-addresses/route");
    const response = await POST(jsonRequest({ addresses: { Bob: SOURCE } }), ctx());
    expect(response.status).toBe(422);
    expect((await response.json()).error.fields.devMode[0]).toMatch(/Dev mode is turned off/);
    expect(mockDb.flow.update).not.toHaveBeenCalled();
  });
  it("rejects Dev flow creation and graph updates without persisting them", async () => {
    setSwitch("FEATURE_DEV_MODE_ENABLED", "false");
    const graph = { ...ORACLE_GRAPH, devMode: true };
    const { POST } = await import("@/app/api/flows/route");
    const created = await POST(jsonRequest({ name: "Dev", graph }));
    expect(created.status).toBe(422);
    expect((await created.json()).error.fields.devMode[0]).toMatch(/Dev mode is turned off/);
    expect(mockDb.flow.create).not.toHaveBeenCalled();
    mockDb.flow.findFirst.mockResolvedValue({ id: ID, name: "Old Dev", graph });
    const { PATCH } = await import("@/app/api/flows/[id]/route");
    expect((await PATCH(jsonRequest({ graph }), ctx())).status).toBe(422);
    expect(mockDb.flow.update).not.toHaveBeenCalled();
    mockDb.flow.update.mockResolvedValue({ id: ID });
    expect((await PATCH(jsonRequest({ graph: { ...graph, devMode: false } }), ctx())).status).toBe(
      200,
    );
    expect(mockDb.flow.update).toHaveBeenCalledOnce();
  });
  it("PATCH (autosave) still saves an old flow holding a switched-off block", async () => {
    setSwitch("FEATURE_PAYROLL_ENABLED", "false");
    mockDb.flow.findFirst.mockResolvedValue({
      id: ID,
      ownerId: "user-1",
      name: "old",
      graph: { nodes: [], edges: [] },
      templateKind: "SPLITTER",
      parameters: {},
    });
    mockDb.flow.update.mockImplementation(async ({ data }: { data: unknown }) => data);
    const { PATCH } = await import("@/app/api/flows/[id]/route");
    const res = await PATCH(jsonRequest({ graph: PAYROLL_GRAPH }) as never, ctx());
    expect(res.status).toBe(200);
    const saved = mockDb.flow.update.mock.calls[0]![0] as {
      data: { graph: { nodes: Array<{ type: string }> } };
    };
    expect(saved.data.graph.nodes.map((n) => n.type)).toEqual(["payroll", "split"]);
  });

  it("POST /api/flows/:id/validate reports the switched-off block", async () => {
    setSwitch("FEATURE_ORACLE_CONDITION_ENABLED", "false");
    mockDb.flow.findFirst.mockResolvedValue({ id: ID, graph: ORACLE_GRAPH });
    const { POST } = await import("@/app/api/flows/[id]/validate/route");
    const json = await (await POST(jsonRequest({}) as never, ctx())).json();
    expect(json.data.ok).toBe(false);
    expect(json.data.errors[0]).toMatchObject({ code: "FEATURE_DISABLED", nodeId: "c" });
  });
});

describe("what keeps running for existing deployments", () => {
  // Crons, SSE and webhook execution operate pipelines already on chain.
  // Presentation on deployment pages can hide Dev configuration separately.
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory()
        ? sources(p)
        : p.endsWith(".ts") || p.endsWith(".tsx")
          ? [p]
          : [];
    });
  }

  it("no cron, SSE or webhook reads the switches", () => {
    const files = [
      ...sources("app/api/cron"),
      "app/api/deployments/[id]/events/route.ts",
      ...sources("app/api/webhooks"),
    ];
    const readers = files.filter((f) =>
      /lib\/features|lib\/feature-flags/.test(readFileSync(f, "utf8")),
    );
    expect(readers).toEqual([]);
  });
});
