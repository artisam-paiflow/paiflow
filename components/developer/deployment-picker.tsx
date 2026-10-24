"use client";

import { useEffect, useId, useState } from "react";
import {
  DeveloperTokenDeploymentListSchema,
  type DeveloperTokenDeployment,
} from "@/lib/developer-tokens/schema";
import { inputClass } from "@/components/builder/inputs/styles";
import { buttonClass, managementRequest } from "./api";

export default function DeploymentPicker({
  selected,
  onChange,
  disabled,
  error,
}: {
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled: boolean;
  error?: string;
}) {
  const hintId = useId();
  const [items, setItems] = useState<DeveloperTokenDeployment[]>([]);
  const [known, setKnown] = useState<Record<string, DeveloperTokenDeployment>>({});
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [page, setPage] = useState(0);
  const [next, setNext] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (search.trim() === query) return;
    const timer = window.setTimeout(() => {
      setCursors([null]);
      setPage(0);
      setQuery(search.trim());
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search, query]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setLoadError(false);
    const cursor = cursors[page];
    void managementRequest(
      `/api/developer-tokens/deployments?limit=20${cursor ? `&cursor=${cursor}` : ""}${query ? `&search=${encodeURIComponent(query)}` : ""}`,
      DeveloperTokenDeploymentListSchema,
    )
      .then((data) => {
        if (!current) return;
        setItems(data.items);
        setNext(data.nextCursor);
        setKnown((previous) => ({
          ...previous,
          ...Object.fromEntries(data.items.map((item) => [item.id, item])),
        }));
      })
      .catch(() => {
        if (current) setLoadError(true);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [page, attempt, query]);
  return (
    <fieldset
      disabled={disabled}
      className="border-outline-variant/30 space-y-3 rounded border p-3"
      aria-describedby={hintId}
    >
      <legend className="text-on-surface px-1 font-medium">
        Selected deployments ({selected.length}/100)
      </legend>
      <p id={hintId} className="text-on-surface-variant text-sm">
        Select confirmed active deployments you own. New deployments are never added automatically.
      </p>
      <label className="grid gap-1 text-sm">
        Search by flow name or full deployment ID
        <input
          className={inputClass}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          type="search"
          maxLength={100}
        />
      </label>
      {loading ? (
        <p role="status">Loading deployments…</p>
      ) : loadError ? (
        <div role="alert">
          Could not load deployments. Your selections are preserved.{" "}
          <button type="button" className={buttonClass} onClick={() => setAttempt((n) => n + 1)}>
            Retry deployments
          </button>
        </div>
      ) : (
        <>
          {!items.length ? (
            <p className="text-on-surface-variant text-sm">
              {query
                ? "No matching deployments. Try a different name or clear the search."
                : "No eligible deployments. Deploy and confirm a flow first; retiring and retired deployments cannot be selected."}
            </p>
          ) : null}
          <div className="max-h-72 space-y-1 overflow-y-auto overscroll-contain">
            {items.map((item) => (
              <label
                key={item.id}
                className="bg-surface-container-lowest flex min-h-11 items-start gap-3 rounded p-3"
              >
                <input
                  type="checkbox"
                  className="accent-primary mt-1 size-5 shrink-0"
                  checked={selected.includes(item.id)}
                  disabled={!selected.includes(item.id) && selected.length >= 100}
                  onChange={(e) =>
                    onChange(
                      e.target.checked
                        ? [...selected, item.id]
                        : selected.filter((id) => id !== item.id),
                    )
                  }
                />
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{item.flowName}</span>
                    <span className="border-outline-variant/40 rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase">
                      {item.network}
                    </span>
                  </span>
                  <span className="text-on-surface-variant block font-mono text-xs break-all">
                    {item.id}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={buttonClass}
              disabled={!page}
              onClick={() => setPage((n) => n - 1)}
            >
              Previous deployments
            </button>
            <span className="font-mono text-sm">Page {page + 1}</span>
            <button
              type="button"
              className={buttonClass}
              disabled={!next}
              onClick={() => {
                setCursors((previous) => [...previous.slice(0, page + 1), next]);
                setPage((n) => n + 1);
              }}
            >
              Next deployments
            </button>
          </div>
        </>
      )}
      {selected.length ? (
        <details className="border-outline-variant/30 border-t pt-2">
          <summary className="text-primary min-h-11 cursor-pointer py-2 text-sm">
            {selected.length} deployment{selected.length === 1 ? "" : "s"} selected · Review
            selection
          </summary>
          <p className="text-on-surface-variant text-xs">
            Selections across all pages. Unverified IDs are retained; remove unavailable deployments
            before saving.
          </p>
          <ul className="mt-2 max-h-56 space-y-2 overflow-y-auto">
            {selected.map((id) => (
              <li key={id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 font-mono text-xs break-all">
                  {known[id]?.flowName ?? "Not loaded / availability unverified"} · {id}
                </span>
                <button
                  type="button"
                  className={buttonClass}
                  aria-label={`Remove ${id}`}
                  onClick={() => onChange(selected.filter((value) => value !== id))}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {error ? (
        <p role="alert" className="text-error text-sm">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
