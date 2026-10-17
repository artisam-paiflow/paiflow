"use client";

import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { apiError } from "@/lib/friendly-error";
import { toastError } from "@/lib/friendly-toast";
import { track } from "@/lib/analytics/client";
import {
  CreateApiTokenSchema,
  type ApiToken,
  type CreatedApiToken,
  type DeploymentCapabilities,
} from "@/lib/api/v1/schema";
import ApiOperationGuide from "./api-operation-guide";

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

// The spec is served from this app; the guide and the collection are on the
// public docs and the public mirror, so the links work from any host.
const API_DOCS = [
  { label: "Developer guide", href: "https://paiflow.gitbook.io/paiflow-docs/reference/api" },
  { label: "OpenAPI spec", href: "/api/v1/openapi.json" },
  {
    label: "Postman collection",
    href: "https://github.com/artisam-paiflow/paiflow/blob/develop/docs/api/paiflow-api-v1.postman_collection.json",
  },
] as const;

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
    let ok = false;
    try {
      ta.select();
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    } finally {
      document.body.removeChild(ta);
    }
    if (!ok) {
      toast.error("Couldn't copy. Select the text and copy it manually.");
      return;
    }
  }
  toast.success("Copied to clipboard.");
}

export default function ApiAccessPanel({
  deploymentId,
  capabilities,
  webhookSecret,
}: {
  deploymentId: string;
  capabilities: DeploymentCapabilities | null;
  webhookSecret: string | null;
}) {
  const panelId = useId();
  const [tab, setTab] = useState<"Quickstart" | "Credentials" | "Reference">("Quickstart");
  const [creating, setCreating] = useState(false);
  const base = `/api/deployments/${deploymentId}/api-tokens`;
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState("");
  const [expiry, setExpiry] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const revealGeneration = useRef(0);
  const [revealed, setRevealed] = useState<CreatedApiToken | null>(null);
  const [origin, setOrigin] = useState("");

  useEffect(() => setOrigin(window.location.origin), []);

  useEffect(() => {
    const clear = () => {
      revealGeneration.current += 1;
      setRevealed(null);
    };
    const onVisibility = () => {
      if (document.hidden) clear();
    };
    window.addEventListener("pagehide", clear);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", clear);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  function selectTab(next: typeof tab) {
    if (next !== tab) {
      revealGeneration.current += 1;
      setRevealed(null);
    }
    setTab(next);
    document.getElementById(`${panelId}-${next}-tab`)?.focus();
  }

  async function refresh() {
    try {
      const r = await fetch(base);
      if (!r.ok) {
        toast.error("Failed to load API tokens");
        return;
      }
      const json = await r.json();
      setTokens(json?.data ?? []);
    } catch (err) {
      toastError(err, "Failed to load API tokens");
    } finally {
      setLoaded(true);
    }
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
    const generation = revealGeneration.current;
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
      track("off_script_feature_used", { feature: "api_token_created" });
      if (generation === revealGeneration.current) {
        setRevealed(json.data as CreatedApiToken);
        toast.success("API token created.");
      } else
        toast.info(
          "Token created without revealing its secret. Revoke it and create a replacement.",
        );
      setCreating(false);
      setLabel("");
      setExpiry("");
      await refresh();
    } catch (err) {
      toastError(err, "Failed to create token");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(t: ApiToken) {
    if (
      !confirm(
        `Revoke ${t.tokenPrefix}…? Subsequent requests using it will be denied. Already submitted transactions continue.`,
      )
    )
      return;
    try {
      const r = await fetch(`${base}/${t.id}`, { method: "DELETE" });
      if (!r.ok) {
        const json = await r.json().catch(() => ({}));
        toastError(apiError(json, "Failed to revoke token"));
        return;
      }
      if (revealed?.id === t.id) setRevealed(null);
      toast.success("Token revoked.");
      await refresh();
    } catch (err) {
      toastError(err, "Failed to revoke token");
    }
  }

  function tokenRows(items: ApiToken[]) {
    return (
      <>
        {items.map((t) => {
          const state = tokenState(t);
          return (
            <li
              key={t.id}
              className="border-outline-variant/15 bg-surface-container-low/40 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2.5"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
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
                  Created {fmt(t.createdAt, "—")} · Last used {fmt(t.lastUsedAt, "NEVER")} ·{" "}
                  {t.revokedAt
                    ? `Revoked ${fmt(t.revokedAt, "")}`
                    : `Expires ${fmt(t.expiresAt, "NEVER")}`}
                </div>
              </div>
              {state !== "REVOKED" ? (
                <button
                  onClick={() => revoke(t)}
                  className="border-error/40 text-label-sm text-error hover:bg-error-container/30 inline-flex items-center gap-1 rounded border px-2 py-1 font-mono transition-colors"
                >
                  <span aria-hidden="true" className="material-symbols-outlined text-[14px]">
                    block
                  </span>
                  Revoke
                </button>
              ) : null}
            </li>
          );
        })}
      </>
    );
  }

  return (
    <section className="glass-panel mt-md p-md rounded-xl" data-testid="api-access-panel">
      <h2 className="text-headline-sm text-on-surface">API access</h2>
      <p className="text-body-md text-on-surface-variant mt-2">
        Connect your backend to this deployment.
      </p>
      <div
        role="tablist"
        aria-label="API access"
        className="border-outline-variant/30 mt-5 flex border-b"
      >
        {(["Quickstart", "Credentials", "Reference"] as const).map((name, index, tabs) => (
          <button
            key={name}
            type="button"
            role="tab"
            id={`${panelId}-${name}-tab`}
            aria-controls={tab === name ? `${panelId}-${name}-panel` : undefined}
            aria-selected={tab === name}
            tabIndex={tab === name ? 0 : -1}
            onClick={() => {
              selectTab(name);
            }}
            onKeyDown={(event) => {
              let next = index;
              if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
              else if (event.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
              else if (event.key === "Home") next = 0;
              else if (event.key === "End") next = tabs.length - 1;
              else return;
              event.preventDefault();
              const selected = tabs[next]!;
              selectTab(selected);
            }}
            className={`focus-visible:outline-primary min-h-11 border-b-2 px-4 py-3 text-sm transition-colors focus-visible:outline-2 ${tab === name ? "border-primary text-primary" : "text-on-surface-variant hover:text-on-surface border-transparent"}`}
          >
            {name}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${panelId}-${tab}-panel`}
        aria-labelledby={`${panelId}-${tab}-tab`}
        tabIndex={0}
        className="pt-5"
      >
        {tab === "Quickstart" && (
          <>
            <dl className="border-outline-variant/30 grid gap-4 rounded-lg border p-4 sm:grid-cols-2">
              {(
                [
                  ["Deployment ID", deploymentId],
                  ["API base URL", `${origin}/api/v1/deployments/${deploymentId}`],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="min-w-0">
                  <dt className="text-label-sm text-on-surface-variant">{label}</dt>
                  <dd className="mt-1 flex items-start gap-3">
                    <code className="text-on-surface min-w-0 flex-1 text-sm break-all">
                      {value}
                    </code>
                    <button
                      type="button"
                      aria-label={`Copy ${label}`}
                      onClick={() => void copy(value)}
                      className="text-primary shrink-0 text-sm"
                    >
                      Copy
                    </button>
                  </dd>
                </div>
              ))}
            </dl>
            <h3 className="text-on-surface mt-5 font-semibold">1. Set up a credential</h3>
            <p className="text-on-surface-variant mt-1 text-sm">
              Use an existing credential with access to this deployment, or create one.
            </p>
            <button
              type="button"
              onClick={() => selectTab("Credentials")}
              className="text-primary mt-2 text-sm underline"
            >
              Manage credentials
            </button>
            <h3 className="text-on-surface mt-5 font-semibold">2. Make your first request</h3>
          </>
        )}
        {tab !== "Credentials" && (
          <ApiOperationGuide
            key={tab}
            deploymentId={deploymentId}
            capabilities={capabilities}
            webhookSecret={null}
            origin={origin}
            copy={copy}
            view={tab === "Quickstart" ? "quickstart" : "reference"}
          />
        )}
        {tab !== "Credentials" && (
          <p className="text-label-md text-on-surface-variant mt-5" data-testid="api-docs-links">
            {API_DOCS.filter((_, index) => tab === "Reference" || index === 0).map((doc) => (
              <a
                key={doc.href}
                href={doc.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary mr-4 inline-block py-1 hover:underline"
              >
                {doc.label}
              </a>
            ))}
          </p>
        )}
        {tab === "Credentials" && (
          <>
            <div className="border-outline-variant/30 mb-5 rounded-lg border p-4">
              <h3 className="text-on-surface font-semibold">Developer credentials</h3>
              <p className="text-on-surface-variant mt-1 text-sm">
                Use one credential across selected deployments, with read-only or read-and-operate
                access.
              </p>
              <a
                href="/account/developer"
                className="text-primary mt-2 inline-block text-sm underline"
              >
                Manage developer credentials
              </a>
            </div>
            <div>
              <h3 className="text-label-md text-on-surface font-semibold">Deployment API tokens</h3>
              <p className="text-label-sm text-on-surface-variant mt-1">
                Send a token as Authorization: Bearer pfk_… to access this deployment’s API
                operations. Deposits still require the paying wallet’s signature. Where supported,
                early release authorizes the relayer to release held funds. These tokens do not
                replace webhook secrets or subscriber wallet consent.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setCreating(!creating)}
              aria-expanded={creating}
              className="border-primary/40 text-primary mt-4 rounded-lg border px-4 py-2 text-sm"
            >
              {creating ? "Cancel" : "Create deployment token"}
            </button>
            {creating && (
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
                  <select
                    value={expiry}
                    onChange={(e) => setExpiry(e.target.value)}
                    className={INPUT}
                  >
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
                    className="bg-primary text-label-md text-on-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 font-mono font-bold transition-all hover:shadow-[0_0_16px_rgba(255,177,196,0.5)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none motion-safe:hover:-translate-y-px motion-safe:active:scale-95"
                  >
                    <span aria-hidden="true" className="material-symbols-outlined text-[16px]">
                      key
                    </span>
                    {busy ? "Creating…" : "Create token"}
                  </button>
                </div>
                {formError ? (
                  <div className="text-error text-label-sm font-mono md:col-span-3">
                    {formError}
                  </div>
                ) : null}
              </form>
            )}

            {revealed ? (
              // ph-no-capture: posthog-js skips the element and its children entirely.
              // The plaintext token is a live credential.
              <div
                className="ph-no-capture border-primary/40 bg-primary/5 mt-md rounded-lg border p-3"
                data-testid="api-token-reveal"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-label-sm text-primary font-mono">
                    Copy this token now. It will not be shown again.
                  </span>
                  <button
                    onClick={() => setRevealed(null)}
                    className="text-label-sm text-on-surface-variant hover:text-on-surface font-mono"
                  >
                    Done
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
                    <span aria-hidden="true" className="material-symbols-outlined text-[16px]">
                      content_copy
                    </span>
                  </button>
                </div>
              </div>
            ) : null}

            {!loaded && (
              <p role="status" className="text-on-surface-variant mt-4 text-sm">
                Loading tokens…
              </p>
            )}
            <ul aria-label="Active deployment tokens" className="mt-md space-y-2">
              {loaded && tokens.filter((token) => tokenState(token) === "ACTIVE").length === 0 && (
                <li className="border-outline-variant/30 text-label-sm text-on-surface-variant rounded border border-dashed p-3 font-mono">
                  No active deployment tokens.
                </li>
              )}
              {tokenRows(tokens.filter((token) => tokenState(token) === "ACTIVE"))}
            </ul>
            {tokens.some((token) => tokenState(token) !== "ACTIVE") && (
              <details className="mt-4">
                <summary className="text-on-surface-variant cursor-pointer text-sm">
                  Token history
                </summary>
                <ul aria-label="Token history" className="mt-3 space-y-2">
                  {tokenRows(tokens.filter((token) => tokenState(token) !== "ACTIVE"))}
                </ul>
              </details>
            )}
            <ApiOperationGuide
              key={tab}
              deploymentId={deploymentId}
              capabilities={capabilities}
              webhookSecret={webhookSecret}
              origin={origin}
              copy={copy}
              view="credentials"
            />
          </>
        )}
      </div>
    </section>
  );
}
