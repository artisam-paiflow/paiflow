"use client";
import { useState } from "react";

type Code = {
  id: string;
  label: string;
  createdAt: string;
  expiresAt: string;
  disabledAt: string | null;
};
export default function GoogleSignupCodes({
  initial,
  initialNextCursor,
}: {
  initial: Code[];
  initialNextCursor: string | null;
}) {
  const [rows, setRows] = useState(initial);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [pages, setPages] = useState<(string | undefined)[]>([undefined]);
  const [label, setLabel] = useState("");
  const [days, setDays] = useState(7);
  const [issued, setIssued] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  async function loadPage(cursor?: string) {
    const response = await fetch(
      `/api/admin/google-signup-codes${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
      { cache: "no-store" },
    );
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message ?? "Could not load codes.");
    setRows(result.data);
    setNextCursor(result.nextCursor);
  }
  async function navigate(forward: boolean) {
    if (forward ? !nextCursor : pages.length === 1) return;
    setBusy(true);
    setError(undefined);
    try {
      const target = forward ? [...pages, nextCursor!] : pages.slice(0, -1);
      await loadPage(target[target.length - 1]);
      setPages(target);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load codes.");
    } finally {
      setBusy(false);
    }
  }
  async function request(id?: string) {
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/admin/google-signup-codes${id ? `/${id}` : ""}`, {
        method: id ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: id ? "{}" : JSON.stringify({ label, days }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? "Could not save code.");
      if (id) setRows((old) => old.map((row) => (row.id === id ? result.data : row)));
      else {
        setIssued(result.data.code);
        setLabel("");
        await loadPage();
        setPages([undefined]);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save code.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-6 grid gap-6">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void request();
        }}
        className="glass-panel grid gap-4 rounded-xl p-6"
      >
        <label className="grid gap-2">
          Label (for example, hackathon name)
          <input
            required
            maxLength={80}
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            className="border-outline-variant rounded-lg border bg-transparent p-3"
          />
        </label>
        <label className="grid gap-2">
          Expires after
          <select
            value={days}
            onChange={(event) => setDays(Number(event.target.value))}
            className="bg-surface-container border-outline-variant rounded-lg border p-3"
          >
            {[1, 7, 30].map((day) => (
              <option key={day} value={day}>
                {day} {day === 1 ? "day" : "days"}
              </option>
            ))}
          </select>
        </label>
        <button
          disabled={busy}
          className="bg-primary text-on-primary rounded-lg p-3 disabled:opacity-50"
        >
          Create code
        </button>
      </form>
      {issued ? (
        <div role="status" className="glass-panel grid gap-3 rounded-xl p-6">
          <p>
            Copy this code now and share it with participants. It is shown only once and cannot be
            retrieved after leaving this page.
          </p>
          <code className="break-all select-all">{issued}</code>
          <button onClick={() => setIssued(undefined)}>Dismiss code</button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-error">
          {error}
        </p>
      ) : null}
      <p className="text-on-surface-variant">
        Codes are listed newest first. Disabling a code also blocks unfinished signups.
      </p>
      <ul className="grid gap-3">
        {rows.map((row) => {
          const status = row.disabledAt
            ? "Disabled"
            : new Date(row.expiresAt).getTime() <= Date.now()
              ? "Expired"
              : "Active";
          return (
            <li
              key={row.id}
              className="glass-panel flex flex-wrap items-center justify-between gap-4 rounded-xl p-4"
            >
              <div>
                <p>
                  {row.label} · {status}
                </p>
                <p className="text-on-surface-variant">
                  Expires {new Date(row.expiresAt).toLocaleString()}
                </p>
              </div>
              {status === "Active" ? (
                <button
                  disabled={busy}
                  onClick={() => void request(row.id)}
                  className="border-outline-variant rounded-lg border px-4 py-2 disabled:opacity-50"
                >
                  Disable
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {!rows.length ? <p>No codes created yet.</p> : null}
      <nav aria-label="Signup code pagination" className="flex items-center justify-between gap-4">
        <button
          disabled={busy || pages.length === 1}
          onClick={() => void navigate(false)}
          className="border-outline-variant rounded-lg border px-4 py-2 disabled:opacity-50"
        >
          Previous
        </button>
        <span aria-live="polite">Page {pages.length}</span>
        <button
          disabled={busy || !nextCursor}
          onClick={() => void navigate(true)}
          className="border-outline-variant rounded-lg border px-4 py-2 disabled:opacity-50"
        >
          Next
        </button>
      </nav>
    </div>
  );
}
