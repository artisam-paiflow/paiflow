import "server-only";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { redis } from "@/lib/redis";

function serialize(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (typeof val === "bigint") {
      return { __type: "bigint", value: val.toString() };
    }
    return val;
  });
}

function deserialize(value: string): unknown {
  return JSON.parse(value, (_key, val) => {
    if (val && typeof val === "object" && "__type" in val && val.__type === "bigint") {
      return BigInt((val as { value: string }).value);
    }
    return val;
  });
}

export type ContractReadCache = ReturnType<typeof createContractReadCache>;

/**
 * Create a request-scoped cache for immutable Soroban contract reads.
 *
 * - In-memory memoization deduplicates identical reads inside a single cron run.
 * - If Redis is available, values are also cached cross-request with a TTL.
 *
 * ONLY wrap reads of values that have no on-chain setter for the contract
 * variant in question. Mutable values must be read fresh:
 * - `next_charge_at` / token allowances change after every successful charge.
 * - Recipients are mutable on payroll (update_recipients) and splitter_dev.
 * - Relayer is mutable on every contract variant (set_relayer).
 * - Subscriber/amount are mutable on subscription_dev (update_subscriber,
 *   set_amount) — cache them only for the immutable prod SUBSCRIPTION variant.
 *
 * A stale cached value here flows into PayrollPayout rows and the fiat
 * off-ramp jobs derived from them, so caching mutable state can make the DB
 * ledger (and real PHP payouts) diverge from what actually moved on-chain.
 */
export function createContractReadCache(options?: { enabled?: boolean; ttlSeconds?: number }) {
  const e = env();
  const enabled = options?.enabled ?? e.CONTRACT_READ_CACHE_ENABLED;
  const ttlSeconds = options?.ttlSeconds ?? e.CONTRACT_READ_CACHE_TTL_SECONDS;
  const memo = new Map<string, Promise<unknown>>();
  const client = redis();
  const network = e.STELLAR_NETWORK;

  return function cache<TArgs extends unknown[], TReturn>(
    name: string,
    fn: (...args: TArgs) => Promise<TReturn>,
    keyFn?: (...args: TArgs) => string,
  ): (...args: TArgs) => Promise<TReturn> {
    return (...args: TArgs): Promise<TReturn> => {
      if (!enabled) return fn(...args);

      const baseKey = keyFn ? keyFn(...args) : JSON.stringify(args);
      const key = `contract:read:${network}:${name}:${baseKey}`;

      const memoized = memo.get(key);
      if (memoized) return memoized as Promise<TReturn>;

      const promise = (async (): Promise<TReturn> => {
        if (client) {
          try {
            const cached = await client.get(key);
            if (cached) return deserialize(cached) as TReturn;
          } catch (err) {
            log.warn(
              { key, error: err instanceof Error ? err.message : String(err) },
              "Contract read cache Redis get failed",
            );
          }
        }

        const value = await fn(...args);

        if (client) {
          try {
            await client.setex(key, ttlSeconds, serialize(value));
          } catch (err) {
            log.warn(
              { key, error: err instanceof Error ? err.message : String(err) },
              "Contract read cache Redis set failed",
            );
          }
        }

        return value;
      })();

      memo.set(key, promise);
      promise.catch(() => memo.delete(key));

      return promise as Promise<TReturn>;
    };
  };
}
