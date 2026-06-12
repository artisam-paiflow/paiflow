import "server-only";
import { Prisma } from "@prisma/client";
import { rpc, scValToNative } from "@stellar/stellar-sdk";
import { EventKind, TemplateKind } from "@prisma/client";
import { sorobanRpc } from "./client";
import { db } from "@/lib/db";
import { redis, eventChannel } from "@/lib/redis";
import { log } from "@/lib/log";

// Paranoia buffer: when polling events for the first time we start a few
// ledgers before the deployment transaction to avoid missing events emitted
// at the exact ledger of deployment finalization.
const FIRST_POLL_LEDGER_BUFFER = 200;

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
      const topic1 = topics[1] ?? null;
      // Two shapes are emitted:
      // 1. distribute(): ("distrib", from), (asset, amount) — value is an object.
      // 2. execute_step()/receive_and_forward(): ("distrib", asset), amount — value is a scalar.
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const v = value as { 0?: ScValNative; 1?: ScValNative };
        const from = topic1;
        const asset = v[0] ?? null;
        const amount = v[1] ?? null;
        return from && asset && amount ? { from, asset, amount } : null;
      }
      const asset = topic1;
      const amount = value ?? null;
      return asset && amount !== null ? { asset, amount } : null;
    },
  },
  payout: {
    kind: EventKind.PAYOUT,
    decode: (topics, value) => {
      if (!value || !Array.isArray(value)) return null;
      const from = topics[1] ?? null;
      const recipients = value as ScValNative[];
      return from && recipients ? { from, recipients } : null;
    },
  },
  pay: {
    kind: EventKind.PAYOUT,
    decode: (topics, value) => {
      if (!value || typeof value !== "object") return null;
      const v = value as { 0?: ScValNative; 1?: ScValNative };
      const recipient = topics[1] ?? null;
      const asset = v[0] ?? null;
      const payment = v[1] ?? null;
      return recipient && asset && payment ? { recipient, asset, payment } : null;
    },
  },
};

