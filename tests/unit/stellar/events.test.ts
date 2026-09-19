import { describe, expect, it, vi, beforeEach } from "vitest";
import { nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { EVENTS_PAGE_LIMIT, MAX_EVENT_PAGES_PER_POLL, pollEventsFor } from "@/lib/stellar/events";
import { sorobanRpc } from "@/lib/stellar/client";
import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { EventKind, TemplateKind } from "@prisma/client";
import type { Prisma } from "@prisma/client";

const ADDR_A = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const ADDR_B = "GAA5Z4XWC6K2RHP7K4BAVPUGDL3EUD5PGGBHJ7S2RFWAFHTTLHXN6CFZ";

vi.mock("@/lib/stellar/client");
vi.mock("@/lib/db", () => ({
  db: {
    deployment: { findUnique: vi.fn() },
    contractEvent: { create: vi.fn() },
    eventCursor: { upsert: vi.fn() },
  },
}));

vi.mock("@/lib/redis", () => ({
  redis: vi.fn(() => null),
  eventChannel: (id: string) => `events:${id}`,
}));

vi.mock("@/lib/log", () => ({
  log: { warn: vi.fn(), info: vi.fn() },
}));

function makeMockEvent(opts: {
  topic: unknown[];
  value: unknown;
  ledger: number;
  txHash: string;
  ledgerClosedAt: string;
}) {
  return {
    type: "contract" as const,
    contractId: "C123",
    id: `evt-${opts.ledger}-${opts.txHash}`,
    pagingToken: `pt-${opts.ledger}`,
    topic: opts.topic.map((t) => nativeToScVal(t)),
    value: nativeToScVal(opts.value),
    ledger: opts.ledger,
    txHash: opts.txHash,
    ledgerClosedAt: opts.ledgerClosedAt,
    inSuccessfulContractCall: true,
  };
}

function mockServer(opts: {
  getTransaction?: () => Promise<{ status: string; ledger: number; txHash: string }>;
  getEvents?: () => Promise<{
    events: ReturnType<typeof makeMockEvent>[];
    latestLedger: number;
  }>;
}) {
  vi.mocked(sorobanRpc).mockReturnValue({
    getTransaction:
      opts.getTransaction ?? (async () => ({ status: "SUCCESS", ledger: 1000, txHash: "tx1" })),
    getEvents:
      opts.getEvents ??
      (async () => ({
        events: [],
        latestLedger: 1000,
      })),
  } as unknown as ReturnType<typeof sorobanRpc>);
}

describe("pollEventsFor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 0 when deployment is not found", async () => {
    vi.mocked(db.deployment.findUnique).mockResolvedValue(null);
    const result = await pollEventsFor("dep-1");
    expect(result).toBe(0);
  });

  it("returns 0 when contractAddress is missing", async () => {
    vi.mocked(db.deployment.findUnique).mockResolvedValue({
      id: "dep-1",
      contractAddress: null,
      status: "CONFIRMED",
      cursor: null,
      deployTxHash: null,
      flow: { templateKind: TemplateKind.SPLITTER },
    } as unknown as Prisma.PromiseReturnType<typeof db.deployment.findUnique>);
    const result = await pollEventsFor("dep-1");
    expect(result).toBe(0);
  });

  it("returns 0 when status is not CONFIRMED", async () => {
    vi.mocked(db.deployment.findUnique).mockResolvedValue({
      id: "dep-1",
      contractAddress: "C123",
      status: "PENDING",
      cursor: null,
      deployTxHash: null,
      flow: { templateKind: TemplateKind.SPLITTER },
    } as unknown as Prisma.PromiseReturnType<typeof db.deployment.findUnique>);
    const result = await pollEventsFor("dep-1");
    expect(result).toBe(0);
  });

  it("returns 0 when flow templateKind is missing", async () => {
    vi.mocked(db.deployment.findUnique).mockResolvedValue({
      id: "dep-1",
      contractAddress: "C123",
      status: "CONFIRMED",
      cursor: null,
      deployTxHash: null,
      flow: null,
    } as unknown as Prisma.PromiseReturnType<typeof db.deployment.findUnique>);
    mockServer({});
    const result = await pollEventsFor("dep-1");
    expect(result).toBe(0);
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ deploymentId: "dep-1" }),
      "pollEventsFor: flow templateKind not found, skipping",
    );
  });

  it("cursor-exists path: polls from cursor.lastLedger + 1 and writes new cursor", async () => {
    const event = makeMockEvent({
      topic: ["payout"],
      value: [{ address: ADDR_A, bps: 5000, amount: "100" }],
      ledger: 500,
      txHash: "tx1",
      ledgerClosedAt: "2024-01-01T00:00:00Z",
    });

    vi.mocked(db.deployment.findUnique).mockResolvedValue({
      id: "dep-1",
      contractAddress: "C123",
      status: "CONFIRMED",
      cursor: { lastLedger: 400 },
      deployTxHash: "dtx1",
      flow: { templateKind: TemplateKind.SPLITTER },
    } as unknown as Prisma.PromiseReturnType<typeof db.deployment.findUnique>);

    mockServer({
      getEvents: async () => ({
        events: [event],
        latestLedger: 500,
      }),
    });

    const result = await pollEventsFor("dep-1");
    expect(result).toBe(1);
    expect(db.contractEvent.create).toHaveBeenCalledTimes(1);
    expect(db.eventCursor.upsert).toHaveBeenCalledWith({
      where: { deploymentId: "dep-1" },
      update: { lastLedger: 500 },
      create: { deploymentId: "dep-1", lastLedger: 500 },
    });
  });

  it("cursor-exists with falsy lastLedger (0): still takes cursor path", async () => {
    vi.mocked(db.deployment.findUnique).mockResolvedValue({
      id: "dep-1",
      contractAddress: "C123",
      status: "CONFIRMED",
      cursor: { lastLedger: 0 },
      deployTxHash: "dtx1",
      flow: { templateKind: TemplateKind.SPLITTER },
    } as unknown as Prisma.PromiseReturnType<typeof db.deployment.findUnique>);

    mockServer({
      getEvents: async () => ({
        events: [],
        latestLedger: 0,
      }),
    });

    const result = await pollEventsFor("dep-1");
    expect(result).toBe(0);
    // Should call getEvents with startLedger = 1 (0 + 1)
    expect(sorobanRpc).toHaveBeenCalled();
  });

  it("no-cursor + deployTxHash path: fetches deploy ledger and polls with buffer", async () => {
    const event = makeMockEvent({
      topic: ["payout"],
      value: [{ address: ADDR_A, bps: 5000, amount: "200" }],
      ledger: 900,
      txHash: "tx2",
      ledgerClosedAt: "2024-01-01T00:00:00Z",
    });

    vi.mocked(db.deployment.findUnique).mockResolvedValue({
      id: "dep-1",
      contractAddress: "C123",
      status: "CONFIRMED",
      cursor: null,
      deployTxHash: "dtx1",
      flow: { templateKind: TemplateKind.SPLITTER },
    } as unknown as Prisma.PromiseReturnType<typeof db.deployment.findUnique>);

    mockServer({
      getTransaction: async () => ({ status: "SUCCESS", ledger: 1000, txHash: "dtx1" }),
      getEvents: async () => ({
        events: [event],
        latestLedger: 900,
      }),
    });

    const result = await pollEventsFor("dep-1");
    expect(result).toBe(1);
    expect(db.contractEvent.create).toHaveBeenCalledTimes(1);
    expect(db.eventCursor.upsert).toHaveBeenCalledWith({
      where: { deploymentId: "dep-1" },
      update: { lastLedger: 900 },
      create: { deploymentId: "dep-1", lastLedger: 900 },
    });
  });

  it("no-cursor + no-deployTxHash path: logs warning and returns 0", async () => {
    vi.mocked(db.deployment.findUnique).mockResolvedValue({
      id: "dep-1",
      contractAddress: "C123",
      status: "CONFIRMED",
      cursor: null,
      deployTxHash: null,
      flow: { templateKind: TemplateKind.SPLITTER },
    } as unknown as Prisma.PromiseReturnType<typeof db.deployment.findUnique>);

    const result = await pollEventsFor("dep-1");
    expect(result).toBe(0);
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ deploymentId: "dep-1" }),
      "pollEventsFor: no cursor and no deployTxHash, skipping",
    );
  });

  it("getDeploymentLedger failure path: logs warning and returns 0", async () => {
    vi.mocked(db.deployment.findUnique).mockResolvedValue({
      id: "dep-1",
      contractAddress: "C123",
      status: "CONFIRMED",
      cursor: null,
      deployTxHash: "dtx1",
      flow: { templateKind: TemplateKind.SPLITTER },
    } as unknown as Prisma.PromiseReturnType<typeof db.deployment.findUnique>);

    mockServer({
      getTransaction: async () => ({ status: "NOT_FOUND", ledger: 0, txHash: "dtx1" }),
    });

    const result = await pollEventsFor("dep-1");
    expect(result).toBe(0);
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ deploymentId: "dep-1" }),
      "getDeploymentLedger failed, skipping",
    );
  });

  it("decodes splitter forward events with recipient as FORWARD", async () => {
    const event = makeMockEvent({
      topic: ["forward", ADDR_A, ADDR_B],
      value: "350000000",
      ledger: 500,
      txHash: "tx1",
      ledgerClosedAt: "2024-01-01T00:00:00Z",
    });

    vi.mocked(db.deployment.findUnique).mockResolvedValue({
      id: "dep-1",
      contractAddress: "C123",
      status: "CONFIRMED",
      cursor: { lastLedger: 400 },
      deployTxHash: "dtx1",
      flow: { templateKind: TemplateKind.SPLITTER },
    } as unknown as Prisma.PromiseReturnType<typeof db.deployment.findUnique>);

    mockServer({
      getEvents: async () => ({
        events: [event],
        latestLedger: 500,
      }),
    });

    const result = await pollEventsFor("dep-1");
    expect(result).toBe(1);
    expect(db.contractEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: "FORWARD",
        decodedData: { asset: ADDR_A, recipient: ADDR_B, amount: "350000000" },
      }),
    });
  });

  it("decodes legacy splitter forward events without recipient as FORWARD", async () => {
    const event = makeMockEvent({
      topic: ["forward", ADDR_A],
      value: "350000000",
      ledger: 500,
      txHash: "tx1",
      ledgerClosedAt: "2024-01-01T00:00:00Z",
    });

    vi.mocked(db.deployment.findUnique).mockResolvedValue({
      id: "dep-1",
      contractAddress: "C123",
      status: "CONFIRMED",
      cursor: { lastLedger: 400 },
      deployTxHash: "dtx1",
      flow: { templateKind: TemplateKind.SPLITTER },
    } as unknown as Prisma.PromiseReturnType<typeof db.deployment.findUnique>);

    mockServer({
      getEvents: async () => ({
        events: [event],
        latestLedger: 500,
      }),
    });

    const result = await pollEventsFor("dep-1");
    expect(result).toBe(1);
    expect(db.contractEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: "FORWARD",
        decodedData: { asset: ADDR_A, amount: "350000000" },
      }),
    });
  });

  it("decodes streamer deposit event as RECEIVE", async () => {
    const funder = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAK2";
    const event = makeMockEvent({
      topic: ["deposit", funder],
      value: "5000",
      ledger: 600,
      txHash: "tx3",
      ledgerClosedAt: "2024-01-01T00:00:00Z",
    });

    vi.mocked(db.deployment.findUnique).mockResolvedValue({
      id: "dep-1",
      contractAddress: "C123",
      status: "CONFIRMED",
      cursor: { lastLedger: 500 },
      deployTxHash: "dtx1",
      graphSnapshot: null,
      pipelineSnapshot: null,
      flow: { templateKind: TemplateKind.STREAMER },
    } as unknown as Prisma.PromiseReturnType<typeof db.deployment.findUnique>);

    mockServer({
      getEvents: async () => ({
        events: [event],
        latestLedger: 600,
      }),
    });

    const result = await pollEventsFor("dep-1");
    expect(result).toBe(1);
    expect(db.contractEvent.create).toHaveBeenCalledTimes(1);
    expect(db.contractEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: EventKind.RECEIVE,
          decodedData: { from: funder, amount: "5000" },
        }),
      }),
    );
  });
  it("decodes swapper swap events as PAYOUT with both assets and amounts (Instawards D1)", async () => {
    const XLM_SAC = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
    const USDC_SAC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
    // Shape of the event emitted by contracts/actions/swapper on testnet
    // (tx 5389cdee87826b944f4fca397c0fadc8524cbb2429c2a657a306a06a4c5fc673):
    // topics ("swap", asset_in, asset_out), data (amount_in, amount_out).
    const event = makeMockEvent({
      topic: ["swap", XLM_SAC, USDC_SAC],
      value: ["100000000", "10562889"],
      ledger: 600,
      txHash: "tx-swap",
      ledgerClosedAt: "2026-09-06T00:01:42Z",
    });

    vi.mocked(db.deployment.findUnique).mockResolvedValue({
      id: "dep-1",
      contractAddress: "C123",
      status: "CONFIRMED",
      cursor: { lastLedger: 500 },
      deployTxHash: "dtx1",
      flow: { templateKind: TemplateKind.SWAPPER },
    } as unknown as Prisma.PromiseReturnType<typeof db.deployment.findUnique>);

    mockServer({
      getEvents: async () => ({
        events: [event],
        latestLedger: 600,
      }),
    });

    const result = await pollEventsFor("dep-1");
    expect(result).toBe(1);
    expect(db.contractEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: "PAYOUT",
        decodedData: {
          assetIn: XLM_SAC,
          assetOut: USDC_SAC,
          amountIn: "100000000",
          amountOut: "10562889",
        },
      }),
    });
  });
});

