import "server-only";

/**
 * Create a promise-based concurrency limiter. Returned function wraps an async
 * thunk and ensures at most `concurrency` thunks are running at once.
 */
export function createLimiter(concurrency: number) {
  const limit = Math.max(1, concurrency);
  const queue: Array<() => void> = [];
  let active = 0;

  function next() {
    if (active >= limit || queue.length === 0) return;
    const task = queue.shift()!;
    active++;
    task();
  }

  return function runWithLimit<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      queue.push(() => {
        fn()
          .then(resolve, reject)
          .finally(() => {
            active--;
            next();
          });
      });
      next();
    });
  };
}
