"use client";

import { useCallback, useEffect, useState } from "react";
import { useFieldArray, useForm, type FieldPath } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import {
  DevPayerSchema,
  DevSplitterSchema,
  type DevPayer,
  type DevSplitter,
} from "@/lib/dev/schema";
import { isPendingAddress, type FlowGraph, type FlowNode } from "@/lib/flows/schema";
import { apiError } from "@/lib/friendly-error";
import type { StellarNetwork } from "@/lib/stellar/explorer";
import type { TrustlineWarning } from "@/lib/stellar/trustline-warnings";
import AddressInput from "@/components/builder/address-input";
import { AmountInput } from "@/components/builder/inputs/amount-input";
import { ShareInput } from "@/components/builder/inputs/share-input";

type DevNode = { nodeId: string; templateKind: string; configured: boolean | null };
type SaveResponse = {
  data?: { warnings?: TrustlineWarning[] };
  error?: { fields?: Record<string, string[]> };
};
const buttonClass =
  "border-primary/40 text-primary text-label-md rounded border px-3 py-2 font-mono disabled:opacity-60";

export default function DevValuesPanel({
  deploymentId,
  network,
  graph,
  status,
  canEdit,
}: {
  deploymentId: string;
  network: StellarNetwork | null;
  graph: FlowGraph | null;
  status: string;
  canEdit: boolean;
}) {
  if (!canEdit || !graph?.devMode || status !== "CONFIRMED" || !network) return null;
  return <DevValues deploymentId={deploymentId} network={network} graph={graph} />;
}

function DevValues({
  deploymentId,
  network,
  graph,
}: {
  deploymentId: string;
  network: StellarNetwork;
  graph: FlowGraph;
}) {
  const [nodes, setNodes] = useState<DevNode[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const res = await fetch(`/api/deployments/${deploymentId}/dev-config`, { signal });
        const json = (await res.json()) as { data?: { nodes: DevNode[] } };
        if (!res.ok || !json.data) throw apiError(json, "Could not load dev values");
        setNodes(json.data.nodes);
        setError(null);
      } catch (err) {
        if (!signal?.aborted)
          setError(err instanceof Error ? err.message : "Could not load dev values");
      }
    },
    [deploymentId],
  );
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  return (
    <section
      className="glass-panel mt-md p-md space-y-3 rounded-xl"
      aria-label="Dev values"
      data-testid="dev-values-panel"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-label-sm text-on-surface-variant font-mono uppercase">/ Dev values</h3>
        <span
          data-testid="network-chip"
          aria-label={`Saving on ${network}`}
          className={`text-label-md rounded-lg border px-3 py-1.5 font-mono ${network === "mainnet" ? "border-error/40 bg-error-container/30 text-error" : "border-secondary/30 bg-secondary/10 text-secondary"}`}
        >
          {network.toUpperCase()}
        </span>
      </div>
      <p className="text-body-sm text-on-surface-variant">
        Saving updates the contract through the relayer. Fields start from the deployment snapshot;
        later API changes are not shown here.
      </p>
      {error && (
        <div role="alert" className="text-body-sm text-error">
          {error}{" "}
          <button type="button" className={buttonClass} onClick={() => void load()}>
            Retry status
          </button>
        </div>
      )}
      {!nodes && !error && <p role="status">Loading dev values…</p>}
      {nodes?.length === 0 && <p>No dev nodes found.</p>}
      {nodes?.map((node) => {
        const source = graph.nodes.find((n) => n.id === node.nodeId);
        return (
          <div
            key={node.nodeId}
            className="border-outline-variant/40 space-y-3 rounded-lg border p-3"
          >
            <h4 className="text-label-md text-on-surface font-mono">
              {node.templateKind === "PAYER_DEV"
                ? "Pay"
                : node.templateKind === "SPLITTER_DEV"
                  ? "Split"
                  : node.templateKind}{" "}
              · {node.nodeId}
            </h4>
            <p role="status" className="text-body-sm text-on-surface-variant">
              {node.configured === null
                ? "Configuration status unavailable"
                : node.configured
                  ? "Configured"
                  : "Unconfigured"}
            </p>
            {node.templateKind === "PAYER_DEV" &&
            source?.type === "pay" &&
            source.config.payoutMode !== "fiat" ? (
              <PayForm deploymentId={deploymentId} node={source} onSaved={load} />
            ) : node.templateKind === "SPLITTER_DEV" &&
              source?.type === "split" &&
              !source.config.recipients.some((r) => r.payoutMode === "fiat") ? (
              <SplitForm deploymentId={deploymentId} node={source} onSaved={load} />
            ) : (
              <p className="text-body-sm text-on-surface-variant">
                Configure these fields through the API.
              </p>
            )}
          </div>
        );
      })}
    </section>
  );
}

