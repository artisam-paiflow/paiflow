"use client";

import { useEffect, useRef, useState } from "react";
import type { AuditLogPage } from "@/lib/admin/audit-log/page";

export default function AuditLog({ initial }: { initial: AuditLogPage }) {
  const [page, setPage] = useState(initial);
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [formatter, setFormatter] = useState<Intl.DateTimeFormat | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const request = useRef<AbortController | null>(null);

  useEffect(() => {
    setFormatter(new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" }));
    return () => request.current?.abort();
  }, []);

  async function navigate(older: boolean) {
    if (request.current || (older ? !page.nextCursor : cursors.length === 1)) return;
    const target = older ? [...cursors, page.nextCursor!] : cursors.slice(0, -1);
    const cursor = target.at(-1);
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError(undefined);
    try {
      const query = new URLSearchParams({ limit: "20" });
      if (cursor) query.set("cursor", cursor);
      const response = await fetch(`/api/admin/audit-log?${query}`, { signal: controller.signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? "Could not load audit events.");
      setPage(result.data);
      setCursors(target);
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : "Could not load audit events.");
      }
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  const timezone = formatter?.resolvedOptions().timeZone ?? "UTC";
  return (
    <section
      className="glass-panel mt-lg overflow-hidden rounded-xl"
      aria-labelledby="audit-log-heading"
    >
      <header className="border-outline-variant/15 bg-surface-container/60 px-md flex flex-wrap items-center justify-between gap-2 border-b py-2.5">
        <h2 id="audit-log-heading" className="text-label-sm text-on-surface-variant font-mono">
          / AUDIT EVENTS
        </h2>
        <span className="text-label-sm text-on-surface-variant font-mono">
          {timezone} · {page.items.length} SHOWN
        </span>
      </header>
      <div aria-busy={busy}>
        <ul className="divide-outline-variant/10 divide-y">
          {page.items.map((event) => {
            const localTime = formatter
              ? formatter.format(new Date(event.createdAt))
              : event.createdAt;
            return (
              <li
                key={event.id}
                className="px-md text-body-md grid gap-2 py-2.5 md:grid-cols-[minmax(0,1fr)_minmax(0,0.7fr)_minmax(0,1fr)_minmax(0,1fr)] md:gap-3"
              >
                <span className="text-label-sm text-primary font-mono break-words">
                  {event.action}
                </span>
                <span className="text-on-surface-variant break-words">
                  {event.user?.username ?? "—"}
                </span>
                <span className="text-label-sm text-on-surface-variant truncate font-mono">
                  {event.metadata ? JSON.stringify(event.metadata) : ""}
                </span>
                <time
                  dateTime={event.createdAt}
                  title={`${event.createdAt} (UTC)`}
                  aria-label={`${localTime} (${timezone}); UTC: ${event.createdAt}`}
                  className="text-label-sm text-on-surface-variant font-mono md:text-right"
                >
                  {localTime}
                </time>
              </li>
            );
          })}
          {page.items.length === 0 && (
            <li className="px-md py-md text-label-sm text-on-surface-variant font-mono">
              NO EVENTS YET.
            </li>
          )}
        </ul>
      </div>
      {error && (
        <p role="alert" className="px-md text-error py-2">
          {error}
        </p>
      )}
      <nav
        aria-label="Audit log pagination"
        className="border-outline-variant/15 px-md flex flex-wrap items-center justify-between gap-3 border-t py-3"
      >
        <span role="status" className="text-label-sm text-on-surface-variant font-mono">
          {busy ? "Loading audit events…" : `Page ${cursors.length}`}
        </span>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => void navigate(false)}
            disabled={busy || cursors.length === 1}
            className="border-outline-variant/40 text-on-surface rounded-lg border px-3 py-1.5 disabled:opacity-40"
          >
            Newer
          </button>
          <button
            type="button"
            onClick={() => void navigate(true)}
            disabled={busy || !page.nextCursor}
            className="border-outline-variant/40 text-on-surface rounded-lg border px-3 py-1.5 disabled:opacity-40"
          >
            Older
          </button>
        </div>
      </nav>
    </section>
  );
}
