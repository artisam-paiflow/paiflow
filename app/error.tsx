"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error(error);
  }, [error]);
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
      <div className="text-brand-300 text-sm tracking-[0.2em] uppercase">Error</div>
      <h1 className="mt-3 text-4xl font-semibold">Something went wrong</h1>
      <p className="mt-3 text-zinc-400">
        {error.digest ? <code className="text-xs">{error.digest}</code> : null}
      </p>
      <button
        onClick={reset}
        className="bg-brand-600 hover:bg-brand-500 mt-8 rounded-md px-4 py-2 font-medium"
      >
        Try again
      </button>
    </main>
  );
}
