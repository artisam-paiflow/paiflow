"use client";
import { useEffect, useState } from "react";
import { TemplatePageSchema } from "@/lib/flow-templates/client-schema";
import { buttonClass, managementRequest } from "./api";

export default function TemplatePicker({
  selected,
  onChange,
  disabled,
  error,
  otherCount,
}: {
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled: boolean;
  error?: string;
  otherCount: number;
}) {
  const [items, setItems] = useState<{ id: string; name: string; retiredAt: string | null }[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setFailed(false);
    void managementRequest(
      `/api/flow-templates?limit=20${cursor ? `&cursor=${cursor}` : ""}`,
      TemplatePageSchema,
    )
      .then((page) => {
        if (!current) return;
        setItems((old) =>
          cursor
            ? [...old, ...page.items.filter((i) => !old.some((o) => o.id === i.id))]
            : page.items,
        );
        setNext(page.nextCursor);
      })
      .catch(() => {
        if (current) setFailed(true);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [cursor, attempt]);
  return (
    <fieldset
      disabled={disabled}
      className="border-outline-variant/30 space-y-3 rounded border p-3"
    >
      <legend>Selected private templates ({selected.length})</legend>
      <p className="text-on-surface-variant text-sm">
        Explicitly grant instance lifecycle access to owned active templates. This grants no
        publication, token management or ordinary deployment runtime access. Read and operate still
        requires the developer’s on-chain signature. Up to 100 templates and deployments combined.
      </p>
      {items.map((item) => (
        <label key={item.id} className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={selected.includes(item.id)}
            disabled={
              !selected.includes(item.id) &&
              (!!item.retiredAt || selected.length + otherCount >= 100)
            }
            onChange={(e) =>
              onChange(
                e.target.checked ? [...selected, item.id] : selected.filter((id) => id !== item.id),
              )
            }
          />
          <span>
            {item.name}
            {item.retiredAt ? " · Retired" : ""}
            <span className="block font-mono text-xs break-all">{item.id}</span>
          </span>
        </label>
      ))}
      {loading ? <p role="status">Loading templates…</p> : null}
      {failed ? (
        <p role="alert">
          Could not load templates. Existing selections are preserved.{" "}
          <button type="button" className={buttonClass} onClick={() => setAttempt((n) => n + 1)}>
            Retry templates
          </button>
        </p>
      ) : null}
      {next ? (
        <button
          type="button"
          className={buttonClass}
          disabled={loading}
          onClick={() => setCursor(next)}
        >
          More template selections
        </button>
      ) : null}
      {selected.length ? (
        <details>
          <summary className="min-h-11 cursor-pointer py-2 text-sm">
            Review selected template IDs ({selected.length})
          </summary>
          <ul>
            {selected.map((id) => (
              <li className="flex flex-wrap items-center gap-2 py-1 text-xs" key={id}>
                <span className="break-all">{id}</span>
                <button
                  type="button"
                  className={buttonClass}
                  aria-label={`Remove template ${id}`}
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
