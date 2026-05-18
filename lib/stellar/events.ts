import "server-only";
import { Prisma } from "@prisma/client";
import { rpc, scValToNative } from "@stellar/stellar-sdk";
import { EventKind, TemplateKind } from "@prisma/client";
import { sorobanRpc } from "./client";
import { db } from "@/lib/db";
import { redis, eventChannel } from "@/lib/redis";
import { log } from "@/lib/log";

type ScValNative = ReturnType<typeof scValToNative>;

type DecodedData = Record<string, ScValNative> | null;

type DecodedEvent = {
  kind: EventKind;
  decodedData: DecodedData;
};

type EventTopics = (ScValNative | null)[];

type DecodeFn = (topics: EventTopics, value: ScValNative | null) => DecodedData;

type EventEntry = {
  kind: EventKind;
  decode: DecodeFn;
};

type EventRegistry = Record<string, EventEntry>;

const SPLITTER_REGISTRY: EventRegistry = {
  distrib: {
    kind: EventKind.PAYOUT,
    decode: (topics, value) => {
      if (!value || typeof value !== "object") return null;
      const v = value as { 0?: ScValNative; 1?: ScValNative };
      const from = topics[1] ?? null;
      const asset = v[0] ?? null;
      const amount = v[1] ?? null;
      return from && asset && amount ? { from, asset, amount } : null;
    },
  },
  payout: {
    kind: EventKind.PAYOUT,
    decode: (topics, value) => {
      if (!value || !Array.isArray(value)) return null;
      const from = topics[1] ?? null;
      // recipients: Array<{ address: string; bps: number }>
      const recipients = value as ScValNative[];
      return from && recipients ? { from, recipients } : null;
    },
  },
};

const STREAMER_REGISTRY: EventRegistry = {
  claim: {
    kind: EventKind.CLAIM,
    decode: (topics, value) => {
      const recipient = topics[1] ?? null;
      const amount = value ?? null;
      return recipient && amount !== null ? { recipient, amount } : null;
    },
  },
  cancel: {
    kind: EventKind.CANCEL,
    decode: (_topics, value) => {
      const balance = value ?? null;
      return balance !== null ? { balance } : null;
    },
  },
};

const CONDITIONAL_REGISTRY: EventRegistry = {
  release: {
    kind: EventKind.PAYOUT,
    decode: (topics, value) => {
      const recipient = topics[1] ?? null;
      const amount = value ?? null;
      return recipient && amount !== null ? { recipient, amount } : null;
    },
  },
  cancel: {
    kind: EventKind.CANCEL,
    decode: (_topics, value) => {
      const balance = value ?? null;
      return balance !== null ? { balance } : null;
    },
  },
};

function getRegistry(templateKind: TemplateKind): EventRegistry {
  switch (templateKind) {
    case TemplateKind.SPLITTER:
      return SPLITTER_REGISTRY;
    case TemplateKind.STREAMER:
      return STREAMER_REGISTRY;
    case TemplateKind.CONDITIONAL:
      return CONDITIONAL_REGISTRY;
    default:
      return {};
  }
}

function decodeEventByKind(
  topics: EventTopics,
  value: ScValNative | null,
  templateKind: TemplateKind,
): DecodedEvent {
  const first = typeof topics[0] === "string" ? (topics[0] as string).toLowerCase() : "";
  const registry = getRegistry(templateKind);
  const entry = registry[first];

  if (entry) {
    const decodedData = entry.decode(topics, value);
    if (decodedData) {
      return { kind: entry.kind, decodedData };
    }
  }

  const fallback = classifyEvent(topics);
  return { kind: fallback, decodedData: null };
}

function classifyEvent(topics: EventTopics): EventKind {
  const first = typeof topics[0] === "string" ? (topics[0] as string).toLowerCase() : "";
  if (first.includes("distrib") || first.includes("payout") || first.includes("transfer"))
    return EventKind.PAYOUT;
  if (first.includes("receive") || first.includes("deposit")) return EventKind.RECEIVE;
  if (first.includes("claim")) return EventKind.CLAIM;
  return EventKind.STATUS_CHANGE;
}

export async function pollEventsFor(deploymentId: string): Promise<number> {
  const deployment = await db.deployment.findUnique({
    where: { id: deploymentId },
    include: {
      cursor: true,
      flow: { select: { templateKind: true } },
    },
  });
  if (!deployment?.contractAddress || deployment.status !== "CONFIRMED") return 0;

  const templateKind = deployment.flow?.templateKind;
  if (!templateKind) {
    log.warn({ deploymentId }, "pollEventsFor: flow templateKind not found, skipping");
    return 0;
  }

  const server = sorobanRpc();
  const startLedger = (deployment.cursor?.lastLedger ?? 0) + 1;

  let resp: rpc.Api.GetEventsResponse;
  try {
    resp = await server.getEvents({
      startLedger: startLedger > 0 ? startLedger : undefined,
      filters: [{ type: "contract", contractIds: [deployment.contractAddress] }],
      limit: 100,
    });
  } catch (err) {
    log.warn({ err, deploymentId }, "getEvents failed");
    return 0;
  }

  let written = 0;
  let maxLedger = deployment.cursor?.lastLedger ?? 0;
  for (const ev of resp.events ?? []) {
    const topics: EventTopics = (ev.topic ?? []).map((t) => {
      try {
        return scValToNative(t);
      } catch {
        return null;
      }
    });
    const value = (() => {
      try {
        return scValToNative(ev.value);
      } catch {
        return null;
      }
    })();
    const { kind, decodedData } = decodeEventByKind(topics, value, templateKind);
    try {
      await db.contractEvent.create({
        data: {
          deploymentId: deployment.id,
          kind,
          ledger: ev.ledger,
          txHash: ev.txHash,
          payload: { topics, value } as object,
          decodedData: (decodedData ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          occurredAt: new Date(ev.ledgerClosedAt),
        },
      });
      written += 1;
      const client = redis();
      if (client) {
        await client.publish(
          eventChannel(deployment.id),
          JSON.stringify({
            kind,
            ledger: ev.ledger,
            txHash: ev.txHash,
            payload: { topics, value },
            decodedData,
            occurredAt: ev.ledgerClosedAt,
          }),
        );
      }
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code !== "P2002") log.warn({ err, deploymentId }, "event upsert failed");
    }
    if (ev.ledger > maxLedger) maxLedger = ev.ledger;
  }

  if (maxLedger > (deployment.cursor?.lastLedger ?? 0)) {
    await db.eventCursor.upsert({
      where: { deploymentId: deployment.id },
      update: { lastLedger: maxLedger },
      create: { deploymentId: deployment.id, lastLedger: maxLedger },
    });
  }
  return written;
}
