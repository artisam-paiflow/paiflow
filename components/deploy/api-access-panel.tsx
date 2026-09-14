"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { apiError } from "@/lib/friendly-error";
import { toastError } from "@/lib/friendly-toast";
import { CreateApiTokenSchema, type ApiToken, type CreatedApiToken } from "@/lib/api/v1/schema";

const INPUT =
  "border-outline-variant/40 bg-surface-container-lowest text-on-surface focus:border-primary focus:ring-primary rounded border px-3 py-2 font-mono text-[14px] focus:ring-1 focus:outline-none";
const FIELD_LABEL =
  "text-label-sm text-on-surface-variant group-focus-within:text-primary font-mono uppercase transition-colors";

const EXPIRY_OPTIONS = [
  { value: "", label: "Never" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "1 year" },
];

type FieldErrors = Record<string, string[]>;

function tokenState(t: ApiToken): "ACTIVE" | "EXPIRED" | "REVOKED" {
  if (t.revokedAt) return "REVOKED";
  if (t.expiresAt && new Date(t.expiresAt).getTime() <= Date.now()) return "EXPIRED";
  return "ACTIVE";
}

const STATE_TONE = {
  ACTIVE: "border-primary/30 bg-primary/10 text-primary",
  EXPIRED: "border-tertiary/30 bg-tertiary/10 text-tertiary",
  REVOKED: "border-outline-variant/40 text-on-surface-variant",
} as const;

const fmt = (iso: string | null, empty: string) => (iso ? new Date(iso).toLocaleString() : empty);

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }
  toast.success("Copied to clipboard.");
}

