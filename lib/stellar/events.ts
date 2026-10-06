import "server-only";
import { Prisma } from "@prisma/client";
import { TransactionBuilder, Address, StrKey, rpc, scValToNative, xdr } from "@stellar/stellar-sdk";
import { EventKind, TemplateKind } from "@prisma/client";
import { sorobanRpc } from "./client";
import { db } from "@/lib/db";
import { redis, eventChannel } from "@/lib/redis";
import { log } from "@/lib/log";
import { assetContractId } from "@/lib/stellar/assets";
import { assetLabel, FlowGraphSchema, migrateFlowGraph, type FlowGraph } from "@/lib/flows/schema";
import { stellarPassphrase } from "@/lib/env";
import { sendEmailNotificationsForTransactions } from "@/lib/flow-notifications";
import { inboundAssetForContract, type PipelineNodeSnapshot } from "@/lib/flows/event-assets";
import { createCashOutJob } from "@/lib/offramp/jobs";
import { bankDetailsFromGraph, eventCreatesOffRampJob } from "@/lib/offramp/cash-out-bank";

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
  payout: {
    kind: EventKind.PAYOUT,
    decode: (topics, value) => {
      if (!value || !Array.isArray(value)) return null;
      const from = topics[1] ?? null;
      const recipients = value as ScValNative[];
      return from && recipients ? { from, recipients } : null;
    },
  },
  // Legacy splitter contracts emit "distrib" instead of "payout".
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
  shortfall: {
    kind: EventKind.SHORTFALL,
    decode: (topics, value) => {
      if (!value || !Array.isArray(value)) return null;
      const v = value as ScValNative[];
      const asset = topics[1] ?? null;
      const amount = v[0] ?? null;
      const balance = v[1] ?? null;
      const needed = v[2] ?? null;
      const remaining = v[3] ?? null;
      return asset && amount !== null && balance !== null && needed !== null && remaining !== null
        ? { asset, amount, balance, needed, remaining }
        : null;
    },
  },
  forward: {
    kind: EventKind.FORWARD,
    decode: (topics, value) => {
      const asset = topics[1] ?? null;
      const amount = value ?? null;
      if (!asset || amount === null) return null;
      const recipient = topics[2] ?? null;
      return recipient ? { asset, recipient, amount } : { asset, amount };
    },
  },
};

