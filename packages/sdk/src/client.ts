import { paymentMethods } from "./payment.js";
import { PaiflowTransport, PaiflowMalformedResponseError, PaiflowAbortError } from "./transport.js";
import type { ApiResponse, PaiflowOptions, RequestOptions } from "./transport.js";
import {
  uuid,
  hash,
  integer,
  pattern,
  stroops,
  object,
  parseCapabilities,
  parseBalances,
  parseQuote,
  parseTransaction,
  parseEvents,
  parseActivity,
  parsePublicSchedule,
  parseDemo,
  parseOpenApi,
} from "./read-parsers.js";
import type { PublicEmbedActivity, ListEventsResponse } from "./read-parsers.js";
export interface ListEventsQuery {
  cursor?: string;
  limit?: number;
  txHash?: string;
}
export interface EventPagesOptions extends RequestOptions {
  maxPages?: number;
}
export interface SwapQuoteQuery {
  amountStroops: string;
  nodeId?: string;
}
export interface PaymentUrlOptions {
  amount?: string;
}
export type PublicEmbedMessage =
  | { event: "connected" }
  | { event: "snapshot"; snapshot: PublicEmbedActivity };
const input = <T>(parse: () => T): T => {
  try {
    return parse();
  } catch {
    throw new TypeError("Invalid SDK input");
  }
};
const eventsQuery = (query: ListEventsQuery): Record<string, string> =>
  input(() => {
    const result: Record<string, string> = {};
    if (query.cursor !== undefined) result.cursor = pattern(query.cursor, /^[\s\S]{1,512}$/);
    if (query.limit !== undefined) result.limit = String(integer(query.limit, 1, 100));
    if (query.txHash !== undefined)
      result.txHash = hash(pattern(query.txHash, /^[a-f0-9]{64}$/i).toLowerCase());
    return result;
  });
/** Node-only client. Construction never requests a demo token or opens a connection. */
export class Paiflow {
  readonly transport: PaiflowTransport;
  constructor(options: PaiflowOptions) {
    this.transport = new PaiflowTransport(options);
  }
  deployment(deploymentId: string): PaiflowDeployment {
    return new PaiflowDeployment(
      this.transport,
      input(() => uuid(deploymentId)),
    );
  }
  getOpenApi(options?: RequestOptions) {
    return this.transport.request(
      {
        path: "/api/v1/openapi.json",
        method: "GET",
        auth: { kind: "public" },
        raw: true,
        maxResponseBytes: 4194304,
        parse: parseOpenApi,
      },
      options,
    );
  }
  /** Explicit opt-in to anonymous short-lived demo-token creation. Never retried. */
  createDemoToken(options?: RequestOptions) {
    return this.transport.request(
      {
        path: "/api/v1/demo-token",
        method: "POST",
        auth: { kind: "public" },
        maxResponseBytes: 4194304,
        parse: parseDemo,
      },
      options,
    );
  }
}
export class PaiflowDeployment {
  readonly execute;
  readonly publicPayment;
  readonly capabilities;
  readonly balances;
  readonly swap;
  readonly transactions;
  readonly events;
  readonly publicSchedule;
  readonly embed;
  readonly urls;
  constructor(
    readonly transport: PaiflowTransport,
    readonly deploymentId: string,
  ) {
    input(() => uuid(deploymentId));
    const payments = paymentMethods(transport, deploymentId);
    this.execute = payments.execute;
    this.publicPayment = payments.publicPayment;
    const partner = `/api/v1/deployments/${deploymentId}`;
    const publicPath = `/api/deployments/${deploymentId}`;
    const get = <T>(
      path: string,
      parse: (value: unknown) => T,
      auth: "public" | "token",
      options?: RequestOptions,
      query?: Record<string, string>,
    ) =>
      transport.request(
        { path, method: "GET", auth: { kind: auth }, query, maxResponseBytes: 4194304, parse },
        options,
      );
    this.capabilities = {
      get: (options?: RequestOptions) =>
        get(`${partner}/capabilities`, parseCapabilities, "token", options),
    };
    this.balances = {
      get: (options?: RequestOptions) =>
        get(`${partner}/balances`, parseBalances, "token", options),
    };
    this.swap = {
      quote: (query: SwapQuoteQuery, options?: RequestOptions) => {
        const params = input(() => ({
          amountStroops: stroops(query.amountStroops, true),
          ...(query.nodeId === undefined
            ? {}
            : { nodeId: pattern(query.nodeId, /^[\s\S]{1,128}$/) }),
        }));
        return get(`${partner}/swap-quote`, parseQuote, "token", options, params);
      },
    };
    this.transactions = {
      get: (txHash: string, options?: RequestOptions) =>
        get(
          `${partner}/transactions/${input(() => hash(pattern(txHash, /^[a-f0-9]{64}$/i).toLowerCase()))}`,
          parseTransaction,
          "token",
          options,
        ),
    };
    const list = (query: ListEventsQuery = {}, options?: RequestOptions) =>
      get(`${partner}/events`, parseEvents, "token", options, eventsQuery(query));
    this.events = {
      list,
      pages: async function* (
        query: ListEventsQuery = {},
        options: EventPagesOptions = {},
      ): AsyncGenerator<ApiResponse<ListEventsResponse>> {
        eventsQuery(query);
        const cap = input(() => integer(options.maxPages ?? 100, 1, 10000));
        let cursor = query.cursor;
        const cursors = new Set<string>(cursor === undefined ? [] : [cursor]);
        const identities = new Set<string>();
        for (let page = 0; page < cap; page++) {
          if (options.signal?.aborted) throw new PaiflowAbortError();
          const response = await list({ ...query, cursor }, options);
          const data = response.data;
          if (data.hasMore && (data.nextCursor === null || cursors.has(data.nextCursor)))
            throw new PaiflowMalformedResponseError(response.metadata);
          const items = data.items.filter((event) => {
            if (identities.has(event.eventId)) return false;
            identities.add(event.eventId);
            return true;
          });
          yield { ...response, data: { ...data, items } };
          if (!data.hasMore) return;
          cursor = data.nextCursor ?? undefined;
          if (cursor !== undefined) cursors.add(cursor);
        }
      },
    };
    this.publicSchedule = {
      get: (options?: RequestOptions) =>
        get(`${publicPath}/streamer-state`, parsePublicSchedule, "public", options),
    };
    this.embed = {
      activity: (options?: RequestOptions) =>
        get(`${publicPath}/embed/activity`, parseActivity, "public", options),
      stream: (options?: RequestOptions) =>
        transport.stream<PublicEmbedMessage>(
          `${publicPath}/embed/events`,
          (event, value) => {
            try {
              if (event === "connected") {
                object(value);
                return { event: "connected" };
              }
              if (event === "snapshot")
                return { event: "snapshot", snapshot: parseActivity(value) };
              return undefined;
            } catch {
              throw new SyntaxError("Invalid SSE message");
            }
          },
          options,
        ),
    };
    this.urls = {
      payment: (options: PaymentUrlOptions = {}) => {
        const url = new URL(`/trigger/${deploymentId}`, transport.origin);
        if (options.amount !== undefined)
          url.searchParams.set(
            "amount",
            input(() => pattern(options.amount, /^\d+(?:\.\d{1,7})?$/)),
          );
        return url.href;
      },
      allowance: () => new URL(`/allowance/${deploymentId}`, transport.origin).href,
      embed: () => new URL(`/deployments/${deploymentId}/embed`, transport.origin).href,
    };
  }
}