export default function ApiAccessPanel({ deploymentId }: { deploymentId: string }) {
  const base = `/api/deployments/${deploymentId}/api-tokens`;
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState("");
  const [expiry, setExpiry] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<CreatedApiToken | null>(null);

  async function refresh() {
    const r = await fetch(base);
    if (!r.ok) {
      toast.error("Failed to load API tokens");
      setLoaded(true);
      return;
    }
    const json = await r.json();
    setTokens(json?.data ?? []);
    setLoaded(true);
  }

  useEffect(() => {
    void refresh();
  }, [deploymentId]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const body = {
      ...(label.trim() ? { label: label.trim() } : {}),
      ...(expiry ? { expiresInDays: Number(expiry) } : {}),
    };
    const parsed = CreateApiTokenSchema.safeParse(body);
    if (!parsed.success) {
      setFieldErrors(parsed.error.flatten().fieldErrors as FieldErrors);
      return;
    }
    setBusy(true);
    setFieldErrors({});
    setFormError(null);
    try {
      const r = await fetch(base, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const json = await r.json().catch(() => ({}));
      if (!r.ok) {
        const fields = (json as { error?: { fields?: FieldErrors } })?.error?.fields;
        if (fields) setFieldErrors(fields);
        else setFormError(apiError(json, "Failed to create token").message);
        return;
      }
      setRevealed(json.data as CreatedApiToken);
      setLabel("");
      setExpiry("");
      toast.success("API token created.");
      await refresh();
    } catch (err) {
      toastError(err, "Failed to create token");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(t: ApiToken) {
    if (!confirm(`Revoke ${t.tokenPrefix}…? Anything using it stops working immediately.`)) return;
    const r = await fetch(`${base}/${t.id}`, { method: "DELETE" });
    if (!r.ok) {
      const json = await r.json().catch(() => ({}));
      toastError(apiError(json, "Failed to revoke token"));
      return;
    }
    if (revealed?.id === t.id) setRevealed(null);
    toast.success("Token revoked.");
    await refresh();
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const curl = revealed
    ? `curl -X POST ${origin}/api/v1/deployments/${deploymentId}/execute \\\n  -H "Authorization: Bearer ${revealed.token}" \\\n  -H "Content-Type: application/json"`
    : "";

  return (
    <section className="glass-panel mt-md p-md rounded-xl" data-testid="api-access-panel">
      <div className="flex items-center justify-between">
        <h2 className="text-headline-sm text-on-surface">API access</h2>
        <span className="text-label-sm text-on-surface-variant font-mono">/ DEPLOYMENT TOKENS</span>
      </div>
      <p className="text-label-md text-on-surface-variant mt-2">
        A token lets a backend call the Paiflow API for this deployment only. Every transaction is
        still signed with the depositor&apos;s own key, so a token cannot move funds by itself.
      </p>

      <form onSubmit={create} className="mt-md gap-md grid md:grid-cols-[1fr_12rem_auto]">
        <label className="group grid gap-1.5">
          <span className={FIELD_LABEL}>Label (optional)</span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. partner backend"
            maxLength={64}
            className={INPUT}
          />
          {fieldErrors.label ? (
            <span className="text-error text-label-sm font-mono">
              {fieldErrors.label.join(" ")}
            </span>
          ) : null}
        </label>
        <label className="group grid gap-1.5">
          <span className={FIELD_LABEL}>Expires</span>
          <select value={expiry} onChange={(e) => setExpiry(e.target.value)} className={INPUT}>
            {EXPIRY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {fieldErrors.expiresInDays ? (
            <span className="text-error text-label-sm font-mono">
              {fieldErrors.expiresInDays.join(" ")}
            </span>
          ) : null}
        </label>
        <div className="flex items-start md:pt-[1.625rem]">
          <button
            type="submit"
            disabled={busy}
            className="bg-primary text-label-md text-on-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 font-mono font-bold transition-all hover:-translate-y-px hover:shadow-[0_0_16px_rgba(255,177,196,0.5)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none"
          >
            <span className="material-symbols-outlined text-[16px]">key</span>
            {busy ? "CREATING…" : "CREATE TOKEN"}
          </button>
        </div>
        {formError ? (
          <div className="text-error text-label-sm font-mono md:col-span-3">{formError}</div>
        ) : null}
      </form>

      {revealed ? (
        <div
          className="border-primary/40 bg-primary/5 mt-md rounded-lg border p-3"
          data-testid="api-token-reveal"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-label-sm text-primary font-mono">
              COPY THIS TOKEN NOW. IT WILL NOT BE SHOWN AGAIN.
            </span>
            <button
              onClick={() => setRevealed(null)}
              className="text-label-sm text-on-surface-variant hover:text-on-surface font-mono"
            >
              DONE
            </button>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <code
              className="text-on-surface bg-surface-container-lowest min-w-0 flex-1 truncate rounded px-2 py-1.5 font-mono text-[13px]"
              data-testid="api-token-plaintext"
            >
              {revealed.token}
            </code>
            <button
              onClick={() => copy(revealed.token)}
              aria-label="Copy token"
              className="text-on-surface-variant hover:text-primary shrink-0 transition-colors"
            >
              <span className="material-symbols-outlined text-[16px]">content_copy</span>
            </button>
          </div>
          <div className="mt-3 flex items-center justify-between gap-2">
            <span className="text-label-sm text-on-surface-variant font-mono">
              PREPARE AN EXECUTION
            </span>
            <button
              onClick={() => copy(curl)}
              aria-label="Copy curl command"
              className="text-on-surface-variant hover:text-primary shrink-0 transition-colors"
            >
              <span className="material-symbols-outlined text-[16px]">content_copy</span>
            </button>
          </div>
          <pre
            className="text-on-surface bg-surface-container-lowest mt-1 overflow-x-auto rounded px-2 py-1.5 font-mono text-[12px]"
            data-testid="api-token-curl"
          >
            {curl}
          </pre>
        </div>
      ) : null}

      <ul className="mt-md space-y-2">
        {loaded && tokens.length === 0 && (
          <li className="border-outline-variant/30 text-label-sm text-on-surface-variant rounded border border-dashed p-3 font-mono">
            NO API TOKENS YET.
          </li>
        )}
        {tokens.map((t) => {
          const state = tokenState(t);
          return (
            <li
              key={t.id}
              className="border-outline-variant/15 bg-surface-container-low/40 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2.5"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <code className="text-on-surface font-mono text-[13px]">{t.tokenPrefix}…</code>
                  {t.label ? (
                    <span className="text-on-surface truncate text-[14px]">{t.label}</span>
                  ) : null}
                  <span
                    className={`text-label-sm rounded border px-1.5 py-0.5 font-mono ${STATE_TONE[state]}`}
                  >
                    {state}
                  </span>
                </div>
                <div className="text-label-sm text-on-surface-variant mt-1 font-mono">
                  CREATED {fmt(t.createdAt, "—")} · LAST USED {fmt(t.lastUsedAt, "NEVER")} ·{" "}
                  {t.revokedAt
                    ? `REVOKED ${fmt(t.revokedAt, "")}`
                    : `EXPIRES ${fmt(t.expiresAt, "NEVER")}`}
                </div>
              </div>
              {state !== "REVOKED" ? (
                <button
                  onClick={() => revoke(t)}
                  className="border-error/40 text-label-sm text-error hover:bg-error-container/30 inline-flex items-center gap-1 rounded border px-2 py-1 font-mono transition-colors"
                >
                  <span className="material-symbols-outlined text-[14px]">block</span>
                  REVOKE
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
