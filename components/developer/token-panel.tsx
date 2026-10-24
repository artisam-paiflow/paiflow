"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  CreateDeveloperTokenSchema,
  CreatedDeveloperTokenSchema,
  DeveloperTokenListSchema,
  DeveloperTokenSchema,
  UpdateDeveloperTokenSchema,
  type DeveloperToken,
  type DeveloperTokenPermission,
} from "@/lib/developer-tokens/schema";
import { inputClass, labelClass } from "@/components/builder/inputs/styles";
import DeploymentPicker from "./deployment-picker";
import { buttonClass, primaryClass, ManagementError, managementRequest } from "./api";

const base = "/api/developer-tokens";
type Fields = Record<string, string[] | undefined>;
const permissionName = (value: DeveloperTokenPermission) =>
  value === "READ_ONLY" ? "Read only" : "Read and operate";
const date = (value: string | null, fallback: string) =>
  value ? new Date(value).toLocaleString() : fallback;
function status(token: DeveloperToken) {
  if (token.revokedAt) return "Revoked";
  if (token.expiresAt && Date.parse(token.expiresAt) <= Date.now()) return "Expired";
  return token.deploymentIds.length ? "Active" : "Suspended (no deployments)";
}
const isLive = (token: DeveloperToken) =>
  !token.revokedAt && (!token.expiresAt || Date.parse(token.expiresAt) > Date.now());

