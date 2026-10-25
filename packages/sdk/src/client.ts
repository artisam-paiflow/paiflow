import { webhookMethods, releaseEarlyMethod } from "./webhook.js";
import { subscriptionMethods } from "./subscription.js";
import { scheduleMethods } from "./schedule.js";
import { fundingMethods } from "./funding.js";
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
  parseDeployments,
  parseActivity,
  parsePublicSchedule,
  parseDemo,
  parseOpenApi,
} from "./read-parsers.js";
import type {
  PublicEmbedActivity,
  ListEventsResponse,
  ListDeploymentsResponse,
} from "./read-parsers.js";
/** ID-ordered discovery within the credential’s explicit eligible deployment scope. */
export interface ListDeploymentsQuery {
  /** Continue from the previous response cursor; omit for the first page. */
  cursor?: string;
  /** Page size 1–100; server default 20. */
  limit?: number;
}
/** Discovery iterator options; each HTTP page has its own timeout. */
export interface DeploymentPagesOptions extends RequestOptions {
  /** Stop after this many pages (1–10000, default 100); a cap is not completeness. */
  maxPages?: number;
}
/** Indexed event filters. Event absence does not establish payment failure. */
export interface ListEventsQuery {
  /** Continue from the previous response cursor; omit for the first page. */
  cursor?: string;
  /** Page size 1–100; server default 20. */
  limit?: number;
  txHash?: string;
}
/** Bounded event iteration; retain the last cursor for explicit continuation. */
export interface EventPagesOptions extends RequestOptions {
  /** Stop after this many pages (1–10000, default 100); a cap is not completeness. */
  maxPages?: number;
}
/** Quote one deployed Swap node; estimates do not guarantee execution or fees. */
export interface SwapQuoteQuery {
  /** Positive integer stroop string, never a floating-point token amount. */
  amountStroops: string;
  nodeId?: string;
}
/** Hosted payment URL hints; helpers perform no HTTP request or eligibility check. */
export interface PaymentUrlOptions {
  /** Decimal token text with at most seven decimals, rather than stroops. */
  amount?: string;
}
/** Public connection or latest-50 snapshot; deduplicate snapshots by eventId. */
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
const deploymentsQuery = (query: ListDeploymentsQuery): Record<string, string> =>
  input(() => ({
    ...(query.cursor === undefined ? {} : { cursor: uuid(query.cursor).toLowerCase() }),
    ...(query.limit === undefined ? {} : { limit: String(integer(query.limit, 1, 100)) }),
  }));
/** Node-only client. Construction never requests a demo token or opens a connection. */
export class Paiflow {
  readonly transport: PaiflowTransport;
  /** Scoped list and bounded pages. Selection changes apply to subsequent requests. */
  readonly deployments;
  constructor(options: PaiflowOptions) {
    this.transport = new PaiflowTransport(options);
    const transport = this.transport;
    const list = (query: ListDeploymentsQuery = {}, options?: RequestOptions) =>
      transport.request(
        {
          path: "/api/v1/deployments",
          method: "GET",
          auth: { kind: "token" },
          query: deploymentsQuery(query),
          parse: parseDeployments,
        },
        options,
      );
    this.deployments = {
      list,
      pages: async function* (
        query: ListDeploymentsQuery = {},
        options: DeploymentPagesOptions = {},
      ): AsyncGenerator<ApiResponse<ListDeploymentsResponse>> {
        const initial = deploymentsQuery(query);
        const cap = input(() => integer(options.maxPages ?? 100, 1, 10000));
        let cursor = initial.cursor;
        const cursors = new Set<string>(cursor === undefined ? [] : [cursor]);
        for (let page = 0; page < cap; page++) {
          if (options.signal?.aborted) throw new PaiflowAbortError();
          const response = await list({ ...query, cursor }, options);
          const next = response.data.nextCursor?.toLowerCase();
          if (next !== undefined && (cursors.has(next) || (cursor !== undefined && next <= cursor)))
            throw new PaiflowMalformedResponseError(response.metadata);
          yield response;
          if (next === undefined) return;
          cursor = next;
          cursors.add(cursor);
        }
      },
    };
  }
  /**
   * Bind workflow methods to an existing deployment; this does not fetch or deploy it.
   * @param deploymentId - Existing deployment UUID explicitly allowed by the credential.
   * @returns A deployment client sharing this transport.
   */
  deployment(deploymentId: string): PaiflowDeployment {
    return new PaiflowDeployment(
      this.transport,
      input(() => uuid(deploymentId)),
    );
  }
  /** Read the public raw API specification without forwarding the token. */
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
/** Existing-deployment workflows. API access never substitutes for wallet consent. */
export class PaiflowDeployment {
  /** Explicit webhook secret; persist keyed event identity and never replace uncertain callbacks. */
  readonly webhook;
  /** Explicit relayer-backed timelock release. Authorise your application user first. */
  readonly releaseEarly;
  /** Subscriber controls and public allowance consent; never charges automatically. */
  readonly subscription;
  /** Controller-signed pause/resume/retrieve and explicit original-intent recovery. */
  readonly schedule;
  /** Schedule/Webhook top-ups, not payouts. Reconcile the original intent after uncertainty. */
  readonly funding;
  /** Token-authenticated prepare and explicit submit; preserve the original envelope. */
  readonly execute;
  /** Anonymous payment helpers; public SUCCESS is global chain status, not an order receipt. */
  readonly publicPayment;
  /** Read supported/conditional operations; capability is not live execution readiness. */
  readonly capabilities;
  /** Live/cached balances with freshness, stale nodes and completeness visible. */
  readonly balances;
  /** Estimate one deployed Swap node, without executing a swap. */
  readonly swap;
  /** Read attributable transaction status; UNKNOWN/REJECTED do not permit replacement. */
  readonly transactions;
  /** Indexed event list or bounded deduplicating pages; events may lag chain finality. */
  readonly events;
  /** Public legacy streamer state, with no bearer token. */
  readonly publicSchedule;
  /** Public activity/snapshot stream; explicit reconnect is required after stream closure. */
  readonly embed;
  /** Hosted URLs only; never include bearer tokens or establish eligibility. */
  readonly urls;
  constructor(
    readonly transport: PaiflowTransport,
    readonly deploymentId: string,
  ) {
    input(() => uuid(deploymentId));
    this.webhook = webhookMethods(transport, deploymentId);
    this.releaseEarly = releaseEarlyMethod(transport, deploymentId);
    this.subscription = subscriptionMethods(transport, deploymentId);
    this.schedule = scheduleMethods(transport, deploymentId);
    this.funding = fundingMethods(transport, deploymentId);
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