/**
 * A tester on a swap flow saw "Received 10 USDC" under "Swapped 10 XLM ->
 * 1.0578 USDC". Two faults stacked: the root contract was decoded with the
 * flow's template kind (SWAPPER), whose registry has no `deposit` topic, so the
 * trigger's deposit fell through to genericDecode and lost both `from` and any
 * asset; and nothing then supplied the asset, so the feed guessed it from the
 * graph and landed on the swap's output. These cases pin both.
 */
describe("pollEventsFor: the inbound asset of a RECEIVE", () => {
  const XLM_SAC = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
  const TRIGGER_ADDR = "C123";
  const XLM = { kind: "native" };
  const USDC = { kind: "known", symbol: "USDC" };

  // trigger(XLM) -> swap(XLM->USDC): the flow from the report.
  const swapGraph = {
    nodes: [
      { id: "t", type: "on_receive", config: { asset: XLM } },
      {
        id: "s",
        type: "swap",
        config: { assetIn: XLM, assetOut: USDC, slippageBps: 100, deadlineSecs: 300 },
      },
    ],
    edges: [{ source: "t", target: "s" }],
  };

  function mockDeployment(over: Record<string, unknown>) {
    vi.mocked(db.deployment.findUnique).mockResolvedValue({
      id: "dep-1",
      contractAddress: TRIGGER_ADDR,
      status: "CONFIRMED",
      cursor: { lastLedger: 500 },
      deployTxHash: "dtx1",
      graphSnapshot: null,
      pipelineSnapshot: null,
      ...over,
    } as unknown as Prisma.PromiseReturnType<typeof db.deployment.findUnique>);
  }

  function depositEvent() {
    return makeMockEvent({
      topic: ["deposit", ADDR_A],
      value: "100000000",
      ledger: 600,
      txHash: "tx-deposit",
      ledgerClosedAt: "2026-09-16T00:00:00Z",
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("decodes the root contract with its own template kind, not the flow's", async () => {
    mockDeployment({
      flow: { templateKind: TemplateKind.SWAPPER },
      pipelineSnapshot: [
        { nodeId: "t", contractAddress: TRIGGER_ADDR, templateKind: TemplateKind.DEPOSIT_TRIGGER },
      ],
    });
    mockServer({ getEvents: async () => ({ events: [depositEvent()], latestLedger: 600 }) });

    await pollEventsFor("dep-1");

    // SWAPPER_REGISTRY has no `deposit`, so this used to land as
    // `{ address, amount }` via genericDecode -- and `address` is read as the
    // recipient elsewhere, not the sender.
    expect(db.contractEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: EventKind.RECEIVE,
          decodedData: expect.objectContaining({ from: ADDR_A }),
        }),
      }),
    );
  });

  it("stamps the trigger's asset on a deposit that carries no asset topic", async () => {
    mockDeployment({
      flow: { templateKind: TemplateKind.SWAPPER },
      graphSnapshot: swapGraph,
      pipelineSnapshot: [
        { nodeId: "t", contractAddress: TRIGGER_ADDR, templateKind: TemplateKind.DEPOSIT_TRIGGER },
      ],
    });
    mockServer({ getEvents: async () => ({ events: [depositEvent()], latestLedger: 600 }) });

    await pollEventsFor("dep-1");

    // The reported bug: this row used to carry no asset at all, so the feed fell
    // back to the swap's assetOut and rendered "Received 10 USDC".
    expect(db.contractEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: EventKind.RECEIVE,
          decodedData: { from: ADDR_A, amount: "100000000", asset: "XLM" },
        }),
      }),
    );
  });

  it("stamps the emitting node's asset, not the flow's inbound asset", async () => {
    // trigger(XLM) -> yield(USDC), polled at the yield contract: the asset
    // entering that node is USDC even though XLM entered the flow.
    mockDeployment({
      flow: { templateKind: TemplateKind.YIELD },
      graphSnapshot: {
        nodes: [
          { id: "t", type: "on_receive", config: { asset: XLM } },
          { id: "y", type: "yield", config: { asset: USDC, vault: ADDR_B } },
        ],
        edges: [{ source: "t", target: "y" }],
      },
      pipelineSnapshot: [
        { nodeId: "y", contractAddress: TRIGGER_ADDR, templateKind: TemplateKind.YIELD },
      ],
    });
    mockServer({
      getEvents: async () => ({
        events: [
          makeMockEvent({
            topic: ["deposit", ADDR_B],
            value: "100000000",
            ledger: 600,
            txHash: "tx-vault",
            ledgerClosedAt: "2026-09-16T00:00:00Z",
          }),
        ],
        latestLedger: 600,
      }),
    });

    await pollEventsFor("dep-1");

    expect(db.contractEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          decodedData: { vault: ADDR_B, amount: "100000000", asset: "USDC" },
        }),
      }),
    );
  });

  it("keeps an asset the decoder read from a topic", async () => {
    // An asset the graph does not name, so buildAssetSymbolMap cannot rewrite it
    // and the stamp is the only thing that could change what lands.
    const OTHER_SAC = "CDEEJZG6DYN65DTZLS6WU7YJ3I4RJ4TSOHF5VXEFO7PTTHWRNREPDOOU";
    mockDeployment({
      flow: { templateKind: TemplateKind.STREAMER },
      graphSnapshot: swapGraph,
      pipelineSnapshot: [
        { nodeId: "t", contractAddress: TRIGGER_ADDR, templateKind: TemplateKind.STREAMER },
      ],
    });
    mockServer({
      getEvents: async () => ({
        events: [
          makeMockEvent({
            topic: ["receive", OTHER_SAC],
            value: "100000000",
            ledger: 600,
            txHash: "tx-receive",
            ledgerClosedAt: "2026-09-16T00:00:00Z",
          }),
        ],
        latestLedger: 600,
      }),
    });

    await pollEventsFor("dep-1");

    expect(db.contractEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          decodedData: { asset: OTHER_SAC, amount: "100000000" },
        }),
      }),
    );
  });

  it("leaves a PAYOUT alone even with a graph and pipeline to read", async () => {
    mockDeployment({
      flow: { templateKind: TemplateKind.SWAPPER },
      graphSnapshot: swapGraph,
      pipelineSnapshot: [
        { nodeId: "s", contractAddress: TRIGGER_ADDR, templateKind: TemplateKind.SWAPPER },
      ],
    });
    mockServer({
      getEvents: async () => ({
        events: [
          makeMockEvent({
            topic: ["swap", XLM_SAC, "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA"],
            value: ["100000000", "10562889"],
            ledger: 600,
            txHash: "tx-swap",
            ledgerClosedAt: "2026-09-16T00:00:00Z",
          }),
        ],
        latestLedger: 600,
      }),
    });

    await pollEventsFor("dep-1");

    // The outbound asset is a different rule; stamping is RECEIVE-only.
    expect(db.contractEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: EventKind.PAYOUT,
          // Both legs symbolized by resolveAssetSymbols, and no `asset` key
          // added on top: stamping is RECEIVE-only.
          decodedData: {
            assetIn: "XLM",
            assetOut: "USDC",
            amountIn: "100000000",
            amountOut: "10562889",
          },
        }),
      }),
    );
  });

  it("leaves decodedData untouched when the deployment has no graph snapshot", async () => {
    mockDeployment({
      flow: { templateKind: TemplateKind.DEPOSIT_TRIGGER },
      pipelineSnapshot: [
        { nodeId: "t", contractAddress: TRIGGER_ADDR, templateKind: TemplateKind.DEPOSIT_TRIGGER },
      ],
    });
    mockServer({ getEvents: async () => ({ events: [depositEvent()], latestLedger: 600 }) });

    await pollEventsFor("dep-1");

    expect(db.contractEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          decodedData: { from: ADDR_A, amount: "100000000" },
        }),
      }),
    );
  });
});