function SelectionEditor({
  token,
  onSaved,
  onClose,
  startRequest,
  finishRequest,
  disabled,
}: {
  token: DeveloperToken;
  onSaved: (token: DeveloperToken) => void;
  onClose: () => void;
  startRequest: () => boolean;
  finishRequest: () => void;
  disabled: boolean;
}) {
  const [selected, setSelected] = useState(token.deploymentIds);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Fields>({});
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const parsed = UpdateDeveloperTokenSchema.safeParse({ deploymentIds: selected });
    if (!parsed.success) {
      setFields(parsed.error.flatten().fieldErrors);
      return;
    }
    if (!startRequest()) return;
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const updated = await managementRequest(`${base}/${token.id}`, DeveloperTokenSchema, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      onSaved(updated);
      toast.success("Deployment selection updated.");
    } catch (err) {
      setError(
        err instanceof ManagementError ? err.message : "Could not update selection. Try again.",
      );
      if (err instanceof ManagementError) setFields(err.fields);
    } finally {
      setBusy(false);
      finishRequest();
    }
  }
  return (
    <form
      onSubmit={save}
      className="border-primary/40 mt-4 space-y-3 rounded border p-3"
      aria-label={`Edit deployments for ${token.label ?? token.tokenPrefix}`}
      aria-busy={busy}
    >
      <h3 className="font-semibold">Edit deployment selection</h3>
      <p className="text-on-surface-muted text-sm">
        Permission: {permissionName(token.permission)}. Permission, label and expiry are fixed;
        create a replacement token to change them. Saving an empty selection suspends access. Remove
        unavailable or retired deployments before saving.
      </p>
      <DeploymentPicker
        selected={selected}
        onChange={setSelected}
        disabled={busy || disabled}
        error={fields.deploymentIds?.join(" ")}
      />
      {!selected.length ? <p role="status">This token will have no deployment access.</p> : null}
      {error ? (
        <p role="alert" className="text-error">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button className={buttonClass} disabled={busy || disabled}>
          Save selection
        </button>
        <button type="button" className={buttonClass} disabled={busy || disabled} onClick={onClose}>
          Cancel selection edit
        </button>
      </div>
    </form>
  );
}

export default function DeveloperTokenPanel() {
  const [tab, setTab] = useState<"tokens" | "quickstart">("tokens");
  const [createOpen, setCreateOpen] = useState(false);
  const createRef = useRef<HTMLElement>(null);
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const wasCreateOpen = useRef(false);
  useEffect(() => {
    if (createOpen) createRef.current?.focus();
    else if (wasCreateOpen.current) createButtonRef.current?.focus();
    wasCreateOpen.current = createOpen;
  }, [createOpen]);
  const [tokens, setTokens] = useState<DeveloperToken[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [listBusy, setListBusy] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [permission, setPermission] = useState<DeveloperTokenPermission>("READ_ONLY");
  const [expiry, setExpiry] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [fields, setFields] = useState<Fields>({});
  const [formError, setFormError] = useState<string | null>(null);
  // The secret has its own short-lived state; metadata state never contains plaintext.
  const [revealed, setRevealed] = useState<{ id: string; token: string } | null>(null);
  const [focusCreate, setFocusCreate] = useState(false);
  useEffect(() => {
    if (focusCreate && !revealed) {
      createButtonRef.current?.focus();
      setFocusCreate(false);
    }
  }, [focusCreate, revealed]);
  const revealRef = useRef<HTMLElement>(null);
  const revealGeneration = useRef(0);
  useEffect(() => {
    if (revealed) revealRef.current?.focus();
  }, [revealed]);
  const [copyError, setCopyError] = useState(false);
  const [editing, setEditing] = useState<DeveloperToken | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);

  // Token metadata reads and writes share one lane. The ref closes same-tick
  // event gaps; disabling controls alone would not prevent a stale list response
  // from replacing the result of a successful create, selection save or revoke.
  const requestInFlight = useRef(false);
  const [requestPending, setRequestPending] = useState(false);
  function startRequest() {
    if (requestInFlight.current) return false;
    requestInFlight.current = true;
    setRequestPending(true);
    return true;
  }
  function finishRequest() {
    requestInFlight.current = false;
    setRequestPending(false);
  }
  async function load(cursor?: string) {
    if (!startRequest()) return;
    setEditing(null);
    setListBusy(true);
    setListError(null);
    try {
      const data = await managementRequest(
        `${base}?limit=20${cursor ? `&cursor=${cursor}` : ""}`,
        DeveloperTokenListSchema,
      );
      setTokens((previous) =>
        cursor
          ? [
              ...previous,
              ...data.items.filter((item) => !previous.some((existing) => existing.id === item.id)),
            ]
          : data.items,
      );
      setNext(data.nextCursor);
      setLoaded(true);
    } catch {
      setListError("Could not load tokens. Retry to view their current status.");
    } finally {
      setListBusy(false);
      finishRequest();
    }
  }
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    // Clear on page departure, tab hiding and BFCache page transitions as well as Done/revoke.
    const clear = () => {
      revealGeneration.current += 1;
      setRevealed(null);
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") clear();
    };
    window.addEventListener("pagehide", clear);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("pagehide", clear);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  function update(token: DeveloperToken) {
    setTokens((previous) => previous.map((item) => (item.id === token.id ? token : item)));
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const parsed = CreateDeveloperTokenSchema.safeParse({
      ...(label.trim() ? { label: label.trim() } : {}),
      permission,
      deploymentIds: selected,
      ...(expiry ? { expiresInDays: Number(expiry) } : {}),
    });
    setFormError(null);
    setFields({});
    if (!parsed.success) {
      setFields(parsed.error.flatten().fieldErrors);
      return;
    }
    if (!startRequest()) return;
    const creationGeneration = revealGeneration.current;
    setBusy(true);
    try {
      const data = await managementRequest(base, CreatedDeveloperTokenSchema, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const { token, ...metadata } = data;
      const canReveal =
        creationGeneration === revealGeneration.current && document.visibilityState !== "hidden";
      setCreateOpen(false);
      if (canReveal) setRevealed({ id: metadata.id, token });
      else
        setFormError(
          "Token created after the secret reveal was dismissed. Its secret is no longer available. Revoke the new token in Tokens and create a replacement.",
        );
      setCopyError(false);
      setTokens((previous) => [metadata, ...previous]);
      setLabel("");
      setSelected([]);
      setExpiry("");
      setPermission("READ_ONLY");
      toast.success(
        canReveal
          ? "Developer token created. Copy it now."
          : "Developer token created. Revoke it and create a replacement to obtain a secret.",
      );
    } catch (err) {
      setFormError(
        err instanceof ManagementError
          ? err.message
          : "Could not create token. If the request reached the server, reload the list and revoke the uncopied token before creating another.",
      );
      if (err instanceof ManagementError) setFields(err.fields);
    } finally {
      setBusy(false);
      finishRequest();
    }
  }
  async function inspect(token: DeveloperToken) {
    if (!startRequest()) return;
    setActionError(null);
    try {
      const latest = await managementRequest(`${base}/${token.id}`, DeveloperTokenSchema);
      update(latest);
      if (isLive(latest)) setEditing(latest);
      else setActionError("This token has expired or been revoked. Create a replacement token.");
    } catch (err) {
      setActionError(
        err instanceof ManagementError ? err.message : "Could not load token. Try again.",
      );
    } finally {
      finishRequest();
    }
  }
  async function revoke(token: DeveloperToken) {
    if (!startRequest()) return;
    setActionError(null);
    try {
      const updated = await managementRequest(`${base}/${token.id}`, DeveloperTokenSchema, {
        method: "DELETE",
      });
      update(updated);
      setConfirmRevoke(null);
      if (editing?.id === token.id) setEditing(null);
      if (revealed?.id === token.id) setRevealed(null);
      toast.success("Developer token revoked.");
    } catch (err) {
      setActionError(
        err instanceof ManagementError ? err.message : "Could not revoke token. Try again.",
      );
    } finally {
      finishRequest();
    }
  }
  return (
    <div className="text-on-surface mt-4 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-on-surface-variant max-w-xl text-sm leading-relaxed">
          Connect your backend to selected deployed flows with one API token.
        </p>
        <button
          ref={createButtonRef}
          type="button"
          className={primaryClass}
          disabled={requestPending || !!revealed || createOpen}
          onClick={() => {
            setTab("tokens");
            setCreateOpen(true);
          }}
        >
          Create token
        </button>
      </div>
      <nav
        className="border-outline-variant/30 flex flex-wrap items-center gap-2 border-b pb-3"
        aria-label="Developer API sections"
      >
        {(["tokens", "quickstart"] as const).map((value) => (
          <button
            key={value}
            type="button"
            className={`${buttonClass} ${tab === value ? "border-primary bg-primary/10 text-primary" : ""}`}
            aria-current={tab === value ? "page" : undefined}
            onClick={() => {
              if (tab !== value) {
                revealGeneration.current += 1;
                setRevealed(null);
              }
              setTab(value);
            }}
          >
            {value === "tokens" ? "Tokens" : "Quickstart"}
          </button>
        ))}
        <a
          className="text-primary ml-auto inline-flex min-h-11 items-center py-2 text-sm underline underline-offset-4"
          href="/api/v1/openapi.json"
          target="_blank"
          rel="noopener noreferrer"
        >
          API reference (OpenAPI) ↗
        </a>
      </nav>
      {tab === "quickstart" ? <Quickstart /> : null}
      {formError && (!createOpen || tab !== "tokens") ? (
        <p role="alert" className="text-error text-sm">
          {formError}
        </p>
      ) : null}
      {revealed ? (
        <section
          className="ph-no-capture border-primary/50 space-y-3 rounded-xl border p-4"
          aria-label="New developer token"
          ref={revealRef}
          tabIndex={-1}
          data-testid="developer-token-reveal"
        >
          <h2 className="font-semibold">Copy this token now. It will not be shown again.</h2>
          <p className="text-sm">
            Closing this reveal, leaving the page or hiding this tab clears it. If lost, revoke it
            and generate a replacement.
          </p>
          <code className="bg-surface-container-lowest block rounded p-3 font-mono text-sm break-all select-all">
            {revealed.token}
          </code>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={buttonClass}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(revealed.token);
                  setCopyError(false);
                  toast.success("Token copied.");
                } catch {
                  setCopyError(true);
                }
              }}
            >
              Copy token
            </button>
            <button
              type="button"
              className={buttonClass}
              onClick={() => {
                setRevealed(null);
                setCreateOpen(false);
                setTab("tokens");
                setFocusCreate(true);
              }}
            >
              Done, hide token
            </button>
          </div>
          {copyError ? (
            <p role="alert" className="text-error">
              Could not copy. Select the token above and copy it manually.
            </p>
          ) : null}
          <p className="text-sm">
            Store it as PAIFLOW_API_TOKEN on your backend. Send it in the Authorization header. This
            example uses the environment variable and never embeds your token:
          </p>
          <pre
            tabIndex={0}
            aria-label="Example API request"
            className="bg-surface-container-lowest focus-visible:ring-primary overflow-x-auto rounded p-3 text-xs focus-visible:ring-2"
          >
            <code>
              {
                'curl "$PAIFLOW_BASE_URL/api/v1/deployments" \\\n  -H "Authorization: Bearer $PAIFLOW_API_TOKEN"'
              }
            </code>
          </pre>
        </section>
      ) : null}
      {createOpen && tab === "tokens" ? (
        <section
          className="glass-panel rounded-xl p-5 sm:p-6"
          ref={createRef}
          tabIndex={-1}
          aria-label="Create token panel"
        >
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-xl font-semibold">Create developer token</h2>
            <button
              type="button"
              className={buttonClass}
              disabled={requestPending || !!revealed}
              onClick={() => {
                setCreateOpen(false);
                createButtonRef.current?.focus();
              }}
            >
              Cancel
            </button>
          </div>
          <p className="text-on-surface-variant mt-3 text-sm">
            Keep tokens on your server. Never expose them in client apps, URLs or public
            repositories.
          </p>
          <p className="text-on-surface-muted mt-2 text-sm">
            Up to 10 active tokens, with up to 100 selected deployments each. Permission, label and
            expiry are fixed after creation; generate a replacement to change them.
          </p>
          <form
            className="mt-4 space-y-4"
            onSubmit={create}
            aria-label="Create developer token"
            aria-busy={busy}
          >
            <fieldset disabled={requestPending || !!revealed} className="space-y-4">
              <h3 className="text-on-surface font-semibold">1. Name and expiry</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="developer-label" className={labelClass}>
                    Label (optional)
                  </label>
                  <input
                    id="developer-label"
                    className={inputClass}
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    maxLength={64}
                    placeholder="Campus app backend"
                    aria-invalid={!!fields.label}
                    aria-describedby={fields.label ? "developer-label-error" : undefined}
                  />
                  {fields.label ? (
                    <p id="developer-label-error" role="alert" className="text-error text-sm">
                      {fields.label.join(" ")}
                    </p>
                  ) : null}
                </div>
                <div>
                  <label htmlFor="developer-expiry" className={labelClass}>
                    Expires
                  </label>
                  <select
                    id="developer-expiry"
                    className={inputClass}
                    value={expiry}
                    onChange={(e) => setExpiry(e.target.value)}
                    aria-invalid={!!fields.expiresInDays}
                    aria-describedby={fields.expiresInDays ? "developer-expiry-error" : undefined}
                  >
                    <option value="">Never</option>
                    <option value="30">30 days</option>
                    <option value="90">90 days</option>
                    <option value="365">1 year</option>
                  </select>
                  {fields.expiresInDays ? (
                    <p id="developer-expiry-error" role="alert" className="text-error text-sm">
                      {fields.expiresInDays.join(" ")}
                    </p>
                  ) : null}
                </div>
              </div>
              <fieldset className="space-y-3" aria-describedby="developer-permission-hint">
                <legend className="font-semibold">2. Permissions</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  {(["READ_ONLY", "READ_OPERATE"] as const).map((value) => (
                    <label
                      key={value}
                      className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 ${permission === value ? "border-primary bg-primary/5" : "border-outline-variant/40"}`}
                    >
                      <input
                        type="radio"
                        name="permission"
                        value={value}
                        checked={permission === value}
                        onChange={() => setPermission(value)}
                        className="accent-primary mt-1 size-4 shrink-0"
                      />
                      <span>
                        <span className="block font-medium">{permissionName(value)}</span>
                        <span className="text-on-surface-variant mt-1 block text-sm leading-relaxed">
                          {value === "READ_ONLY"
                            ? "Read balances, events, transaction status and supported deployment data."
                            : "Also prepare and submit supported operations, including relayer early releases."}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
                <p id="developer-permission-hint" className="text-on-surface-variant text-sm">
                  Operate access can authorize financial actions. Choose only the access your
                  backend needs.
                </p>
                {fields.permission ? (
                  <p role="alert" className="text-error text-sm">
                    {fields.permission.join(" ")}
                  </p>
                ) : null}
              </fieldset>
              <h3 className="font-semibold">3. Deployments</h3>
              <DeploymentPicker
                selected={selected}
                onChange={setSelected}
                disabled={requestPending || !!revealed}
                error={fields.deploymentIds?.join(" ")}
              />
              <button type="submit" className={primaryClass}>
                {busy ? "Creating…" : "Generate token"}
              </button>
            </fieldset>
            {revealed ? (
              <p role="status" className="text-sm">
                Copy and hide the new token before generating another.
              </p>
            ) : null}
            {formError ? (
              <p role="alert" className="text-error">
                {formError}
              </p>
            ) : null}
          </form>
        </section>
      ) : null}
      {tab === "tokens" ? (
        <section
          className="glass-panel space-y-4 rounded-xl p-5 sm:p-6"
          aria-label="Your developer tokens"
          aria-busy={listBusy}
        >
          <h2 className="text-xl font-semibold">Your developer tokens</h2>
          {!loaded && !listError ? <p role="status">Loading tokens…</p> : null}
          {listError ? (
            <p role="alert" className="text-error">
              {listError}
            </p>
          ) : null}
          <button
            type="button"
            className={buttonClass}
            disabled={requestPending}
            onClick={() => {
              void load();
            }}
          >
            Refresh token list
          </button>
          {loaded && !tokens.length ? (
            <div className="border-outline-variant/30 rounded-lg border border-dashed px-5 py-10 text-center">
              <h3 className="font-semibold">No developer tokens yet.</h3>
              <p className="text-on-surface-variant mx-auto mt-2 max-w-md text-sm leading-relaxed">
                Create your first token to connect your backend. You choose exactly which
                deployments it can access.
              </p>
              <button
                type="button"
                className={`${primaryClass} mt-5`}
                disabled={requestPending || !!revealed || createOpen}
                onClick={() => setCreateOpen(true)}
              >
                Create your first token
              </button>
            </div>
          ) : null}
          {actionError ? (
            <p role="alert" className="text-error">
              {actionError}
            </p>
          ) : null}
          {tokens.length ? (
            <div
              aria-hidden="true"
              className="bg-surface-container/80 text-on-surface-variant hidden grid-cols-[minmax(0,2fr)_1.2fr_0.8fr_1fr_1.2fr] gap-4 rounded px-4 py-3 font-mono text-xs uppercase md:grid"
            >
              <span>Name</span>
              <span>Access</span>
              <span>Deployments</span>
              <span>Last used</span>
              <span>Status</span>
            </div>
          ) : null}
          <ul className="divide-outline-variant/20 divide-y">
            {tokens.map((token) => (
              <li
                key={token.id}
                className="py-1"
                aria-label={`Token ${token.label ?? token.tokenPrefix}`}
              >
                <details
                  className="group rounded-lg"
                  onToggle={(e) => {
                    if (!e.currentTarget.open && editing?.id === token.id) setEditing(null);
                  }}
                >
                  <summary className="hover:bg-surface-container-high/40 focus-visible:ring-primary grid min-h-16 cursor-pointer list-none gap-3 rounded-lg p-4 focus-visible:ring-2 md:grid-cols-[minmax(0,2fr)_1.2fr_0.8fr_1fr_1.2fr] md:items-center md:gap-4">
                    <span className="min-w-0">
                      <h3 className="font-medium break-words">
                        {token.label ?? "Unlabelled token"}
                      </h3>
                      <span className="text-on-surface-variant mt-1 block font-mono text-xs">
                        {token.tokenPrefix}…
                      </span>
                    </span>
                    <span className="text-on-surface-variant text-sm">
                      {permissionName(token.permission)}
                    </span>
                    <span className="text-on-surface-variant text-sm">
                      <span className="md:hidden">Deployments: </span>
                      {token.deploymentIds.length}
                    </span>
                    <span className="text-on-surface-variant text-sm">
                      <span className="md:hidden">Last used: </span>
                      {token.lastUsedAt ? new Date(token.lastUsedAt).toLocaleDateString() : "Never"}
                    </span>
                    <span className="flex items-center justify-between gap-2">
                      <span
                        className={`rounded border px-2 py-1 text-xs ${isLive(token) && token.deploymentIds.length ? "border-secondary/30 bg-secondary/10 text-secondary" : "border-outline-variant/40 text-on-surface-variant"}`}
                      >
                        {status(token)}
                      </span>
                      <span
                        className="text-on-surface-variant group-open:rotate-90"
                        aria-hidden="true"
                      >
                        ›
                      </span>
                    </span>
                    <span className="sr-only">
                      View details for {token.label ?? token.tokenPrefix}
                    </span>
                  </summary>
                  <div className="border-outline-variant/20 mx-4 border-t py-4">
                    <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                      <dt>Created</dt>
                      <dd className="font-mono break-words">{date(token.createdAt, "—")}</dd>
                      <dt>Last used</dt>
                      <dd className="font-mono break-words">{date(token.lastUsedAt, "Never")}</dd>
                      <dt>Expires</dt>
                      <dd className="font-mono break-words">{date(token.expiresAt, "Never")}</dd>
                      {token.revokedAt ? (
                        <>
                          <dt>Revoked</dt>
                          <dd className="font-mono break-words">{date(token.revokedAt, "—")}</dd>
                        </>
                      ) : null}
                    </dl>
                    <details className="mt-3">
                      <summary className="min-h-11 cursor-pointer py-2 text-sm">
                        Selected deployments ({token.deploymentIds.length})
                      </summary>
                      <ul>
                        {token.deploymentIds.map((id) => (
                          <li key={id} className="py-1 font-mono text-xs break-all">
                            {id}
                          </li>
                        ))}
                      </ul>
                      {!token.deploymentIds.length ? (
                        <p className="text-sm">No deployment access.</p>
                      ) : null}
                      <p className="text-on-surface-muted mt-2 text-sm">
                        Selection IDs are retained when a deployment becomes unavailable. They grant
                        access only while it remains eligible. Use Edit deployments to remove
                        unavailable grants.
                      </p>
                    </details>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {isLive(token) ? (
                        <button
                          type="button"
                          className={buttonClass}
                          disabled={requestPending}
                          onClick={() => void inspect(token)}
                        >
                          Edit deployments
                        </button>
                      ) : null}
                      {!token.revokedAt ? (
                        <button
                          type="button"
                          className={buttonClass}
                          disabled={requestPending}
                          onClick={() => setConfirmRevoke(token.id)}
                        >
                          Revoke token
                        </button>
                      ) : null}
                    </div>
                    {confirmRevoke === token.id ? (
                      <div className="border-error/50 mt-3 space-y-2 rounded border p-3">
                        <p>
                          Revoke this token? Subsequent requests will be refused. Submitted
                          blockchain transactions may still complete.
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            className={buttonClass}
                            disabled={requestPending}
                            onClick={() => void revoke(token)}
                          >
                            Confirm revocation
                          </button>
                          <button
                            type="button"
                            className={buttonClass}
                            disabled={requestPending}
                            onClick={() => setConfirmRevoke(null)}
                          >
                            Cancel revocation
                          </button>
                        </div>
                      </div>
                    ) : null}
                    {editing?.id === token.id ? (
                      <SelectionEditor
                        key={editing.id}
                        token={editing}
                        startRequest={startRequest}
                        finishRequest={finishRequest}
                        disabled={requestPending}
                        onClose={() => setEditing(null)}
                        onSaved={(updated) => {
                          update(updated);
                          setEditing(null);
                        }}
                      />
                    ) : null}
                  </div>
                </details>
              </li>
            ))}
          </ul>
          {next ? (
            <button
              type="button"
              className={buttonClass}
              disabled={requestPending}
              onClick={() => void load(next)}
            >
              Load more tokens
            </button>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function Quickstart() {
  const example = [
    'curl "$PAIFLOW_BASE_URL/api/v1/deployments" ' + String.fromCharCode(92),
    '  -H "Authorization: Bearer $PAIFLOW_API_TOKEN"',
  ].join("\n");
  const [copyError, setCopyError] = useState(false);
  return (
    <section className="glass-panel space-y-6 rounded-xl p-5 sm:p-6" aria-label="API quickstart">
      <div>
        <h2 className="text-xl font-semibold">Connect your backend</h2>
        <p className="text-on-surface-variant mt-2 text-sm leading-relaxed">
          One developer token can access several deployments you explicitly select. Tokens in a
          deployment’s API access panel remain limited to that single deployment.
        </p>
      </div>
      <div>
        <h3 className="font-semibold">1. Create a token</h3>
        <p className="text-on-surface-variant mt-2 text-sm leading-relaxed">
          Deploy and confirm your flows first. Create a token from the Tokens section, choose its
          permissions and deployments, then copy its one-time secret.
        </p>
      </div>
      <div>
        <h3 className="font-semibold">2. Configure your server</h3>
        <p className="text-on-surface-variant mt-2 text-sm leading-relaxed">
          Set PAIFLOW_BASE_URL to this app’s HTTPS origin and store PAIFLOW_API_TOKEN in your
          server’s secret manager. Never put tokens in client apps, URLs, logs or repositories.
        </p>
      </div>
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-semibold">3. List authorized deployments</h3>
          <button
            type="button"
            className={buttonClass}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(example);
                setCopyError(false);
                toast.success("Example copied.");
              } catch {
                setCopyError(true);
              }
            }}
          >
            Copy example
          </button>
        </div>
        <pre
          tabIndex={0}
          aria-label="Example API request"
          className="bg-surface-container-lowest focus-visible:ring-primary mt-3 overflow-x-auto rounded-lg p-4 text-sm focus-visible:ring-2"
        >
          <code>{example}</code>
        </pre>
        {copyError ? (
          <p role="alert" className="text-error mt-2 text-sm">
            Could not copy. Select the example and copy it manually.
          </p>
        ) : null}
        <p className="text-on-surface-variant mt-2 text-sm">
          The example uses environment variables. It never includes your token.
        </p>
      </div>
      <details className="border-outline-variant/30 border-t pt-4">
        <summary className="min-h-11 cursor-pointer py-2 font-medium">
          Permissions and access limits
        </summary>
        <div className="text-on-surface-variant mt-3 space-y-3 text-sm leading-relaxed">
          <p>
            Read only permits supported data reads. Read and operate adds supported payment,
            funding, payout and control operations, including relayer early releases. Wallet
            signatures, subscriber consent and webhook secrets remain separate.
          </p>
          <p>
            Up to 10 unrevoked, unexpired tokens, each with up to 100 selected deployments. Future
            deployments never inherit access. Tokens cannot create flows or deployments. Permission,
            label and expiry are fixed after creation.
          </p>
          <p>
            Per-endpoint rate limits are shared across selected deployments. Revoking a token or
            removing a deployment blocks subsequent requests; submitted transactions may still
            complete.
          </p>
        </div>
      </details>
    </section>
  );
}