const STREAMER_REGISTRY: EventRegistry = {
  receive: {
    kind: EventKind.RECEIVE,
    decode: (topics, value) => {
      const asset = topics[1] ?? null;
      const amount = value ?? null;
      return asset && amount !== null ? { asset, amount } : null;
    },
  },
  claim: {
    kind: EventKind.CLAIM,
    decode: (topics, value) => {
      const recipients = topics[1] ?? null;
      const amount = value ?? null;
      return recipients && amount !== null ? { recipients, amount } : null;
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
      const recipients = topics[1] ?? null;
      const amount = value ?? null;
      return recipients && amount !== null ? { recipients, amount } : null;
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

const PAYER_REGISTRY: EventRegistry = {
  pay: {
    kind: EventKind.PAYOUT,
    decode: (topics, value) => {
      if (!value || typeof value !== "object") return null;
      const v = value as { 0?: ScValNative; 1?: ScValNative };
      const recipient = topics[1] ?? null;
      const asset = v[0] ?? null;
      const payment = v[1] ?? null;
      return recipient && asset && payment ? { recipient, asset, payment } : null;
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

const SWAPPER_REGISTRY: EventRegistry = {
  topup: {
    kind: EventKind.RECEIVE,
    decode: (topics, value) => {
      const from = topics[1] ?? null;
      const amount = value ?? null;
      return from && amount !== null ? { from, amount } : null;
    },
  },
  swap: {
    kind: EventKind.PAYOUT,
    decode: (topics, value) => {
      if (!value || !Array.isArray(value)) return null;
      const v = value as ScValNative[];
      const assetIn = topics[1] ?? null;
      const assetOut = topics[2] ?? null;
      const amountIn = v[0] ?? null;
      const amountOut = v[1] ?? null;
      return assetIn && assetOut && amountIn && amountOut
        ? { assetIn, assetOut, amountIn, amountOut }
        : null;
    },
  },
};

const YIELD_REGISTRY: EventRegistry = {
  deposit: {
    kind: EventKind.RECEIVE,
    decode: (topics, value) => {
      const vault = topics[1] ?? null;
      const amount = value ?? null;
      return vault && amount !== null ? { vault, amount } : null;
    },
  },
};

const DEPOSIT_TRIGGER_REGISTRY: EventRegistry = {
  deposit: {
    kind: EventKind.RECEIVE,
    decode: (topics, value) => {
      const from = topics[1] ?? null;
      const amount = value ?? null;
      return from && amount !== null ? { from, amount } : null;
    },
  },
};

const WEBHOOK_REGISTRY: EventRegistry = {
  execute: {
    kind: EventKind.RECEIVE,
    decode: (topics, value) => {
      const from = topics[1] ?? null;
      const amount = value ?? null;
      return from && amount !== null ? { from, amount } : null;
    },
  },
  escrow: {
    kind: EventKind.PAYOUT,
    decode: (topics, value) => {
      const contract = topics[1] ?? null;
      const amount = value ?? null;
      return contract && amount !== null ? { contract, amount } : null;
    },
  },
};

const SUBSCRIPTION_REGISTRY: EventRegistry = {
  charge: {
    kind: EventKind.RECEIVE,
    decode: (topics, value) => {
      const subscriber = topics[1] ?? null;
      const amount = value ?? null;
      return subscriber && amount !== null ? { subscriber, amount } : null;
    },
  },
};

const ORACLE_REGISTRY: EventRegistry = {
  execute: {
    kind: EventKind.RECEIVE,
    decode: (topics, value) => {
      if (!value || !Array.isArray(value)) return null;
      const v = value as ScValNative[];
      const from = topics[1] ?? null;
      const price = v[0] ?? null;
      const amount = v[1] ?? null;
      return from && price && amount ? { from, price, amount } : null;
    },
  },
};

const ROUTER_REGISTRY: EventRegistry = {
  route: {
    kind: EventKind.PAYOUT,
    decode: (topics, value) => {
      const tookPathA = topics[1] ?? null;
      const amountOut = value ?? null;
      return tookPathA && amountOut !== null ? { tookPathA, amountOut } : null;
    },
  },
};

const TIMELOCK_REGISTRY: EventRegistry = {
  receive: {
    kind: EventKind.RECEIVE,
    decode: (topics, value) => {
      const asset = topics[1] ?? null;
      const amount = value ?? null;
      return asset && amount !== null ? { asset, amount } : null;
    },
  },
  release: {
    kind: EventKind.PAYOUT,
    decode: (topics, value) => {
      const admin = topics[1] ?? null;
      const balance = value ?? null;
      return admin && balance !== null ? { admin, balance } : null;
    },
  },
};

const MULTISIG_REGISTRY: EventRegistry = {
  receive: {
    kind: EventKind.RECEIVE,
    decode: (topics, value) => {
      const asset = topics[1] ?? null;
      const amount = value ?? null;
      return asset && amount !== null ? { asset, amount } : null;
    },
  },
  approve: {
    kind: EventKind.STATUS_CHANGE,
    decode: (topics) => {
      const signer = topics[1] ?? null;
      return signer ? { signer } : null;
    },
  },
  release: {
    kind: EventKind.PAYOUT,
    decode: (topics, value) => {
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
    case TemplateKind.PAYER:
      return PAYER_REGISTRY;
    case TemplateKind.SWAPPER:
      return SWAPPER_REGISTRY;
    case TemplateKind.YIELD:
      return YIELD_REGISTRY;
    case TemplateKind.DEPOSIT_TRIGGER:
      return DEPOSIT_TRIGGER_REGISTRY;
    case TemplateKind.WEBHOOK:
      return WEBHOOK_REGISTRY;
    case TemplateKind.SUBSCRIPTION:
      return SUBSCRIPTION_REGISTRY;
    case TemplateKind.ORACLE:
      return ORACLE_REGISTRY;
    case TemplateKind.ROUTER:
      return ROUTER_REGISTRY;
    case TemplateKind.TIMELOCK:
      return TIMELOCK_REGISTRY;
    case TemplateKind.MULTISIG:
      return MULTISIG_REGISTRY;
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
  const generic = genericDecode(topics, value);
  return { kind: fallback, decodedData: generic };
}

function isStellarAddress(value: unknown): value is string {
  if (typeof value !== "string") return false;
  return (value.startsWith("G") || value.startsWith("C")) && value.length === 56;
}

function isAmountLike(value: unknown): boolean {
  if (typeof value === "bigint") return true;
  if (typeof value !== "string") return false;
  return /^\d+$/.test(value) && value.length > 0;
}

function isAssetLike(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return value.length > 0 && value.length <= 12 && !isStellarAddress(value) && !/^\d+$/.test(value);
}

function genericDecode(topics: EventTopics, value: ScValNative | null): DecodedData {
  const result: Record<string, ScValNative> = {};

  const topic1 = topics[1];
  if (topic1 !== undefined && topic1 !== null) {
    if (isStellarAddress(topic1)) {
      result.address = topic1;
    } else if (isAssetLike(topic1)) {
      result.asset = topic1;
    } else {
      result.topic1 = topic1;
    }
  }

  if (value === null || value === undefined) {
    return Object.keys(result).length > 0 ? result : null;
  }

  if (isAmountLike(value)) {
    result.amount = value;
  } else if (Array.isArray(value)) {
    const addresses: string[] = [];
    value.forEach((item, index) => {
      if (isStellarAddress(item)) {
        addresses.push(item);
      } else if (isAmountLike(item)) {
        // If we already have an amount, treat second numeric as price/secondary.
        if (result.amount === undefined) {
          result.amount = item;
        } else if (result.price === undefined) {
          result.price = item;
        } else {
          result[`value${index}`] = item;
        }
      } else if (isAssetLike(item) && result.asset === undefined) {
        result.asset = item;
      } else if (item !== null && item !== undefined) {
        result[`value${index}`] = item;
      }
    });
    if (addresses.length === 1) {
      result.address = addresses[0];
    } else if (addresses.length > 1) {
      result.addresses = addresses;
    }
  } else if (typeof value === "object") {
    // Value emitted as a tuple/object with numeric keys.
    const entries = Object.entries(value);
    for (const [key, val] of entries) {
      if (isStellarAddress(val)) {
        result[key] = val;
      } else if (isAmountLike(val) && result.amount === undefined) {
        result.amount = val;
      } else if (isAssetLike(val) && result.asset === undefined) {
        result.asset = val;
      } else {
        result[key] = val;
      }
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

function classifyEvent(topics: EventTopics): EventKind {
  const first = typeof topics[0] === "string" ? (topics[0] as string).toLowerCase() : "";
  const payoutTopics = new Set([
    "distrib",
    "payout",
    "transfer",
    "pay",
    "swap",
    "route",
    "release",
    "escrow",
  ]);
  const receiveTopics = new Set(["receive", "deposit", "topup", "charge", "execute"]);
  if (payoutTopics.has(first)) return EventKind.PAYOUT;
  if (receiveTopics.has(first)) return EventKind.RECEIVE;
  if (first === "claim") return EventKind.CLAIM;
  return EventKind.STATUS_CHANGE;
}

async function getDeploymentLedger(txHash: string): Promise<number> {
  const server = sorobanRpc();
  const tx = await server.getTransaction(txHash);
  if (tx.status !== "SUCCESS") {
    throw new Error(`Deployment tx ${txHash} failed with status: ${tx.status}`);
  }
  return tx.ledger;
}

/** Recursively convert bigint values to strings so they survive JSON.stringify. */
function convertBigInts<T>(value: T): T {
  if (typeof value === "bigint") return value.toString() as unknown as T;
  if (Array.isArray(value)) return value.map(convertBigInts) as unknown as T;
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, convertBigInts(v)]),
    ) as unknown as T;
  }
  return value;
}

async function pollEventsWithStartLedger(
  deploymentId: string,
  contractAddress: string,
  templateKind: TemplateKind,
  startLedger: number,
): Promise<{ written: number; maxLedger: number }> {
  const server = sorobanRpc();
  let resp: rpc.Api.GetEventsResponse;
  try {
    resp = await server.getEvents({
      startLedger,
      filters: [{ type: "contract" as const, contractIds: [contractAddress] }],
      limit: 100,
    });
  } catch (err) {
    log.warn({ err, deploymentId, startLedger }, "getEvents failed");
    return { written: 0, maxLedger: 0 };
  }

  let written = 0;
  // startLedger - 1 is the correct empty-set sentinel: if no events are found,
  // maxLedger stays below startLedger and the caller's > (startLedger - 1) guard
  // prevents writing a stale cursor. This is load-bearing but safe because
  // Soroban ledgers start well above 0 and the caller validates maxLedger > 0.
  let maxLedger = startLedger - 1;
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
    const safePayload = convertBigInts({ topics, value }) as object;
    const safeDecodedData = convertBigInts(decodedData) as Prisma.InputJsonValue | null;

    try {
      await db.contractEvent.create({
        data: {
          deploymentId,
          eventId: ev.id,
          kind,
          ledger: ev.ledger,
          txHash: ev.txHash,
          payload: safePayload,
          decodedData: (safeDecodedData ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          occurredAt: new Date(ev.ledgerClosedAt),
        },
      });
      written += 1;
      const client = redis();
      if (client) {
        client
          .publish(
            eventChannel(deploymentId),
            JSON.stringify(
              convertBigInts({
                eventId: ev.id,
                kind,
                ledger: ev.ledger,
                txHash: ev.txHash,
                payload: { topics, value },
                decodedData,
                occurredAt: ev.ledgerClosedAt,
              }),
            ),
          )
          .catch((err) => {
            log.warn({ err, deploymentId }, "redis publish failed");
          });
      }
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code !== "P2002") log.warn({ err, deploymentId }, "event upsert failed");
    }
    if (ev.ledger > maxLedger) maxLedger = ev.ledger;
  }
  return { written, maxLedger };
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

  if (deployment.cursor) {
    const startLedger = deployment.cursor.lastLedger + 1;
    const result = await pollEventsWithStartLedger(
      deploymentId,
      deployment.contractAddress,
      templateKind,
      startLedger,
    );
    if (result.maxLedger > startLedger - 1) {
      await db.eventCursor.upsert({
        where: { deploymentId },
        update: { lastLedger: result.maxLedger },
        create: { deploymentId, lastLedger: result.maxLedger },
      });
    }
    return result.written;
  }

  if (deployment.deployTxHash) {
    try {
      const deployLedger = await getDeploymentLedger(deployment.deployTxHash);
      const startLedger = Math.max(deployLedger - FIRST_POLL_LEDGER_BUFFER, 0);
      const result = await pollEventsWithStartLedger(
        deploymentId,
        deployment.contractAddress,
        templateKind,
        startLedger,
      );
      if (result.maxLedger > 0) {
        await db.eventCursor.upsert({
          where: { deploymentId },
          update: { lastLedger: result.maxLedger },
          create: { deploymentId, lastLedger: result.maxLedger },
        });
      }
      return result.written;
    } catch (err) {
      // TODO: add exponential backoff / retry counter so a stuck deploy
      // doesn't hammer the RPC on every cron tick.
      log.warn({ err, deploymentId }, "getDeploymentLedger failed, skipping");
      return 0;
    }
  }

  log.warn({ deploymentId }, "pollEventsFor: no cursor and no deployTxHash, skipping");
  return 0;
}
