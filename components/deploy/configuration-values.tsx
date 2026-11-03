"use client";
import type { ConfirmedNodeConfiguration } from "@/lib/flows/field-policies";
import type { Asset, FlowGraph } from "@/lib/flows/schema";
import { bpsToPct, pctToBps, assetLabel } from "@/lib/flows/schema";
import { formatStroops } from "@/lib/utils";
import { Field } from "@/components/builder/inputs/field";
import { AmountInput } from "@/components/builder/inputs/amount-input";
import { ShareInput } from "@/components/builder/inputs/share-input";
import { inputClass } from "@/components/builder/inputs/styles";
import { AdditionalRecipientsEditor } from "@/components/builder/panels/additional-recipients-editor";

function amount(
  value:
    | { kind: "fixed"; amountStroops: string }
    | { kind: "percentage"; bps: number }
    | { kind: "full" },
  asset?: Asset,
) {
  return value.kind === "full"
    ? "Full incoming amount"
    : value.kind === "percentage"
      ? `${bpsToPct(value.bps)}%`
      : `${formatStroops(value.amountStroops)} ${asset ? assetLabel(asset) : "tokens"} (${value.amountStroops} stroops)`;
}
export function ConfigurationValues({
  values,
  asset,
  onChange,
  disabled = false,
  revisionLabel,
}: {
  values: ConfirmedNodeConfiguration[];
  asset?: Asset;
  onChange?: (values: ConfirmedNodeConfiguration[]) => void;
  disabled?: boolean;
  revisionLabel?: string;
}) {
  function edit(index: number, change: (node: ConfirmedNodeConfiguration) => void) {
    const next = structuredClone(values);
    change(next[index]!);
    onChange?.(next);
  }
  return (
    <div className="space-y-4">
      {values.map((snapshot, index) => {
        const policy = snapshot.policy,
          config = snapshot.configuration;
        return (
          <fieldset
            key={snapshot.nodeId}
            disabled={disabled}
            className="border-outline-variant/50 space-y-2 rounded border p-3"
          >
            <legend className="px-1 font-medium">
              {config.kind === "pay" ? "Pay" : "Split"} {snapshot.nodeId} ·{" "}
              {revisionLabel ?? (onChange ? "expected revision" : "revision")} {snapshot.revision}
            </legend>
            <p className="font-mono text-xs break-all">{snapshot.contractAddress}</p>
            {config.kind === "pay" && policy.kind === "pay" ? (
              <>
                {onChange && policy.recipient === "mutable" ? (
                  <Field label={`Recipient for ${snapshot.nodeId}`}>
                    {(control) => (
                      <input
                        {...control}
                        className={inputClass}
                        value={config.recipient ?? ""}
                        autoComplete="off"
                        onChange={(e) =>
                          edit(index, (n) => {
                            if (n.configuration.kind === "pay")
                              n.configuration.recipient = e.target.value;
                          })
                        }
                      />
                    )}
                  </Field>
                ) : (
                  <p className="text-sm break-all">
                    Recipient ({policy.recipient}):{" "}
                    {config.recipient ?? "Supplied by the payer for each payment"}
                  </p>
                )}
                {onChange &&
                policy.payoutValue === "mutable" &&
                config.payoutValue.kind === "fixed" ? (
                  <AmountInput
                    label={`Amount for ${snapshot.nodeId}`}
                    asset={asset}
                    commit="draft"
                    value={config.payoutValue.amountStroops}
                    onChange={(amountStroops) =>
                      edit(index, (n) => {
                        if (n.configuration.kind === "pay")
                          n.configuration.payoutValue = { kind: "fixed", amountStroops };
                      })
                    }
                  />
                ) : onChange &&
                  policy.payoutValue === "mutable" &&
                  config.payoutValue.kind === "percentage" ? (
                  <ShareInput
                    label={`Percentage for ${snapshot.nodeId}`}
                    value={config.payoutValue.bps}
                    onChange={(bps) =>
                      edit(index, (n) => {
                        if (n.configuration.kind === "pay")
                          n.configuration.payoutValue = { kind: "percentage", bps };
                      })
                    }
                  />
                ) : (
                  <p className="text-sm">
                    Payout ({policy.payoutValue}): {amount(config.payoutValue, asset)}
                  </p>
                )}
              </>
            ) : config.kind === "split" && policy.kind === "split" ? (
              <>
                <p className="text-sm">
                  Distribution mode: {policy.allocationMode}. Configured rows keep their identity
                  and order.
                </p>
                {config.configuredRows.map((row, rowIndex) => {
                  const declared = policy.rows[rowIndex]!;
                  return (
                    <div
                      key={row.rowId}
                      className="border-outline-variant/30 space-y-2 border-t pt-2"
                    >
                      <p className="text-sm">Configured row {row.rowId}</p>
                      {onChange && declared.recipient === "mutable" ? (
                        <Field label={`Recipient for ${snapshot.nodeId} ${row.rowId}`}>
                          {(control) => (
                            <input
                              {...control}
                              className={inputClass}
                              value={row.recipient ?? ""}
                              autoComplete="off"
                              onChange={(e) =>
                                edit(index, (n) => {
                                  if (n.configuration.kind === "split")
                                    n.configuration.configuredRows[rowIndex]!.recipient =
                                      e.target.value;
                                })
                              }
                            />
                          )}
                        </Field>
                      ) : (
                        <p className="text-sm break-all">
                          Recipient ({declared.recipient}):{" "}
                          {row.recipient ?? "Supplied by the payer for each payment"}
                        </p>
                      )}
                      {onChange &&
                      declared.allocation === "mutable" &&
                      row.allocation?.kind === "fixed" ? (
                        <AmountInput
                          label={`Amount for ${snapshot.nodeId} ${row.rowId}`}
                          asset={asset}
                          commit="draft"
                          value={row.allocation.amountStroops}
                          onChange={(amountStroops) =>
                            edit(index, (n) => {
                              if (n.configuration.kind === "split")
                                n.configuration.configuredRows[rowIndex]!.allocation = {
                                  kind: "fixed",
                                  amountStroops,
                                };
                            })
                          }
                        />
                      ) : onChange &&
                        declared.allocation === "mutable" &&
                        row.allocation?.kind === "percentage" ? (
                        <ShareInput
                          label={`Share for ${snapshot.nodeId} ${row.rowId}`}
                          value={row.allocation.bps}
                          onChange={(bps) =>
                            edit(index, (n) => {
                              if (n.configuration.kind === "split")
                                n.configuration.configuredRows[rowIndex]!.allocation = {
                                  kind: "percentage",
                                  bps,
                                };
                            })
                          }
                        />
                      ) : (
                        <p className="text-sm">
                          Allocation ({declared.allocation}):{" "}
                          {row.allocation
                            ? amount(row.allocation, asset)
                            : "Supplied by the payer for each payment"}
                        </p>
                      )}
                    </div>
                  );
                })}
                {onChange && policy.additionalRecipients === "mutable" ? (
                  <AdditionalRecipientsEditor
                    mode={policy.allocationMode}
                    value={config.additionalRecipients}
                    asset={asset}
                    max={20 - config.configuredRows.length}
                    reservedIds={config.configuredRows.map((r) => r.rowId)}
                    reservedRecipients={config.configuredRows.flatMap((r) =>
                      r.recipient ? [r.recipient] : [],
                    )}
                    onChange={(rows) =>
                      edit(index, (n) => {
                        if (n.configuration.kind === "split")
                          n.configuration.additionalRecipients = rows;
                      })
                    }
                  />
                ) : (
                  <div className="text-sm">
                    <p>Appended roster: {policy.additionalRecipients}</p>
                    {config.additionalRecipients.map((r) => (
                      <p className="break-all" key={r.rowId}>
                        {r.rowId}: {r.recipient} · {amount(r.allocation, asset)}
                      </p>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <p role="alert">Configuration does not match its declared node.</p>
            )}
          </fieldset>
        );
      })}
    </div>
  );
}

export function InitialConfigurationValues({ graph }: { graph: FlowGraph }) {
  return (
    <details className="border-outline-variant/50 rounded border p-3">
      <summary className="min-h-11 cursor-pointer">Initial deployment snapshot</summary>
      <p className="text-on-surface-variant mb-2 text-sm">
        Original authored values and lifetime modes. These are retained evidence, not current stored
        values.
      </p>
      {graph.nodes.map((node) =>
        node.type === "pay" ? (
          <div key={node.id} className="mb-3 text-sm">
            <p>Pay {node.id}</p>
            <p className="break-all">Initial recipient: {node.config.recipient || "Payer input"}</p>
            <p>
              Initial payout:{" "}
              {node.config.fullAmount
                ? "Full incoming amount"
                : node.config.mode === "percentage"
                  ? `${bpsToPct(pctToBps(node.config.percentage ?? 0))}%`
                  : `${node.config.amountStroops ?? "0"} stroops`}
            </p>
          </div>
        ) : node.type === "split" ? (
          <div key={node.id} className="mb-3 text-sm">
            <p>Split {node.id}</p>
            {node.config.recipients.map((r, i) => (
              <p className="break-all" key={r.rowId ?? i}>
                {r.rowId ?? `Row ${i + 1}`}: {r.address || "Payer input"} ·{" "}
                {r.mode === "percentage" ? `${bpsToPct(r.bps)}%` : `${r.amountStroops} stroops`}
              </p>
            ))}
            {node.config.additionalRecipients?.map((r) => (
              <p className="break-all" key={r.rowId}>
                Initial appended {r.rowId}: {r.recipient} ·{" "}
                {amount(r.allocation, node.config.asset)}
              </p>
            ))}
          </div>
        ) : null,
      )}
      <ul className="text-sm">
        {graph.fieldPolicies?.nodes.map((p) => (
          <li key={p.nodeId}>
            {p.nodeId}:{" "}
            {p.kind === "pay"
              ? `recipient ${p.recipient}; payout ${p.payoutValue}`
              : `appended roster ${p.additionalRecipients}; ${p.rows.map((r) => `${r.rowId}: recipient ${r.recipient}, allocation ${r.allocation}`).join("; ")}`}
          </li>
        ))}
      </ul>
    </details>
  );
}