describe("pollEventsFor: RPC scan windows", () => {
  type Req = { startLedger?: number; cursor?: string; filters: { contractIds: string[] }[] };

  /** A getEvents cursor pointing into `ledger`, in the RPC's TOID-eventIndex shape. */
  const cursorAt = (ledger: number, index = 4294967295) =>
    `${(BigInt(ledger) << 32n).toString().padStart(19, "0")}-${String(index).padStart(10, "0")}`;

  const payout = (ledger: number, n = 0) =>
    makeMockEvent({
      topic: ["payout"],
      value: [{ address: ADDR_A, bps: 10000, amount: "100" }],
      ledger,
      txHash: `tx-${ledger}-${n}`,
      ledgerClosedAt: "2026-09-15T00:00:00Z",
    });

  function deployment(lastLedger: number, pipeline: unknown[] = []) {
    vi.mocked(db.deployment.findUnique).mockResolvedValue({
      id: "dep-1",
      contractAddress: "C123",
      status: "CONFIRMED",
      cursor: { lastLedger },
      deployTxHash: "dtx1",
      pipelineSnapshot: pipeline,
      flow: { templateKind: TemplateKind.SPLITTER },
    } as unknown as Prisma.PromiseReturnType<typeof db.deployment.findUnique>);
  }

  function server(
    getEvents: (req: Req) => Promise<unknown>,
    oldestLedger = 1,
    latestLedger = 10_000_000,
  ) {
    const spy = vi.fn(getEvents);
    vi.mocked(sorobanRpc).mockReturnValue({
      getEvents: spy,
      getHealth: async () => ({ oldestLedger, latestLedger }),
    } as unknown as ReturnType<typeof sorobanRpc>);
    return spy;
  }

  const cursorWritten = () => vi.mocked(db.eventCursor.upsert).mock.calls.at(-1)?.[0].update;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("follows the cursor across empty windows and ingests an event past the first one", async () => {
    deployment(100_000);
    const spy = server(async (req) => {
      const from = req.startLedger ?? Number(BigInt(req.cursor!.split("-")[0]!) >> 32n) + 1;
      const end = from + 9_999;
      if (end < 125_000) return { events: [], cursor: cursorAt(end), latestLedger: 125_000 };
      return { events: [payout(124_000)], cursor: cursorAt(125_000), latestLedger: 125_000 };
    });

    expect(await pollEventsFor("dep-1")).toBe(1);
    expect(spy.mock.calls[0]![0]).toMatchObject({ startLedger: 100_001 });
    expect(spy.mock.calls[1]![0]).toMatchObject({ cursor: cursorAt(110_000) });
    expect(spy.mock.calls[1]![0].startLedger).toBeUndefined();
    expect(cursorWritten()).toEqual({ lastLedger: 125_000 });
  });

  it("advances the cursor to the tip when the window holds no events", async () => {
    deployment(100_000);
    server(async () => ({ events: [], cursor: cursorAt(104_000), latestLedger: 104_000 }));

    expect(await pollEventsFor("dep-1")).toBe(0);
    expect(cursorWritten()).toEqual({ lastLedger: 104_000 });
  });

  it("stops at the page cap and persists how far it read, so the next poll resumes there", async () => {
    deployment(0);
    const spy = server(async (req) => {
      const from = req.startLedger ?? Number(BigInt(req.cursor!.split("-")[0]!) >> 32n) + 1;
      return { events: [], cursor: cursorAt(from + 9_999), latestLedger: 190_000 };
    });

    await pollEventsFor("dep-1");
    expect(spy).toHaveBeenCalledTimes(MAX_EVENT_PAGES_PER_POLL);
    expect(cursorWritten()).toEqual({ lastLedger: MAX_EVENT_PAGES_PER_POLL * 10_000 });
  });

  it("keeps reading after a full page, and never marks a partly-read ledger complete", async () => {
    deployment(0);
    const full = Array.from({ length: EVENTS_PAGE_LIMIT }, (_, i) => payout(700, i));
    const spy = server(async (req) =>
      req.cursor
        ? { events: [payout(700, 999)], cursor: cursorAt(800), latestLedger: 800 }
        : { events: full, cursor: cursorAt(700, 99), latestLedger: 800 },
    );

    expect(await pollEventsFor("dep-1")).toBe(EVENTS_PAGE_LIMIT + 1);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(cursorWritten()).toEqual({ lastLedger: 800 });
  });

  it("persists the ledger before a full page cut off by the page cap", async () => {
    deployment(0);
    let n = 0;
    server(async () => ({
      events: Array.from({ length: EVENTS_PAGE_LIMIT }, () => payout(700, n++)),
      cursor: cursorAt(700, n),
      latestLedger: 800,
    }));

    await pollEventsFor("dep-1");
    expect(cursorWritten()).toEqual({ lastLedger: 699 });
  });

  it("resumes from the oldest retained ledger when the cursor has fallen out of retention", async () => {
    deployment(4_581_448);
    const spy = server(async (req) => {
      if (req.startLedger === 4_581_449)
        throw new Error("startLedger must be between the oldest ledger");
      return { events: [payout(4_687_411)], cursor: cursorAt(4_687_500), latestLedger: 4_687_500 };
    }, 4_600_000);

    expect(await pollEventsFor("dep-1")).toBe(1);
    expect(spy.mock.calls[1]![0]).toMatchObject({ startLedger: 4_600_000 });
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ startLedger: 4_581_449, oldestLedger: 4_600_000 }),
      expect.stringContaining("past RPC retention"),
    );
    expect(cursorWritten()).toEqual({ lastLedger: 4_687_500 });
  });

  it("treats a start ledger past the tip as caught up, without a warning", async () => {
    deployment(4_688_737);
    const spy = server(
      async () => {
        throw new Error("startLedger must be within the ledger range: 4567778 - 4688737");
      },
      4_567_778,
      4_688_737,
    );

    expect(await pollEventsFor("dep-1")).toBe(0);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(log.warn).not.toHaveBeenCalled();
    expect(db.eventCursor.upsert).not.toHaveBeenCalled();
  });

  it("does not advance the cursor when one of the pipeline's contracts fails to scan", async () => {
    deployment(100_000, [
      { nodeId: "pay", contractAddress: "C456", templateKind: TemplateKind.PAYER },
    ]);
    server(async (req) => {
      if (req.filters[0]!.contractIds[0] === "C456") throw new Error("rpc down");
      return { events: [payout(100_500)], cursor: cursorAt(101_000), latestLedger: 101_000 };
    });

    expect(await pollEventsFor("dep-1")).toBe(1);
    expect(db.eventCursor.upsert).not.toHaveBeenCalled();
  });

  it("moves the cursor only as far as the least-advanced contract", async () => {
    deployment(0, [{ nodeId: "pay", contractAddress: "C456", templateKind: TemplateKind.PAYER }]);
    server(async (req) =>
      req.filters[0]!.contractIds[0] === "C456"
        ? { events: [], cursor: cursorAt(10_000), latestLedger: 90_000 }
        : { events: [], cursor: cursorAt(90_000), latestLedger: 90_000 },
    );

    await pollEventsFor("dep-1");
    // C456's scan stops at the page cap, so the shared cursor can't pass it.
    expect(cursorWritten()!.lastLedger).toBe(10_000);
  });

  it("keeps a contract's completed pages when a later page fails", async () => {
    deployment(100_000, [
      { nodeId: "pay", contractAddress: "C456", templateKind: TemplateKind.PAYER },
    ]);
    server(async (req) => {
      if (req.filters[0]!.contractIds[0] !== "C456") {
        return { events: [], cursor: cursorAt(150_000), latestLedger: 150_000 };
      }
      if (req.cursor) throw new Error("rpc timeout");
      return { events: [], cursor: cursorAt(110_000), latestLedger: 150_000 };
    });

    await pollEventsFor("dep-1");
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ contractAddress: "C456", scannedThrough: 110_000 }),
      "getEvents page failed",
    );
    // Ledgers past C456's last complete page are re-read next poll, so nothing is skipped.
    expect(cursorWritten()).toEqual({ lastLedger: 110_000 });
  });
});
