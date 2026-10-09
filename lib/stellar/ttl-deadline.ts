import "server-only";
import { AppError } from "@/lib/errors";

/** Bound RPC waits, never database writes which record a confirmed transaction. */
export function ttlDeadline(budgetMs: number) {
  const endsAt = Date.now() + budgetMs;
  const remaining = () => Math.max(0, endsAt - Date.now());
  const assert = () => {
    if (!remaining()) throw new AppError("UPSTREAM_RPC", "TTL maintenance time budget exhausted");
  };
  return {
    expired: () => !remaining(),
    assert,
    remaining,
    async run<T>(operation: () => Promise<T>): Promise<T> {
      assert();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new AppError("UPSTREAM_RPC", "TTL maintenance time budget exhausted")),
              remaining(),
            );
          }),
          operation(),
        ]);
      } finally {
        clearTimeout(timer);
      }
    },
    /** Only time out acquisition. Once acquired, the callback must finish its own bookkeeping. */
    async acquire<T>(operation: (started: () => void) => Promise<T>): Promise<T> {
      assert();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new AppError("UPSTREAM_RPC", "TTL maintenance channel wait timed out")),
              remaining(),
            );
          }),
          operation(() => {
            assert();
            clearTimeout(timer);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export type TtlDeadline = ReturnType<typeof ttlDeadline>;
