// Independent wire contracts derived from lib/api/v1/{schema,swap-quote-schema}.ts
// and the public embed/streamer route returns. Unknown extra fields are ignored.
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
export const object = (value: unknown): Record<string, unknown> => {
  if (!isObject(value)) throw new Error();
  return value;
};
export const text = (value: unknown): string => {
  if (typeof value !== "string") throw new Error();
  return value;
};
export const boolean = (value: unknown): boolean => {
  if (typeof value !== "boolean") throw new Error();
  return value;
};
export const integer = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max)
    throw new Error();
  return value;
};
export const choice = <T extends string>(value: unknown, choices: readonly T[]): T => {
  const found = choices.find((candidate) => candidate === value);
  if (found === undefined) throw new Error();
  return found;
};
export const array = <T>(value: unknown, parse: (value: unknown) => T, max = 10000): T[] => {
  if (!Array.isArray(value) || value.length > max) throw new Error();
  return value.map(parse);
};
export const nullable = <T>(value: unknown, parse: (value: unknown) => T): T | null =>
  value === null ? null : parse(value);
export const pattern = (value: unknown, regex: RegExp): string => {
  const result = text(value);
  if (!regex.test(result)) throw new Error();
  return result;
};
export const uuid = (value: unknown) =>
  pattern(value, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
export const hash = (value: unknown) => pattern(value, /^[0-9a-f]{64}$/);
export const timestamp = (value: unknown) => {
  const result = pattern(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/);
  if (
    !Number.isFinite(Date.parse(result)) ||
    new Date(result).toISOString().slice(0, 19) !== result.slice(0, 19)
  )
    throw new Error();
  return result;
};
export const network = (value: unknown) => choice(value, ["testnet", "mainnet"]);
export const nonempty = (value: unknown) => pattern(value, /[\s\S]/);
export const stroops = (value: unknown, positive = false, bounded = true) => {
  const result = pattern(value, bounded ? /^\d{1,39}$/ : /^\d+$/);
  if ((positive && BigInt(result) === 0n) || (bounded && BigInt(result) > (1n << 127n) - 1n))
    throw new Error();
  return result;
};
// Stellar StrKey base32 version + payload + little-endian CRC16-XModem.
export const address = (value: unknown, prefix: "C" | "G"): string => {
  const result = pattern(value, new RegExp(`^${prefix}[A-Z2-7]{55}$`));
  let bits = 0,
    accumulator = 0;
  const bytes: number[] = [];
  for (const character of result) {
    accumulator = (accumulator << 5) | "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((accumulator >>> bits) & 255);
    }
  }
  if (bytes[0] !== (prefix === "C" ? 16 : 48)) throw new Error();
  let crc = 0;
  for (const byte of bytes.slice(0, 33)) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) crc = ((crc << 1) ^ (crc & 32768 ? 0x1021 : 0)) & 65535;
  }
  if (bytes[33] !== (crc & 255) || bytes[34] !== crc >>> 8) throw new Error();
  return result;
};
const contract = (value: unknown) => address(value, "C");
export const parseAsset = (value: unknown) => {
  const data = object(value);
  const kind = choice(data.kind, ["native", "known", "custom"]);
  if (kind === "native") return { kind };
  if (kind === "known") return { kind, symbol: choice(data.symbol, ["USDC"]) };
  return {
    kind,
    code: pattern(data.code, /^[A-Za-z0-9]{1,12}$/),
    issuer: address(data.issuer, "G"),
  };
};
const parseOperation = (value: unknown) => {
  const data = object(value);
  return {
    status: choice(data.status, ["supported", "conditional", "unsupported"]),
    authentication: choice(data.authentication, [
      "deployment_token",
      "webhook_secret",
      "subscriber_wallet",
    ]),
    requirements: array(data.requirements, text),
    nodeIds: array(data.nodeIds, text),
  };
};
export const parseCapabilities = (value: unknown) => {
  const data = object(value),
    operations = object(data.operations);
  return {
    deploymentId: uuid(data.deploymentId),
    network: network(data.network),
    configurationSource: choice(data.configurationSource, ["deployment_snapshot"]),
    triggerType: choice(data.triggerType, [
      "deposit",
      "webhook",
      "subscription",
      "payroll",
      "schedule",
      "oracle",
      "unknown",
    ]),
    inputAsset: nullable(data.inputAsset, parseAsset),
    operations: {
      execute: parseOperation(operations.execute),
      events: parseOperation(operations.events),
      balances: parseOperation(operations.balances),
      funding: parseOperation(operations.funding),
      transactions: parseOperation(operations.transactions),
      releaseEarly: parseOperation(operations.releaseEarly),
      payouts: parseOperation(operations.payouts),
      webhook: parseOperation(operations.webhook),
      subscriptionAllowance: parseOperation(operations.subscriptionAllowance),
      subscriptionState: parseOperation(operations.subscriptionState),
      subscriptionCancel: parseOperation(operations.subscriptionCancel),
      subscriptionReactivate: parseOperation(operations.subscriptionReactivate),
      swapQuote: parseOperation(operations.swapQuote),
      scheduleState: parseOperation(operations.scheduleState),
      scheduleControls: parseOperation(operations.scheduleControls),
    },
  };
};
export const parseBalances = (value: unknown) => {
  const data = object(value),
    freshness = object(data.freshness);
  return {
    deploymentId: uuid(data.deploymentId),
    network: network(data.network),
    totals: array(data.totals, (value) => {
      const item = object(value);
      return {
        tokenContract: contract(item.tokenContract),
        balanceStroops: stroops(item.balanceStroops, false, false),
      };
    }),
    nodes: array(data.nodes, (value) => {
      const item = object(value);
      return {
        nodeId: nonempty(item.nodeId),
        templateKind: nonempty(item.templateKind),
        contractAddress: contract(item.contractAddress),
        tokenContract: nullable(item.tokenContract, contract),
        balanceStroops: nullable(item.balanceStroops, stroops),
        readAt: nullable(item.readAt, timestamp),
        stale: boolean(item.stale),
        ...(item.error === undefined ? {} : { error: text(item.error) }),
      };
    }),
    freshness: {
      status: choice(freshness.status, ["fresh", "partial", "stale"]),
      totalsComplete: boolean(freshness.totalsComplete),
      attemptedAt: timestamp(freshness.attemptedAt),
      cached: boolean(freshness.cached),
    },
  };
};
export const parseQuote = (value: unknown) => {
  const data = object(value);
  if (data.estimate !== true) throw new Error();
  return {
    deploymentId: uuid(data.deploymentId),
    network: network(data.network),
    nodeId: nonempty(data.nodeId),
    contractAddress: contract(data.contractAddress),
    assetInContractAddress: contract(data.assetInContractAddress),
    assetOutContractAddress: contract(data.assetOutContractAddress),
    routerAddress: contract(data.routerAddress),
    pairAddress: contract(data.pairAddress),
    amountInStroops: stroops(data.amountInStroops, true),
    amountOutStroops: stroops(data.amountOutStroops, true),
    amountOutMinStroops: stroops(data.amountOutMinStroops),
    slippageBps: integer(data.slippageBps, 0, 10000),
    readStartedAt: timestamp(data.readStartedAt),
    quotedAt: timestamp(data.quotedAt),
    freshness: choice(data.freshness, ["live"]),
    estimate: true as const,
    scope: choice(data.scope, ["selected_node"]),
    meetsMinimumAtQuote: boolean(data.meetsMinimumAtQuote),
  };
};
export const parseTransaction = (value: unknown) => {
  const data = object(value);
  const parseError = (value: unknown) => {
    const error = object(value);
    return { code: text(error.code), message: text(error.message) };
  };
  return {
    txHash: hash(data.txHash),
    network: network(data.network),
    status: choice(data.status, ["SUCCESS", "FAILED", "PENDING", "UNKNOWN", "REJECTED"]),
    ...(data.ledger === undefined ? {} : { ledger: integer(data.ledger, 1) }),
    ...(data.error === undefined ? {} : { error: parseError(data.error) }),
  };
};
export const parseEvent = (value: unknown) => {
  const data = object(value);
  if (!("data" in data)) throw new Error();
  return {
    id: uuid(data.id),
    eventId: text(data.eventId),
    kind: text(data.kind),
    topic: nullable(data.topic, text),
    ledger: integer(data.ledger),
    txHash: text(data.txHash),
    occurredAt: text(data.occurredAt),
    data: data.data,
  };
};
export const parseEvents = (value: unknown) => {
  const data = object(value);
  return {
    items: array(data.items, parseEvent, 100),
    nextCursor: nullable(data.nextCursor, (value) => pattern(value, /^[\s\S]{1,512}$/)),
    hasMore: boolean(data.hasMore),
  };
};
export const parsePublicEvent = (value: unknown) => {
  const data = object(value);
  return {
    eventId: text(data.eventId),
    kind: text(data.kind),
    ledger: integer(data.ledger),
    txHash: text(data.txHash),
    occurredAt: timestamp(data.occurredAt),
    ...(data.amountStroops === undefined
      ? {}
      : { amountStroops: pattern(data.amountStroops, /^\d{1,39}$/) }),
  };
};
export const parseActivity = (value: unknown) => {
  const data = object(value);
  const events = array(data.events, parsePublicEvent, 50);
  const identities = new Set<string>();
  return {
    events: events.filter((event) => {
      if (identities.has(event.eventId)) return false;
      identities.add(event.eventId);
      return true;
    }),
  };
};
export const parsePublicSchedule = (value: unknown) => {
  const data = object(value);
  return {
    paused: boolean(data.paused),
    available: stroops(data.available),
    retrieveAllowed: boolean(data.retrieveAllowed),
  };
};
export const parseDemo = (value: unknown) => {
  const data = object(value);
  return {
    deploymentId: uuid(data.deploymentId),
    token: pattern(data.token, /^pfk_[0-9a-f]{64}$/),
    expiresAt: timestamp(data.expiresAt),
  };
};
export const parseOpenApi = (value: unknown) => {
  const data = object(value),
    info = object(data.info);
  return {
    ...data,
    openapi: pattern(data.openapi, /^3\.\d+\.\d+$/),
    info: { ...info, title: text(info.title), version: text(info.version) },
    paths: object(data.paths),
  };
};
export type DeploymentCapabilities = ReturnType<typeof parseCapabilities>;
export type DeploymentBalances = ReturnType<typeof parseBalances>;
export type SwapQuote = ReturnType<typeof parseQuote>;
export type TransactionStatus = ReturnType<typeof parseTransaction>;
export type ContractEventItem = ReturnType<typeof parseEvent>;
export type ListEventsResponse = ReturnType<typeof parseEvents>;
export type PublicEmbedEvent = ReturnType<typeof parsePublicEvent>;
export type PublicEmbedActivity = ReturnType<typeof parseActivity>;
export type PublicScheduleState = ReturnType<typeof parsePublicSchedule>;
export type DemoToken = ReturnType<typeof parseDemo>;
export type OpenApiDocument = ReturnType<typeof parseOpenApi>;