const STREAMER_REGISTRY: EventRegistry = {
  deposit: {
    kind: EventKind.RECEIVE,
    decode: (topics, value) => {
      const from = topics[1] ?? null;
      const amount = value ?? null;
      return from && amount !== null ? { from, amount } : null;
    },
  },
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
  pause: {
    kind: EventKind.PAUSE,
    decode: () => ({}),
  },
  unpause: {
    kind: EventKind.RESUME,
    decode: () => ({}),
  },
  retrieve: {
    kind: EventKind.RETRIEVE,
    decode: (_topics, value) => {
      const amount = value ?? null;
      return amount !== null ? { amount } : null;
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
  forward: {
    kind: EventKind.FORWARD,
    decode: (topics, value) => {
      const asset = topics[1] ?? null;
      const amount = value ?? null;
      if (!asset || amount === null) return null;
      const recipient = topics[2] ?? null;
      return recipient ? { asset, recipient, amount } : { asset, amount };
    },
  },
  payment_updated: {
    kind: EventKind.STATUS_CHANGE,
    decode: (topics, value) => {
      const admin = topics[1] ?? null;
      if (!admin || value === null) return { admin };
      let recipient: ScValNative | undefined;
      let amount: ScValNative | undefined;
      let percentageBps: ScValNative | undefined;
      if (Array.isArray(value)) {
        const v = value as ScValNative[];
        [recipient, amount, percentageBps] = v;
      } else if (typeof value === "object") {
        const v = value as Record<string, ScValNative>;
        recipient = v[0];
        amount = v[1];
        percentageBps = v[2];
      }
      return { admin, recipient, amount, percentageBps };
    },
  },
  set_asset: {
    kind: EventKind.STATUS_CHANGE,
    decode: (topics, value) => {
      const admin = topics[1] ?? null;
      const asset = value ?? null;
      return admin ? { admin, asset } : null;
    },
  },
};

const SWAPPER_REGISTRY: EventRegistry = {
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
  deposit: {
    kind: EventKind.RECEIVE,
    decode: (topics, value) => {
      const from = topics[1] ?? null;
      const amount = value ?? null;
      return from && amount !== null ? { from, amount } : null;
    },
  },
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
  subscribe: {
    kind: EventKind.STATUS_CHANGE,
    decode: (topics) => {
      const subscriber = topics[1] ?? null;
      return subscriber ? { subscriber } : null;
    },
  },
  cancel: {
    kind: EventKind.STATUS_CHANGE,
    decode: (topics) => {
      const subscriber = topics[1] ?? null;
      return subscriber ? { subscriber } : null;
    },
  },
};

const PAYROLL_REGISTRY: EventRegistry = {
  charge: {
    kind: EventKind.RECEIVE,
    decode: (topics, value) => {
      const employer = topics[1] ?? null;
      const amount = value ?? null;
      return employer && amount !== null ? { employer, amount } : null;
    },
  },
  payout: {
    kind: EventKind.PAYOUT,
    decode: (topics, value) => {
      const employer = topics[1] ?? null;
      const recipients = value ?? null;
      return employer && recipients !== null ? { employer, recipients } : null;
    },
  },
  recipient_updated: {
    kind: EventKind.RECIPIENT_UPDATED,
    decode: (topics, value) => {
      const admin = topics[1] ?? null;
      const recipients = value ?? null;
      return admin && recipients !== null ? { admin, recipients } : null;
    },
  },
  cancel: {
    kind: EventKind.STATUS_CHANGE,
    decode: (topics) => {
      const employer = topics[1] ?? null;
      return employer ? { employer } : null;
    },
  },
  subscribe: {
    kind: EventKind.STATUS_CHANGE,
    decode: (topics) => {
      const employer = topics[1] ?? null;
      return employer ? { employer } : null;
    },
  },
  set_relayer: {
    kind: EventKind.STATUS_CHANGE,
    decode: (topics, value) => {
      const admin = topics[1] ?? null;
      const relayer = value ?? null;
      return admin && relayer !== null ? { admin, relayer } : null;
    },
  },
  subscriber_updated: {
    kind: EventKind.STATUS_CHANGE,
    decode: (topics, value) => {
      const admin = topics[1] ?? null;
      const subscriber = value ?? null;
      return admin ? { admin, subscriber } : null;
    },
  },
  amount_updated: {
    kind: EventKind.STATUS_CHANGE,
    decode: (topics, value) => {
      const admin = topics[1] ?? null;
      const amount = value ?? null;
      return admin ? { admin, amount } : null;
    },
  },
  schedule_updated: {
    kind: EventKind.STATUS_CHANGE,
    decode: (topics, value) => {
      const admin = topics[1] ?? null;
      if (!admin || value === null) return null;
      let startTime: ScValNative | undefined;
      let intervalSeconds: ScValNative | undefined;
      let endTime: ScValNative | undefined;
      if (Array.isArray(value)) {
        const v = value as ScValNative[];
        [startTime, intervalSeconds, endTime] = v;
      } else if (typeof value === "object") {
        const v = value as Record<string, ScValNative>;
        startTime = v[0];
        intervalSeconds = v[1];
        endTime = v[2];
      }
      return startTime !== undefined && intervalSeconds !== undefined && endTime !== undefined
        ? { admin, startTime, intervalSeconds, endTime }
        : { admin };
    },
  },
};

const CASH_OUT_DEV_REGISTRY: EventRegistry = {
  cash_out: {
    kind: EventKind.CASH_OUT,
    decode: (topics, value) => {
      const source = topics[1] ?? null;
      const amount = value ?? null;
      return source && amount !== null ? { source, amount } : null;
    },
  },
  bank_updated: {
    kind: EventKind.RECIPIENT_UPDATED,
    decode: (topics) => {
      const admin = topics[1] ?? null;
      return admin ? { admin } : null;
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

const TIMELOCK_BRANCH_REGISTRY: EventRegistry = {
  receive: TIMELOCK_REGISTRY.receive!,
  release: {
    kind: EventKind.PAYOUT,
    // The third topic names the list the release paid: "before" or "after".
    decode: (topics, value) => {
      const admin = topics[1] ?? null;
      const branch = topics[2] ?? null;
      const balance = value ?? null;
      return admin && branch && balance !== null ? { admin, branch, balance } : null;
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
    case TemplateKind.PAYROLL:
      return PAYROLL_REGISTRY;
    case TemplateKind.ORACLE:
      return ORACLE_REGISTRY;
    case TemplateKind.ROUTER:
      return ROUTER_REGISTRY;
    case TemplateKind.TIMELOCK:
      return TIMELOCK_REGISTRY;
    case TemplateKind.TIMELOCK_BRANCH:
      return TIMELOCK_BRANCH_REGISTRY;
    case TemplateKind.MULTISIG:
      return MULTISIG_REGISTRY;
    case TemplateKind.CASH_OUT_DEV:
    case TemplateKind.CASH_OUT:
      return CASH_OUT_DEV_REGISTRY;
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
    "retrieve",
  ]);
  const receiveTopics = new Set(["receive", "deposit", "charge", "execute"]);
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

function transactionFromEnvelope(envelopeXdr: string): { operations: unknown[] } | null {
  let tx;
  try {
    tx = TransactionBuilder.fromXDR(envelopeXdr, stellarPassphrase());
  } catch {
    return null;
  }
  if ((tx as any).innerTransaction) {
    tx = (tx as any).innerTransaction;
  }
  if ("operations" in tx) {
    return tx as { operations: unknown[] };
  }
  return null;
}

export function detectAllowanceFromEnvelope(envelopeXdr: string): {
  tokenContractAddress: string;
  from: string;
  spender: string;
  amount: string;
} | null {
  const tx = transactionFromEnvelope(envelopeXdr);
  if (!tx) return null;

  for (const op of tx.operations) {
    const anyOp = op as any;
    if (anyOp.type !== "invokeHostFunction" || !anyOp.func) continue;

    const hostFn = anyOp.func as xdr.HostFunction;
    if (hostFn.switch().value !== xdr.HostFunctionType.hostFunctionTypeInvokeContract().value)
      continue;

    const invoke = hostFn.invokeContract();
    const functionName = Buffer.from(invoke.functionName() as Uint8Array).toString();
    if (functionName !== "approve") continue;

    const args = invoke.args();
    if (args.length < 4) continue;

    try {
      const fromArg = args[0];
      const spenderArg = args[1];
      const amountArg = args[2];
      if (!fromArg || !spenderArg || !amountArg) continue;
      const from = Address.fromScVal(fromArg).toString();
      const spender = Address.fromScVal(spenderArg).toString();
      const amount = scValToNative(amountArg);
      const tokenContractAddress = StrKey.encodeContract(
        Buffer.from(invoke.contractAddress().contractId() as unknown as Uint8Array),
      );
      return {
        tokenContractAddress,
        from,
        spender,
        amount: amount?.toString() ?? "0",
      };
    } catch {
      continue;
    }
  }

  return null;
}

export async function recordAllowanceEvent(opts: {
  deploymentId: string;
  envelopeXdr: string;
  txHash: string;
  ledger: number;
  occurredAt: Date;
  graph: FlowGraph | null;
}): Promise<void> {
  const allowance = detectAllowanceFromEnvelope(opts.envelopeXdr);
  if (!allowance) return;

  const symbolMap = buildAssetSymbolMap(opts.graph);
  let asset = symbolMap.get(allowance.tokenContractAddress);
  if (!asset) {
    // Fall back to a short display of the token contract address.
    asset = allowance.tokenContractAddress;
  }

  const decodedData = {
    from: allowance.from,
    spender: allowance.spender,
    amount: allowance.amount,
    asset,
  };
  const safeDecodedData = convertBigInts(decodedData) as Prisma.InputJsonValue;
  const safePayload = convertBigInts({
    functionName: "approve",
    tokenContractAddress: allowance.tokenContractAddress,
    from: allowance.from,
    spender: allowance.spender,
    amount: allowance.amount,
  }) as Prisma.InputJsonValue;

  try {
    const created = await db.contractEvent.create({
      data: {
        deploymentId: opts.deploymentId,
        eventId: `${opts.txHash}:allowance`,
        kind: EventKind.ALLOWANCE,
        ledger: opts.ledger,
        txHash: opts.txHash,
        payload: safePayload,
        decodedData: safeDecodedData,
        occurredAt: opts.occurredAt,
      },
    });

    const client = redis();
    if (client) {
      client
        .publish(
          eventChannel(opts.deploymentId),
          JSON.stringify(
            convertBigInts({
              id: created.id,
              eventId: `${opts.txHash}:allowance`,
              kind: EventKind.ALLOWANCE,
              ledger: opts.ledger,
              txHash: opts.txHash,
              payload: {
                functionName: "approve",
                tokenContractAddress: allowance.tokenContractAddress,
                from: allowance.from,
                spender: allowance.spender,
                amount: allowance.amount,
              },
              decodedData,
              occurredAt: opts.occurredAt.toISOString(),
            }),
          ),
        )
        .catch((err) => {
          log.warn(
            { err, deploymentId: opts.deploymentId, txHash: opts.txHash },
            "allowance event redis publish failed",
          );
        });
    }
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code !== "P2002") {
      log.warn(
        { err, deploymentId: opts.deploymentId, txHash: opts.txHash },
        "allowance event insert failed",
      );
    }
  }
}

function extractAssetsFromGraph(
  graph: FlowGraph,
): Array<{ kind: string; symbol?: string; code?: string; issuer?: string }> {
  const assets: Array<{ kind: string; symbol?: string; code?: string; issuer?: string }> = [];
  for (const node of graph.nodes) {
    if (!("config" in node)) continue;
    const config = node.config as Record<string, unknown>;
    if (config.asset) assets.push(config.asset as { kind: string });
    if (config.assetIn) assets.push(config.assetIn as { kind: string });
    if (config.assetOut) assets.push(config.assetOut as { kind: string });
  }
  return assets;
}

function buildAssetSymbolMap(graph: FlowGraph | null): Map<string, string> {
  const map = new Map<string, string>();
  if (!graph) return map;

  for (const asset of extractAssetsFromGraph(graph)) {
    try {
      const id = assetContractId(asset as Parameters<typeof assetContractId>[0]);
      const symbol = assetLabel(asset as Parameters<typeof assetLabel>[0]);
      map.set(id, symbol);
    } catch {
      // Skip assets that cannot be resolved (e.g., unknown symbol on this network).
    }
  }
  return map;
}

function resolveAssetSymbols(
  decodedData: DecodedData,
  symbolMap: Map<string, string>,
): DecodedData {
  if (!decodedData) return null;
  const next: Record<string, ScValNative> = { ...decodedData };
  for (const key of ["asset", "assetIn", "assetOut"]) {
    const value = next[key];
    if (typeof value === "string") {
      const symbol = symbolMap.get(value);
      if (symbol) next[key] = symbol;
    }
  }
  return next;
}

/**
 * Most inbound events carry no asset topic — deposit_trigger, webhook,
 * subscription, payroll, streamer deposit and yield all keep the asset in
 * instance storage and publish only the sender and the amount. Stamp the
 * emitting node's inbound asset so the row is self-describing: the live feed and
 * the partner API both read `decodedData` with no access to the graph.
 */
function stampInboundAsset(params: {
  kind: EventKind;
  decodedData: DecodedData;
  graph: FlowGraph | null;
  pipeline: PipelineNodeSnapshot[] | null;
  contractAddress: string;
}): DecodedData {
  const { kind, decodedData } = params;
  if (kind !== EventKind.RECEIVE || !decodedData) return decodedData;
  if (decodedData.amount === undefined || decodedData.amount === null) return decodedData;
  // Never override an asset a decoder read from a real topic.
  if (decodedData.asset || decodedData.assetIn || decodedData.assetOut) return decodedData;

  const asset = inboundAssetForContract(params);
  return asset ? { ...decodedData, asset: assetLabel(asset) } : decodedData;
}

export const EVENTS_PAGE_LIMIT = 100;
/** RPC permits at most five contract IDs across a getEvents request. */
export const MAX_EVENT_CONTRACTS_PER_REQUEST = 5;
/** Page allowance per requested contract; groups retain the pre-batching total request budget. */
export const MAX_EVENT_PAGES_PER_POLL = 5;

/**
 * The ledger a `getEvents` cursor points into. Its first part is a TOID, whose
 * high 32 bits are the ledger sequence.
 */
function cursorLedger(cursor: string | undefined): number | null {
  const toid = cursor?.split("-")[0];
  if (!toid || !/^\d+$/.test(toid)) return null;
  return Number(BigInt(toid) >> 32n);
}

export type EventScanStatus = "complete" | "partial" | "failed" | "skipped";
export type EventScanReason =
  | "rpc-error"
  | "insert-error"
  | "unexpected-emitter"
  | "page-limit"
  | "missing-cursor"
  | "retention-gap"
  | "deployment-unavailable"
  | "missing-template"
  | "missing-start-ledger"
  | "deployment-ledger-error"
  | "no-contracts";

type ScanResult = {
  written: number;
  /** Every retained event through this ledger has been persisted or deduplicated. */
  scannedThrough: number;
  status: Exclude<EventScanStatus, "skipped">;
  reasons: EventScanReason[];
};

export type EventPollResult = {
  status: EventScanStatus;
  written: number;
  /** Safe shared coverage for this attempt; null when no start ledger was available. */
  scannedThrough: number | null;
  /** Group members share scan coverage/status; written counts are per emitting contract. */
  contracts: Array<ScanResult & { contractAddress: string }>;
  reasons: EventScanReason[];
};

/**
 * Pages forward through a group's events from `startLedger`. An RPC scans a
 * bounded ledger window per call (10,000 on SDF testnet) and answers a window
 * with no events with an empty page and a cursor, so a single call from a stale
 * start ledger never reaches the tip: the cursor has to be followed.
 */
async function pollEventsWithStartLedger(
  deploymentId: string,
  contracts: PipelineNode[],
  writtenByContract: Map<string, number>,
  startLedger: number,
  symbolMap: Map<string, string>,
  graph: FlowGraph | null,
  pipeline: PipelineNodeSnapshot[] | null,
  flowTemplateKind: TemplateKind,
): Promise<ScanResult> {
  const server = sorobanRpc();
  const contractIds = contracts.map((node) => node.contractAddress);
  // Pool the former per-contract allowance: a mixed-emitter ledger must not
  // become unreachable just because its events now share a page stream.
  const maxPages = MAX_EVENT_PAGES_PER_POLL * contracts.length;
  const emitters = new Map(contracts.map((node) => [node.contractAddress, node.templateKind]));
  const filters = [{ type: "contract" as const, contractIds }];
  const reasons: EventScanReason[] = [];
  const failed: ScanResult = {
    written: 0,
    scannedThrough: startLedger - 1,
    status: "failed",
    reasons: ["rpc-error"],
  };

  let resp: rpc.Api.GetEventsResponse;
  try {
    resp = await server.getEvents({ startLedger, filters, limit: EVENTS_PAGE_LIMIT });
  } catch (err) {
    // The RPC refuses a start ledger outside the range it holds, on either side.
    const health = await server.getHealth().then(
      (h) => h,
      () => null,
    );
    // Ahead of the tip: a scan already caught up and no ledger has closed since.
    if (health && startLedger > health.latestLedger) {
      return { written: 0, scannedThrough: startLedger - 1, status: "complete", reasons };
    }
    // Behind retention: those ledgers are gone for good; resume from the oldest one held.
    const oldestLedger = health?.oldestLedger ?? null;
    if (oldestLedger === null || startLedger >= oldestLedger) {
      log.warn({ err, deploymentId, contractIds, startLedger }, "getEvents failed");
      return failed;
    }
    log.warn(
      { err, deploymentId, contractIds, startLedger, oldestLedger },
      "getEvents start ledger is past RPC retention; events before oldestLedger are unrecoverable",
    );
    reasons.push("retention-gap");
    try {
      resp = await server.getEvents({
        startLedger: oldestLedger,
        filters,
        limit: EVENTS_PAGE_LIMIT,
      });
    } catch (retryErr) {
      log.warn(
        { err: retryErr, deploymentId, contractIds, oldestLedger },
        "getEvents failed from the oldest retained ledger",
      );
      return { ...failed, reasons: [...reasons, "rpc-error"] };
    }
  }

  let written = 0;
  let safeThrough = startLedger - 1;
  for (let page = 1; ; page++) {
    const events = resp.events ?? [];
    const ingested = await ingestEventPage(
      deploymentId,
      emitters,
      writtenByContract,
      events,
      symbolMap,
      graph,
      pipeline,
      flowTemplateKind,
    );

    written += ingested.written;
    if (ingested.failure !== null) {
      // A ledger is atomic for coverage even if earlier events in it were stored.
      // Stop here: retrying this ledger deduplicates those rows and recovers the failed one.
      const scannedThrough = Math.max(safeThrough, ingested.failure.ledger - 1);
      return {
        written,
        scannedThrough,
        status: scannedThrough >= startLedger || written > 0 ? "partial" : "failed",
        reasons: [...reasons, ingested.failure.reason],
      };
    }

    const full = events.length >= EVENTS_PAGE_LIMIT;
    const at = cursorLedger(resp.cursor);
    if (!full && (at === null || at >= resp.latestLedger)) {
      return { written, scannedThrough: resp.latestLedger, status: "complete", reasons };
    }
    // A full page may stop mid-ledger, so only the ledger before it is complete.
    // Re-reading that ledger next poll is harmless: eventId is unique.
    const scannedThrough = full ? (at ?? events[events.length - 1]!.ledger) - 1 : at!;
    safeThrough = Math.max(safeThrough, scannedThrough);
    if (page >= maxPages || !resp.cursor) {
      return {
        written,
        scannedThrough: safeThrough,
        status: "partial",
        reasons: [...reasons, !resp.cursor ? "missing-cursor" : "page-limit"],
      };
    }
    try {
      resp = await server.getEvents({ cursor: resp.cursor, filters, limit: EVENTS_PAGE_LIMIT });
    } catch (err) {
      log.warn({ err, deploymentId, contractIds, scannedThrough }, "getEvents page failed");
      // The pages already read are complete; keeping that progress lets a far-behind
      // deployment still catch up (before retention drops its ledgers) on a flaky RPC.
      return {
        written,
        scannedThrough: safeThrough,
        status: "partial",
        reasons: [...reasons, "rpc-error"],
      };
    }
  }
}

async function ingestEventPage(
  deploymentId: string,
  emitters: Map<string, TemplateKind>,
  writtenByContract: Map<string, number>,
  events: rpc.Api.EventResponse[],
  symbolMap: Map<string, string>,
  graph: FlowGraph | null,
  pipeline: PipelineNodeSnapshot[] | null,
  flowTemplateKind: TemplateKind,
): Promise<{
  written: number;
  failure: { ledger: number; reason: "insert-error" | "unexpected-emitter" } | null;
}> {
  let written = 0;
  for (const ev of events) {
    // The SDK parses the RPC's contractId into a Contract object. Never infer
    // the emitter from the filter or the pipeline root: pages mix node kinds.
    const contractAddress = ev.contractId?.contractId();
    const templateKind = contractAddress ? emitters.get(contractAddress) : undefined;
    if (!contractAddress || !templateKind) {
      log.warn({ deploymentId, eventId: ev.id, contractAddress }, "unexpected event emitter");
      return { written, failure: { ledger: ev.ledger, reason: "unexpected-emitter" } };
    }
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
    // One value feeds both the DB write and the Redis publish below, so a live
    // row and the same row after a reload can never disagree on the asset.
    const resolvedData = stampInboundAsset({
      kind,
      decodedData: resolveAssetSymbols(decodedData, symbolMap),
      graph,
      pipeline,
      contractAddress,
    });
    const safePayload = convertBigInts({ topics, value, contractAddress }) as object;
    const safeDecodedData = convertBigInts(resolvedData) as Prisma.InputJsonValue | null;

    let persisted = false;
    try {
      const created = await db.contractEvent.create({
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
      persisted = true;
      written += 1;
      writtenByContract.set(contractAddress, (writtenByContract.get(contractAddress) ?? 0) + 1);
      const client = redis();
      if (client) {
        log.info(
          { deploymentId, eventId: ev.id, kind, redisStatus: client.status },
          "event publisher: attempting redis publish",
        );
        client
          .publish(
            eventChannel(deploymentId),
            JSON.stringify(
              convertBigInts({
                id: created.id,
                eventId: ev.id,
                kind,
                ledger: ev.ledger,
                txHash: ev.txHash,
                payload: { topics, value, contractAddress },
                decodedData: resolvedData,
                occurredAt: ev.ledgerClosedAt,
              }),
            ),
          )
          .then((receivers) => {
            log.info(
              { deploymentId, eventId: ev.id, kind, receivers },
              "event publisher: redis publish succeeded",
            );
          })
          .catch((err) => {
            log.warn({ err, deploymentId, eventId: ev.id }, "redis publish failed");
          });
      } else {
        log.warn({ deploymentId, eventId: ev.id }, "event publisher: no redis client");
      }

      // Fire-and-forget: cash_out events spawn off-ramp jobs so the PDAX leg
      // can run asynchronously. Payroll deployments are excluded: their jobs
      // are created by the payroll cron (with payrollRunId/employeeId) and
      // would otherwise be duplicated by the splitter's cash_out events.
      if (kind === EventKind.CASH_OUT && eventCreatesOffRampJob(flowTemplateKind)) {
        const bank = await findCashOutBank(deploymentId, graph, contractAddress, pipeline ?? []);
        const source = typeof resolvedData?.source === "string" ? resolvedData.source : null;
        const amount =
          typeof resolvedData?.amount === "bigint"
            ? resolvedData.amount.toString()
            : typeof resolvedData?.amount === "string"
              ? resolvedData.amount
              : null;
        if (bank && source && amount) {
          createCashOutJob(db, {
            deploymentId,
            sourceAddress: source,
            amountStroops: amount,
            bankAccountName: bank.accountName,
            bankAccountNumber: bank.accountNumber,
            bankCode: bank.bankCode,
          })
            .then((job) => {
              log.info(
                { deploymentId, eventId: created.id, jobId: job.id },
                "cash_out off-ramp job created",
              );
            })
            .catch(async (err) => {
              const message = err instanceof Error ? err.message : String(err);
              log.warn(
                { err, deploymentId, eventId: created.id },
                "cash_out event job creation failed; writing dead-letter record",
              );
              try {
                await db.cashOutJobFailure.create({
                  data: {
                    deploymentId,
                    contractEventId: created.id,
                    sourceAddress: source,
                    amountStroops: amount,
                    bankAccountName: bank.accountName,
                    bankAccountNumber: bank.accountNumber,
                    bankCode: bank.bankCode,
                    error: message,
                  },
                });
              } catch (deadLetterErr) {
                log.warn(
                  { err: deadLetterErr, deploymentId, eventId: created.id },
                  "cash_out dead-letter insert failed",
                );
              }
            });
        } else {
          log.warn(
            {
              deploymentId,
              eventId: created.id,
              hasBank: !!bank,
              hasSource: !!source,
              hasAmount: !!amount,
            },
            "cash_out event missing bank/source/amount; skipping off-ramp job",
          );
        }
      }
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (!persisted && code === "P2002") continue;
      log.warn({ err, deploymentId, eventId: ev.id }, "event ingestion failed");
      if (!persisted) return { written, failure: { ledger: ev.ledger, reason: "insert-error" } };
    }
  }
  return { written, failure: null };
}

type PipelineNode = {
  nodeId: string;
  contractAddress: string;
  templateKind: TemplateKind;
};

type CashOutBank = {
  accountName: string;
  accountNumber: string;
  bankCode: string;
};

/**
 * Locate the bank details configured for the cash_out node that owns
 * `contractAddress`. We match by address in the pipeline snapshot, then resolve
 * the destination from the saved graph snapshot (explicit cash_out nodes, or
 * the parent pay/split config for generated terminals). Payroll-generated
 * nodes fall back to the Employee table.
 */
async function findCashOutBank(
  deploymentId: string,
  graph: FlowGraph | null,
  contractAddress: string,
  pipeline: PipelineNodeSnapshot[],
): Promise<CashOutBank | null> {
  const snapshot = pipeline.find((p) => p.contractAddress === contractAddress);
  if (graph && snapshot) {
    const bank = bankDetailsFromGraph(graph, snapshot.nodeId);
    if (bank) return bank;
  }

  // Auto-generated CASH_OUT nodes for immutable payroll flows exist in the
  // pipeline snapshot but not in the graph snapshot. Fall back to the Employee
  // table, which is populated at deploy time for those employees.
  const employee = await db.employee.findFirst({
    where: { deploymentId, cashOutContractAddress: contractAddress },
    include: { bankDetail: true },
  });
  if (employee?.bankDetail) {
    return {
      accountName: employee.bankDetail.accountName,
      accountNumber: employee.bankDetail.accountNumber,
      bankCode: employee.bankDetail.bankCode,
    };
  }

  return null;
}

/** Compatible inserted-row count for SSE, transaction ingestion and manual/v1 callers. */
export async function pollEventsFor(deploymentId: string): Promise<number> {
  const result = await pollEventsForWithOutcome(deploymentId);
  if (result.status !== "complete") {
    log.warn({ deploymentId, ...result }, "event poll did not complete coverage");
  }
  return result.written;
}

export async function pollEventsForWithOutcome(deploymentId: string): Promise<EventPollResult> {
  const skipped = (reason: EventScanReason): EventPollResult => ({
    status: "skipped",
    written: 0,
    scannedThrough: null,
    contracts: [],
    reasons: [reason],
  });
  const deployment = await db.deployment.findUnique({
    where: { id: deploymentId },
    include: {
      cursor: true,
      flow: { select: { templateKind: true } },
    },
  });
  if (!deployment?.contractAddress || deployment.status !== "CONFIRMED")
    return skipped("deployment-unavailable");

  const flowTemplateKind = deployment.flow?.templateKind;
  if (!flowTemplateKind) {
    log.warn({ deploymentId }, "pollEventsFor: flow templateKind not found, skipping");
    return skipped("missing-template");
  }

  const graph = FlowGraphSchema.safeParse(migrateFlowGraph(deployment.graphSnapshot)).data ?? null;
  const symbolMap = buildAssetSymbolMap(graph);

  const contracts: PipelineNode[] = [];
  const seen = new Set<string>();

  const pipeline = deployment.pipelineSnapshot as PipelineNode[] | null;
  const rootNode = Array.isArray(pipeline)
    ? pipeline.find((n) => n?.contractAddress === deployment.contractAddress)
    : undefined;

  // The snapshot holds the root contract's own kind. `flowTemplateKind` names
  // the pipeline as a whole (a swap flow is SWAPPER), and that registry has no
  // `deposit` topic, so decoding the trigger with it drops the event through to
  // genericDecode — losing `from` and the asset. Fall back to the flow kind only
  // for deployments that have no snapshot to read.
  contracts.push({
    nodeId: rootNode?.nodeId ?? "trigger",
    contractAddress: deployment.contractAddress,
    templateKind: rootNode?.templateKind ?? flowTemplateKind,
  });
  seen.add(deployment.contractAddress);

  if (Array.isArray(pipeline)) {
    for (const node of pipeline) {
      if (node?.contractAddress && node?.templateKind && !seen.has(node.contractAddress)) {
        contracts.push(node);
        seen.add(node.contractAddress);
      }
    }
  }

  if (contracts.length === 0) {
    log.warn({ deploymentId }, "pollEventsFor: no contracts to poll, skipping");
    return skipped("no-contracts");
  }

  let startLedger: number;
  let emptySetSentinel: number;

  if (deployment.cursor) {
    startLedger = deployment.cursor.lastLedger + 1;
    emptySetSentinel = startLedger - 1;
  } else if (deployment.deployTxHash) {
    try {
      const deployLedger = await getDeploymentLedger(deployment.deployTxHash);
      startLedger = Math.max(deployLedger - FIRST_POLL_LEDGER_BUFFER, 0);
      emptySetSentinel = 0;
    } catch (err) {
      log.warn({ err, deploymentId }, "getDeploymentLedger failed, skipping");
      return { ...skipped("deployment-ledger-error"), status: "failed" };
    }
  } else {
    log.warn({ deploymentId }, "pollEventsFor: no cursor and no deployTxHash, skipping");
    return skipped("missing-start-ledger");
  }

  const scans: EventPollResult["contracts"] = [];
  let totalWritten = 0;
  // The cursor is shared by every contract, so it may only move as far as the
  // least-advanced one; a failed scan holds it where it is.
  let scannedThrough = Number.POSITIVE_INFINITY;

  // Keep groups sequential: the cron already bounds deployment concurrency.
  // All members share coverage because pagination spans every emitter in the group.
  for (let offset = 0; offset < contracts.length; offset += MAX_EVENT_CONTRACTS_PER_REQUEST) {
    const group = contracts.slice(offset, offset + MAX_EVENT_CONTRACTS_PER_REQUEST);
    const writtenByContract = new Map<string, number>();
    const result = await pollEventsWithStartLedger(
      deploymentId,
      group,
      writtenByContract,
      startLedger,
      symbolMap,
      graph,
      (deployment.pipelineSnapshot as PipelineNodeSnapshot[] | null) ?? [],
      flowTemplateKind,
    );
    for (const node of group) {
      scans.push({
        ...result,
        contractAddress: node.contractAddress,
        written: writtenByContract.get(node.contractAddress) ?? 0,
      });
    }
    totalWritten += result.written;
    scannedThrough = Math.min(
      scannedThrough,
      result.status === "failed"
        ? emptySetSentinel
        : Math.max(emptySetSentinel, result.scannedThrough),
    );
  }

  if (scannedThrough > emptySetSentinel) {
    await advanceEventCursor(deploymentId, scannedThrough);
    void sendEmailNotificationsForTransactions({
      deploymentId,
      startLedger,
      throughLedger: scannedThrough,
    }).catch((err) => {
      log.warn({ err, deploymentId }, "email notification dispatch failed");
    });
  }

  const reasons = [...new Set(scans.flatMap((scan) => scan.reasons))];
  const status: EventScanStatus =
    scans.every((scan) => scan.status === "complete") && !reasons.includes("retention-gap")
      ? "complete"
      : scans.every((scan) => scan.status === "failed")
        ? "failed"
        : "partial";
  return { status, written: totalWritten, scannedThrough, contracts: scans, reasons };
}

/**
 * Move the cursor forward, never back. The cron, the v1 events read, tx-status and the SSE
 * handler all poll the same deployment, and a slower poll that read an older cursor would
 * otherwise overwrite a newer one on finishing. Moving back is only wasted RPC (a re-scan's rows
 * hit the `eventId` unique constraint), but it also re-stamps `updatedAt`, which the v1 events
 * read uses as a recent-progress throttle, not proof of complete freshness.
 * An equal ledger still stamps `updatedAt`: the poll did run.
 */
export async function advanceEventCursor(deploymentId: string, lastLedger: number): Promise<void> {
  const notAhead = { deploymentId, lastLedger: { lte: lastLedger } };
  const moved = await db.eventCursor.updateMany({ where: notAhead, data: { lastLedger } });
  if (moved.count > 0) return;
  const created = await db.eventCursor.createMany({
    data: [{ deploymentId, lastLedger }],
    skipDuplicates: true,
  });
  if (created.count > 0) return;
  // Either the row is already ahead of us, or a concurrent first poll created it between the two
  // statements; this second update settles the latter and is a no-op for the former.
  await db.eventCursor.updateMany({ where: notAhead, data: { lastLedger } });
}