function RecipientWarnings({
  warnings,
  address,
}: {
  warnings: TrustlineWarning[];
  address: string;
}) {
  return (
    <>
      {warnings
        .filter((w) => w.recipient === address)
        .map((w, i) => (
          <p key={i} role="status" className="text-body-sm text-tertiary break-all">
            {w.message}
          </p>
        ))}
    </>
  );
}

function useDevSave(deploymentId: string, endpoint: string, onSaved: () => Promise<void>) {
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<TrustlineWarning[]>([]);
  async function save(
    body: DevPayer | DevSplitter,
    fieldError: (path: string, message: string) => void,
  ) {
    setError(null);
    setWarnings([]);
    try {
      const res = await fetch(`/api/deployments/${deploymentId}/${endpoint}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as SaveResponse;
      if (!res.ok || !json.data) {
        for (const [path, messages] of Object.entries(json.error?.fields ?? {}))
          fieldError(path, messages.join(" "));
        throw apiError(json, "Could not save dev values");
      }
      setWarnings(json.data.warnings ?? []);
      toast.success("Dev values saved");
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save dev values");
    }
  }
  return { save, error, warnings };
}

function PayForm({
  deploymentId,
  node,
  onSaved,
}: {
  deploymentId: string;
  node: Extract<FlowNode, { type: "pay" }>;
  onSaved: () => Promise<void>;
}) {
  const { config } = node;
  const form = useForm<DevPayer>({
    resolver: zodResolver(DevPayerSchema),
    defaultValues: {
      nodeId: node.id,
      recipient: isPendingAddress(config.recipient) ? "" : config.recipient,
      ...(config.fullAmount
        ? { mode: "percentage" as const, percentage: 100 }
        : {
            mode: config.mode ?? "fixed",
            ...(config.mode === "percentage"
              ? { percentage: config.percentage ?? 0 }
              : { amountStroops: config.amountStroops ?? "" }),
          }),
    },
  });
  const { save, error, warnings } = useDevSave(deploymentId, "dev-payer", onSaved);
  const value = form.watch();
  const errors = form.formState.errors;
  return (
    <form
      className="space-y-3"
      onSubmit={form.handleSubmit((body) =>
        save(body, (path, message) =>
          form.setError(path === "_" ? "root.server" : (path as FieldPath<DevPayer>), { message }),
        ),
      )}
    >
      <fieldset disabled={form.formState.isSubmitting} className="space-y-3">
        <AddressInput
          label="Recipient"
          value={value.recipient ?? ""}
          pendingAllowed={false}
          onChange={(v) => form.setValue("recipient", v, { shouldValidate: true })}
          error={errors.recipient?.message}
        />
        <RecipientWarnings warnings={warnings} address={value.recipient ?? ""} />
        {config.fullAmount ? (
          <p className="text-body-sm text-on-surface-variant">Pays the full incoming amount.</p>
        ) : value.mode === "percentage" ? (
          <ShareInput
            label="Share"
            value={Math.round((value.percentage ?? 0) * 100)}
            minBps={1}
            onChange={(v) => form.setValue("percentage", v / 100, { shouldValidate: true })}
            error={errors.percentage?.message}
          />
        ) : (
          <AmountInput
            label="Amount"
            asset={config.asset}
            value={value.amountStroops ?? ""}
            onChange={(v) => form.setValue("amountStroops", v, { shouldValidate: true })}
            error={errors.amountStroops?.message}
          />
        )}
        {(errors as Record<string, { message?: string }>)[""]?.message && (
          <p role="alert" className="text-error">
            {(errors as Record<string, { message?: string }>)[""]?.message}
          </p>
        )}
        {errors.root?.server?.message && (
          <p role="alert" className="text-error">
            {errors.root.server.message}
          </p>
        )}
        {error && (
          <p role="alert" className="text-body-sm text-error">
            {error}
          </p>
        )}
        <button type="submit" className={buttonClass}>
          {form.formState.isSubmitting ? "Saving…" : "Save Pay"}
        </button>
      </fieldset>
    </form>
  );
}

function SplitForm({
  deploymentId,
  node,
  onSaved,
}: {
  deploymentId: string;
  node: Extract<FlowNode, { type: "split" }>;
  onSaved: () => Promise<void>;
}) {
  const [mode, setMode] = useState<"fixed" | "percentage">(
    node.config.recipients[0]?.mode ?? "percentage",
  );
  const blank = () => ({
    address: "",
    mode,
    payoutMode: "crypto" as const,
    ...(mode === "percentage" ? { bps: 0 } : { amountStroops: "" }),
  });
  const form = useForm<DevSplitter>({
    resolver: zodResolver(DevSplitterSchema),
    defaultValues: {
      nodeId: node.id,
      recipients: node.config.recipients.length
        ? node.config.recipients.map((r) => ({
            ...r,
            address: isPendingAddress(r.address) ? "" : r.address,
            payoutMode: "crypto",
          }))
        : [blank()],
    },
  });
  const rows = useFieldArray({ control: form.control, name: "recipients" });
  const { save, error, warnings } = useDevSave(deploymentId, "dev-splitter", onSaved);
  const values = form.watch("recipients");
  const errors = form.formState.errors;
  return (
    <form
      className="space-y-3"
      onSubmit={form.handleSubmit((body) => {
        // The route leaves these cross-recipient invariants to the contract. Catch them before signing.
        const recipients = body.recipients;
        if (
          new Set(recipients.map((r) => r.address)).size !== recipients.length ||
          recipients.some((r) => r.mode === "fixed" && BigInt(r.amountStroops ?? "0") <= 0n) ||
          (mode === "percentage" && recipients.reduce((sum, r) => sum + (r.bps ?? 0), 0) !== 10000)
        ) {
          form.setError("root.server", {
            message: "Use distinct recipients, positive amounts, and shares totaling 100%.",
          });
          return;
        }
        return save(body, (path, message) =>
          form.setError(path === "_" ? "root.server" : (path as FieldPath<DevSplitter>), {
            message,
          }),
        );
      })}
    >
      <fieldset disabled={form.formState.isSubmitting} className="space-y-3">
        {node.config.recipients.length === 0 && (
          <label className="text-body-sm grid gap-1">
            Split mode
            <select
              className="bg-surface-container-lowest rounded border p-2"
              value={mode}
              onChange={(e) => {
                const nextMode = e.target.value as "fixed" | "percentage";
                setMode(nextMode);
                form.reset({
                  nodeId: node.id,
                  recipients: [
                    {
                      address: "",
                      payoutMode: "crypto",
                      mode: nextMode,
                      ...(nextMode === "fixed" ? { amountStroops: "" } : { bps: 0 }),
                    },
                  ],
                });
              }}
            >
              <option value="fixed">Fixed amounts</option>
              <option value="percentage">Shares</option>
            </select>
          </label>
        )}
        {rows.fields.map((row, i) => {
          const value = values[i]!;
          const rowError = errors.recipients?.[i];
          return (
            <div key={row.id} className="space-y-2">
              <AddressInput
                label={`Recipient ${i + 1}`}
                value={value.address ?? ""}
                pendingAllowed={false}
                onChange={(v) =>
                  form.setValue(`recipients.${i}.address`, v, { shouldValidate: true })
                }
                error={rowError?.address?.message}
              />
              <RecipientWarnings warnings={warnings} address={value.address ?? ""} />
              {mode === "percentage" ? (
                <ShareInput
                  label={`Share ${i + 1}`}
                  value={value.bps ?? 0}
                  minBps={1}
                  onChange={(v) =>
                    form.setValue(`recipients.${i}.bps`, v, { shouldValidate: true })
                  }
                  error={rowError?.bps?.message}
                />
              ) : (
                <AmountInput
                  label={`Amount ${i + 1}`}
                  asset={node.config.asset}
                  value={value.amountStroops ?? ""}
                  onChange={(v) =>
                    form.setValue(`recipients.${i}.amountStroops`, v, { shouldValidate: true })
                  }
                  error={rowError?.amountStroops?.message}
                />
              )}
              {rowError?.message && (
                <p role="alert" className="text-error">
                  {rowError.message}
                </p>
              )}
              <button
                type="button"
                className={buttonClass}
                disabled={rows.fields.length === 1}
                onClick={() => rows.remove(i)}
              >
                Remove recipient {i + 1}
              </button>
            </div>
          );
        })}
        <button
          type="button"
          className={buttonClass}
          disabled={rows.fields.length >= 20}
          onClick={() => rows.append(blank())}
        >
          Add recipient
        </button>
        {errors.recipients?.message && (
          <p role="alert" className="text-error">
            {errors.recipients.message}
          </p>
        )}
        {(errors as Record<string, { message?: string }>)[""]?.message && (
          <p role="alert" className="text-error">
            {(errors as Record<string, { message?: string }>)[""]?.message}
          </p>
        )}
        {errors.root?.server?.message && (
          <p role="alert" className="text-error">
            {errors.root.server.message}
          </p>
        )}
        {error && (
          <p role="alert" className="text-body-sm text-error">
            {error}
          </p>
        )}
        <button type="submit" className={buttonClass}>
          {form.formState.isSubmitting ? "Saving…" : "Save Split"}
        </button>
      </fieldset>
    </form>
  );
}
