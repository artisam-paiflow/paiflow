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
}: {
  token: DeveloperToken;
  onSaved: (token: DeveloperToken) => void;
  onClose: () => void;
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
        disabled={busy}
        error={fields.deploymentIds?.join(" ")}
      />
      {!selected.length ? <p role="status">This token will have no deployment access.</p> : null}
      {error ? (
        <p role="alert" className="text-error">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button className={buttonClass} disabled={busy}>
          Save selection
        </button>
        <button type="button" className={buttonClass} disabled={busy} onClick={onClose}>
          Cancel selection edit
        </button>
      </div>
    </form>
  );
}

export default function DeveloperTokenPanel() {
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
  const revealRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (revealed) revealRef.current?.focus();
  }, [revealed]);
  const [copyError, setCopyError] = useState(false);
  const [editing, setEditing] = useState<DeveloperToken | null>(null);
  const [action, setAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);

  async function load(cursor?: string) {
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
    }
  }
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    // Clear on page departure, tab hiding and BFCache page transitions as well as Done/revoke.
    const clear = () => setRevealed(null);
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
    setBusy(true);
    try {
      const data = await managementRequest(base, CreatedDeveloperTokenSchema, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const { token, ...metadata } = data;
      setRevealed({ id: metadata.id, token });
      setCopyError(false);
      setTokens((previous) => [metadata, ...previous]);
      setLabel("");
      setSelected([]);
      setExpiry("");
      setPermission("READ_ONLY");
      toast.success("Developer token created. Copy it now.");
    } catch (err) {
      setFormError(
        err instanceof ManagementError
          ? err.message
          : "Could not create token. If the request reached the server, reload the list and revoke the uncopied token before creating another.",
      );
      if (err instanceof ManagementError) setFields(err.fields);
    } finally {
      setBusy(false);
    }
  }
  async function inspect(token: DeveloperToken) {
    setAction(token.id);
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
      setAction(null);
    }
  }
  async function revoke(token: DeveloperToken) {
    setAction(token.id);
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
      setAction(null);
    }
  }
  return (
    <div className="text-on-surface mt-4 space-y-6">
      <p className="text-on-surface-muted">
        Connect your backend to several selected existing deployments with one developer token.
        Deployment API tokens in each deployment’s API access panel remain limited to that single
        deployment.
      </p>
      <div className="glass-panel space-y-2 rounded-xl p-4 text-sm">
        <p>
          Keep tokens on your server in an environment variable or secret manager. Never embed them
          in a frontend, mobile app, URL or public repository.
        </p>
        <p>
          Read only permits discovery, balances, events, transaction status, quotes and supported
          schedule, subscription and funding reads. Read and operate also permits supported payment,
          funding, payout and control operations, including relayer early releases.
        </p>
        <p>
          Required wallet signatures, subscriber consent and webhook secrets remain separate. Tokens
          cannot create flows or deployments. Per-endpoint rate allowances are shared across
          selected deployments.
        </p>
        <p>
          Revoking a token or removing a deployment blocks subsequent requests. Already submitted
          blockchain transactions may still complete.
        </p>
        <a
          className="text-primary inline-block min-h-11 py-3 underline"
          href="/api/v1/openapi.json"
          target="_blank"
          rel="noopener noreferrer"
        >
          API reference (OpenAPI)
        </a>
      </div>
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
            <button type="button" className={buttonClass} onClick={() => setRevealed(null)}>
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
          <pre className="bg-surface-container-lowest overflow-x-auto rounded p-3 text-xs">
            <code>
              {
                'curl "$PAIFLOW_BASE_URL/api/v1/deployments" \\\n  -H "Authorization: Bearer $PAIFLOW_API_TOKEN"'
              }
            </code>
          </pre>
        </section>
      ) : null}
      <section className="glass-panel rounded-xl p-4">
        <h2 className="text-xl font-semibold">Create developer token</h2>
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
          <fieldset disabled={busy || !!revealed} className="space-y-4">
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
            <div>
              <label htmlFor="developer-permission" className={labelClass}>
                Permission
              </label>
              <select
                id="developer-permission"
                className={inputClass}
                value={permission}
                onChange={(e) => setPermission(e.target.value as DeveloperTokenPermission)}
                aria-invalid={!!fields.permission}
                aria-describedby="developer-permission-hint"
              >
                <option value="READ_ONLY">Read only</option>
                <option value="READ_OPERATE">Read and operate</option>
              </select>
              <p id="developer-permission-hint" className="text-on-surface-muted mt-1 text-sm">
                Operate access can authorize supported relayer early releases. Choose only the
                access your backend needs.
              </p>
              {fields.permission ? (
                <p role="alert" className="text-error text-sm">
                  {fields.permission.join(" ")}
                </p>
              ) : null}
            </div>
            <DeploymentPicker
              selected={selected}
              onChange={setSelected}
              disabled={busy || !!revealed}
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
      <section
        className="glass-panel space-y-4 rounded-xl p-4"
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
          disabled={listBusy}
          onClick={() => {
            setEditing(null);
            void load();
          }}
        >
          Refresh token list
        </button>
        {loaded && !tokens.length ? <p>No developer tokens yet.</p> : null}
        {actionError ? (
          <p role="alert" className="text-error">
            {actionError}
          </p>
        ) : null}
        <ul className="space-y-4">
          {tokens.map((token) => (
            <li
              key={token.id}
              className="border-outline-variant/40 rounded border p-3"
              aria-label={`Token ${token.label ?? token.tokenPrefix}`}
            >
              <div className="flex flex-wrap justify-between gap-2">
                <h3 className="font-semibold break-all">{token.label ?? "Unlabelled token"}</h3>
                <span className="font-mono text-sm">{status(token)}</span>
              </div>
              <p className="mt-1 font-mono text-sm">
                {token.tokenPrefix}… · {permissionName(token.permission)}
              </p>
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
                  access only while it remains eligible. Use Edit deployments to remove unavailable
                  grants.
                </p>
              </details>
              <div className="mt-3 flex flex-wrap gap-2">
                {isLive(token) ? (
                  <button
                    type="button"
                    className={buttonClass}
                    disabled={!!action}
                    onClick={() => void inspect(token)}
                  >
                    Edit deployments
                  </button>
                ) : null}
                {!token.revokedAt ? (
                  <button
                    type="button"
                    className={buttonClass}
                    disabled={!!action}
                    onClick={() => setConfirmRevoke(token.id)}
                  >
                    Revoke token
                  </button>
                ) : null}
              </div>
              {confirmRevoke === token.id ? (
                <div className="border-error/50 mt-3 space-y-2 rounded border p-3">
                  <p>
                    Revoke this token? Subsequent requests will be refused. Submitted blockchain
                    transactions may still complete.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={buttonClass}
                      disabled={!!action}
                      onClick={() => void revoke(token)}
                    >
                      Confirm revocation
                    </button>
                    <button
                      type="button"
                      className={buttonClass}
                      disabled={!!action}
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
                  onClose={() => setEditing(null)}
                  onSaved={(updated) => {
                    update(updated);
                    setEditing(null);
                  }}
                />
              ) : null}
            </li>
          ))}
        </ul>
        {next ? (
          <button
            type="button"
            className={buttonClass}
            disabled={listBusy}
            onClick={() => void load(next)}
          >
            Load more tokens
          </button>
        ) : null}
      </section>
    </div>
  );
}
