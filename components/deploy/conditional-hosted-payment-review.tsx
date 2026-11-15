"use client";
import { conditionalDefinitionEnglish } from "@/lib/flows/conditional-canvas";
import type { ConditionalHostedPrepared } from "@/lib/hosted-execution/conditional-schema";
export default function ConditionalHostedPaymentReview({
  prepared,
  acknowledged,
  onAcknowledge,
  disabled,
}: {
  prepared: ConditionalHostedPrepared;
  acknowledged: boolean;
  onAcknowledge: (checked: boolean) => void;
  disabled: boolean;
}) {
  const execution = prepared.prepared.execution,
    condition = execution.definition.condition;
  return (
    <div className="border-outline-variant space-y-3 border-t pt-3 break-words">
      <p className="text-sm">
        The actual original payment selects {execution.selectedBranch === "true" ? "True" : "False"}{" "}
        after upstream Pay deductions: {execution.amountAtConditionStroops} stroops reaches the
        condition.
      </p>
      <p className="text-sm">
        Strict {condition.kind === "amount_gt" ? "greater than" : "less than"}{" "}
        {condition.thresholdStroops} stroops; equality takes False. Threshold is{" "}
        {condition.thresholdMode}, never a per-payment input.
      </p>
      <p className="text-sm break-all">
        Immutable deployment owner: {execution.definition.owner}. Return to owner pays this owner,
        never the payer.
      </p>
      <p className="text-xs break-all">Asset contract: {execution.definition.assetContract}</p>
      <p className="font-mono text-xs break-all">
        Original transaction: {prepared.prepared.txHash}
      </p>
      <details>
        <summary className="min-h-11 cursor-pointer">
          Both branches and complete original artifact bindings
        </summary>
        <p className="text-sm">{conditionalDefinitionEnglish(execution.definition)}</p>
        <p>
          True terminal: {execution.definition.trueBranch.nodeId} (
          {execution.definition.trueBranch.kind}). False terminal:{" "}
          {execution.definition.falseBranch.nodeId} ({execution.definition.falseBranch.kind}).
        </p>
        {execution.nodes.map((node) => (
          <p key={node.nodeId} className="font-mono text-xs break-all">
            {node.nodeId}: {node.contractAddress} · revision {node.expectedRevision} · artifact{" "}
            {node.wasmHash}
          </p>
        ))}
      </details>
      <label className="flex min-h-11 items-start gap-3 text-sm">
        <input
          type="checkbox"
          checked={acknowledged}
          disabled={disabled}
          onChange={(event) => onAcknowledge(event.target.checked)}
          className="mt-1"
        />
        I reviewed this original payment’s actual branch, full owner, amounts, destinations, fee and
        complete graph bindings.
      </label>
    </div>
  );
}
