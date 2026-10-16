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
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setLoadError(false);
    const cursor = cursors[page];
    void managementRequest(
      `/api/developer-tokens/deployments?limit=20${cursor ? `&cursor=${cursor}` : ""}`,
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
  }, [page, attempt]);
  return (
    <fieldset
      disabled={disabled}
      className="border-outline-variant/30 space-y-3 rounded border p-3"
      aria-describedby={hintId}
    >
      <legend className="text-on-surface px-1 font-medium">
        Selected deployments ({selected.length}/100)
      </legend>
      <p id={hintId} className="text-on-surface-muted text-sm">
        Select confirmed active deployments you own. New deployments are never added automatically.
      </p>
      <label className="grid gap-1 text-sm">
        Filter this page by flow name or deployment ID
        <input
          className={inputClass}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          type="search"
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
            <p>
              No eligible deployments on this page. Deploy and confirm a flow first; retiring and
              retired deployments cannot be selected.
            </p>
          ) : null}
          {items.length > 0 &&
          !items.some((item) =>
            `${item.flowName} ${item.id}`.toLowerCase().includes(search.toLowerCase()),
          ) ? (
            <p>No matches on this page. Try another page or clear the filter.</p>
          ) : null}
          <div className="space-y-1">
            {items
              .filter((item) =>
                `${item.flowName} ${item.id}`.toLowerCase().includes(search.toLowerCase()),
              )
              .map((item) => (
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
                    <span className="block">{item.flowName}</span>
                    <span className="text-on-surface-muted block font-mono text-xs break-all">
                      {item.id} · {item.network}
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
        <div>
          <p className="text-on-surface-muted text-sm">
            All selected IDs, including other pages. An ID without a loaded label may be
            unavailable; remove it if the server refuses the selection.
          </p>
          <ul className="mt-2 space-y-2">
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
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-error text-sm">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
