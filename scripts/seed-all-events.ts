#!/usr/bin/env tsx
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { config } from "dotenv";
import { PrismaClient, EventKind, TemplateKind, type Prisma } from "@prisma/client";
import { Keypair } from "@stellar/stellar-sdk";

const db = new PrismaClient();

config({ path: resolve(".env.local") });
config({ path: resolve(".env") });

const STROOP = 10_000_000n;

function addr() {
  return Keypair.random().publicKey();
}

function contractAddr() {
  // Contract IDs are also valid StrKey addresses for display purposes.
  return Keypair.random().publicKey();
}

function txHash() {
  return Array.from({ length: 64 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join(
    "",
  );
}

function makeGraph(kind: TemplateKind): Prisma.InputJsonValue {
  const asset = { kind: "native" };
  const triggerId = "trigger";
  const actionId = "action";
  const conditionId = "condition";

  const baseEdge = { id: "e1", source: triggerId, target: actionId };

  switch (kind) {
    case TemplateKind.SPLITTER:
      return {
        nodes: [
          {
            id: triggerId,
            type: "on_receive",
            config: { asset },
          },
          {
            id: actionId,
            type: "split",
            config: {
              asset,
              recipients: [
                { address: addr(), bps: 6000 },
                { address: addr(), bps: 4000 },
              ],
            },
          },
        ],
        edges: [baseEdge],
      };
    case TemplateKind.STREAMER:
      return {
        nodes: [
          {
            id: triggerId,
            type: "on_schedule",
            config: { interval: "day", startsAt: new Date().toISOString() },
          },
          {
            id: actionId,
            type: "split",
            config: {
              asset,
              recipients: [
                { address: addr(), bps: 5000 },
                { address: addr(), bps: 5000 },
              ],
              amountPerIntervalStroops: (1n * STROOP).toString(),
            },
          },
        ],
        edges: [baseEdge],
      };
    case TemplateKind.CONDITIONAL:
      return {
        nodes: [
          { id: triggerId, type: "on_receive", config: { asset } },
          {
            id: conditionId,
            type: "condition",
            config: { kind: "oracle_gte", oracle: addr(), key: "XLM", threshold: "100" },
          },
          {
            id: actionId,
            type: "split",
            config: { asset, recipients: [{ address: addr(), bps: 10_000 }] },
          },
        ],
        edges: [
          { id: "e1", source: triggerId, target: conditionId },
          { id: "e2", source: conditionId, target: actionId },
        ],
      };
    case TemplateKind.TIMELOCK:
      return {
        nodes: [
          { id: triggerId, type: "on_receive", config: { asset } },
          {
            id: conditionId,
            type: "condition",
            config: { kind: "time_after", at: new Date(Date.now() + 86400_000).toISOString() },
          },
          {
            id: actionId,
            type: "split",
            config: { asset, recipients: [{ address: addr(), bps: 10_000 }] },
          },
        ],
        edges: [
          { id: "e1", source: triggerId, target: conditionId },
          { id: "e2", source: conditionId, target: actionId },
        ],
      };
    case TemplateKind.MULTISIG:
      return {
        nodes: [
          { id: triggerId, type: "on_receive", config: { asset } },
          {
            id: conditionId,
            type: "condition",
            config: { kind: "multisig", signers: [addr(), addr()], threshold: 1 },
          },
          {
            id: actionId,
            type: "split",
            config: { asset, recipients: [{ address: addr(), bps: 10_000 }] },
          },
        ],
        edges: [
          { id: "e1", source: triggerId, target: conditionId },
          { id: "e2", source: conditionId, target: actionId },
        ],
      };
    case TemplateKind.SWAPPER:
    case TemplateKind.ROUTER:
      return {
        nodes: [
          { id: triggerId, type: "on_receive", config: { asset } },
          {
            id: actionId,
            type: "swap",
            config: { assetIn: asset, assetOut: { kind: "known", symbol: "USDC" }, rateBps: 9900 },
          },
        ],
        edges: [baseEdge],
      };
    case TemplateKind.PAYER:
    case TemplateKind.DEPOSIT_TRIGGER:
      return {
        nodes: [
          { id: triggerId, type: "on_receive", config: { asset } },
          {
            id: actionId,
            type: "pay",
            config: {
              recipient: addr(),
              asset,
              mode: "fixed",
              amountStroops: (5n * STROOP).toString(),
            },
          },
        ],
        edges: [baseEdge],
      };
    case TemplateKind.YIELD:
      return {
        nodes: [
          { id: triggerId, type: "on_receive", config: { asset } },
          { id: actionId, type: "yield", config: { asset, vault: addr() } },
        ],
        edges: [baseEdge],
      };
    case TemplateKind.WEBHOOK:
      return {
        nodes: [
          { id: triggerId, type: "webhook", config: { asset, relayer: addr() } },
          {
            id: actionId,
            type: "pay",
            config: {
              recipient: addr(),
              asset,
              mode: "fixed",
              amountStroops: (5n * STROOP).toString(),
            },
          },
        ],
        edges: [baseEdge],
      };
    case TemplateKind.SUBSCRIPTION:
      return {
        nodes: [
          {
            id: triggerId,
            type: "subscription",
            config: { asset, subscriber: addr(), amountPerPeriodStroops: (1n * STROOP).toString() },
          },
          {
            id: actionId,
            type: "pay",
            config: {
              recipient: addr(),
              asset,
              mode: "fixed",
              amountStroops: (1n * STROOP).toString(),
            },
          },
        ],
        edges: [baseEdge],
      };
    case TemplateKind.ORACLE:
      return {
        nodes: [
          {
            id: triggerId,
            type: "oracle",
            config: { asset, threshold: "100" },
          },
          {
            id: actionId,
            type: "pay",
            config: {
              recipient: addr(),
              asset,
              mode: "fixed",
              amountStroops: (5n * STROOP).toString(),
            },
          },
        ],
        edges: [baseEdge],
      };
    default:
      throw new Error(`Unhandled template kind: ${kind}`);
  }
}

function makeEvents(kind: TemplateKind, deploymentId: string) {
  const now = Date.now();
  const base = (ledger: number, minutesAgo: number) => ({
    deploymentId,
    eventId: randomUUID(),
    ledger,
    txHash: txHash(),
    payload: { topics: [], value: null },
    occurredAt: new Date(now - 1000 * 60 * minutesAgo),
  });

  switch (kind) {
    case TemplateKind.SPLITTER:
      return [
        {
          ...base(1234567, 30),
          kind: EventKind.RECEIVE,
          decodedData: { from: addr(), asset: "XLM", amount: (10n * STROOP).toString() },
        },
        {
          ...base(1234568, 25),
          kind: EventKind.PAYOUT,
          decodedData: {
            from: addr(),
            recipients: [
              { address: addr(), bps: 6000 },
              { address: addr(), bps: 4000 },
            ],
            amount: (10n * STROOP).toString(),
          },
        },
        {
          ...base(1234569, 20),
          kind: EventKind.PAYOUT,
          decodedData: { asset: "XLM", amount: (7n * STROOP).toString() },
        },
      ];
    case TemplateKind.STREAMER:
      return [
        {
          ...base(1234567, 30),
          kind: EventKind.RECEIVE,
          decodedData: { asset: "XLM", amount: (10n * STROOP).toString() },
        },
        {
          ...base(1234568, 25),
          kind: EventKind.CLAIM,
          decodedData: {
            recipients: [
              { address: addr(), bps: 5000 },
              { address: addr(), bps: 5000 },
            ],
            amount: (8n * STROOP).toString(),
          },
        },
        {
          ...base(1234569, 20),
          kind: EventKind.CANCEL,
          decodedData: { balance: (3n * STROOP).toString() },
        },
      ];
    case TemplateKind.CONDITIONAL:
    case TemplateKind.TIMELOCK:
      return [
        {
          ...base(1234567, 30),
          kind: EventKind.RECEIVE,
          decodedData: { asset: "XLM", amount: (10n * STROOP).toString() },
        },
        {
          ...base(1234568, 25),
          kind: EventKind.PAYOUT,
          decodedData: {
            recipients: [{ address: addr(), bps: 10_000 }],
            amount: (10n * STROOP).toString(),
          },
        },
        {
          ...base(1234569, 20),
          kind: EventKind.CANCEL,
          decodedData: { balance: (2n * STROOP).toString() },
        },
      ];
    case TemplateKind.MULTISIG:
      return [
        {
          ...base(1234567, 30),
          kind: EventKind.RECEIVE,
          decodedData: { asset: "XLM", amount: (10n * STROOP).toString() },
        },
        {
          ...base(1234568, 25),
          kind: EventKind.STATUS_CHANGE,
          decodedData: { signer: addr() },
        },
        {
          ...base(1234569, 20),
          kind: EventKind.PAYOUT,
          decodedData: { balance: (10n * STROOP).toString() },
        },
      ];
    case TemplateKind.PAYER:
      return [
        {
          ...base(1234567, 30),
          kind: EventKind.PAYOUT,
          decodedData: {
            recipient: addr(),
            asset: "XLM",
            payment: (5n * STROOP).toString(),
          },
        },
        {
          ...base(1234568, 25),
          kind: EventKind.CANCEL,
          decodedData: { balance: (2n * STROOP).toString() },
        },
      ];
    case TemplateKind.SWAPPER:
      return [
        {
          ...base(1234567, 30),
          kind: EventKind.RECEIVE,
          decodedData: { from: addr(), amount: (10n * STROOP).toString() },
        },
        {
          ...base(1234568, 25),
          kind: EventKind.PAYOUT,
          decodedData: {
            assetIn: "XLM",
            assetOut: "USDC",
            amountIn: (10n * STROOP).toString(),
            amountOut: (990n * STROOP).toString(),
          },
        },
      ];
    case TemplateKind.YIELD:
      return [
        {
          ...base(1234567, 30),
          kind: EventKind.RECEIVE,
          decodedData: { vault: addr(), amount: (25n * STROOP).toString() },
        },
      ];
    case TemplateKind.DEPOSIT_TRIGGER:
      return [
        {
          ...base(1234567, 30),
          kind: EventKind.RECEIVE,
          decodedData: { from: addr(), amount: (10n * STROOP).toString() },
        },
      ];
    case TemplateKind.WEBHOOK:
      return [
        {
          ...base(1234567, 30),
          kind: EventKind.RECEIVE,
          decodedData: { from: addr(), amount: (10n * STROOP).toString() },
        },
        {
          ...base(1234568, 25),
          kind: EventKind.PAYOUT,
          decodedData: { contract: contractAddr(), amount: (12n * STROOP).toString() },
        },
      ];
    case TemplateKind.SUBSCRIPTION:
      return [
        {
          ...base(1234567, 30),
          kind: EventKind.RECEIVE,
          decodedData: { subscriber: addr(), amount: (1n * STROOP).toString() },
        },
      ];
    case TemplateKind.ORACLE:
      return [
        {
          ...base(1234567, 30),
          kind: EventKind.RECEIVE,
          decodedData: {
            from: addr(),
            price: "12345",
            amount: (10n * STROOP).toString(),
          },
        },
      ];
    case TemplateKind.ROUTER:
      return [
        {
          ...base(1234567, 30),
          kind: EventKind.PAYOUT,
          decodedData: { tookPathA: true, amountOut: (10n * STROOP).toString() },
        },
      ];
    default:
      return [];
  }
}

async function main() {
  const username = process.argv[2] ?? "admin";
  const user = await db.user.findUnique({ where: { username } });
  if (!user) {
    console.error(`User ${username} not found`);
    process.exit(1);
  }

  const kinds = [
    TemplateKind.SPLITTER,
    TemplateKind.STREAMER,
    TemplateKind.CONDITIONAL,
    TemplateKind.PAYER,
    TemplateKind.SWAPPER,
    TemplateKind.YIELD,
    TemplateKind.DEPOSIT_TRIGGER,
    TemplateKind.WEBHOOK,
    TemplateKind.SUBSCRIPTION,
    TemplateKind.ORACLE,
    TemplateKind.ROUTER,
    TemplateKind.TIMELOCK,
    TemplateKind.MULTISIG,
  ];
  let totalFlows = 0;
  let totalEvents = 0;

  for (const kind of kinds) {
    const name = `All-events demo — ${kind}`;
    const existing = await db.flow.findFirst({ where: { ownerId: user.id, name } });
    if (existing) {
      console.log(`Skipping ${kind}: flow already exists`);
      continue;
    }

    const graph = makeGraph(kind);
    const flow = await db.flow.create({
      data: {
        ownerId: user.id,
        name,
        templateKind: kind,
        graph: graph as Prisma.InputJsonValue,
        parameters: {},
      },
    });

    const deployment = await db.deployment.create({
      data: {
        flowId: flow.id,
        ownerId: user.id,
        network: "testnet",
        contractAddress: contractAddr(),
        deployTxHash: txHash(),
        status: "CONFIRMED",
        confirmedAt: new Date(),
        graphSnapshot: graph as Prisma.InputJsonValue,
        paramsSnapshot: {},
        pipelineSnapshot: [
          { nodeId: "action", contractAddress: contractAddr(), templateKind: kind },
        ],
      },
    });

    const events = makeEvents(kind, deployment.id);
    if (events.length > 0) {
      await db.contractEvent.createMany({ data: events });
    }

    totalFlows += 1;
    totalEvents += events.length;
    console.log(`${kind}: flow ${flow.id}, deployment ${deployment.id}, ${events.length} events`);
  }

  console.log(`\nCreated ${totalFlows} flow(s) with ${totalEvents} event(s) for user ${username}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
