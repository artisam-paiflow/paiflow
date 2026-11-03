import type { InstanceCompiledTerms } from "@/lib/flow-instances/compiled-review-schema";

const labels: Record<string, string> = {
  asset: "Asset",
  assetIn: "Input asset",
  assetOut: "Output asset",
  recipient: "Recipient (full address or pinned pipeline node)",
  recipients: "Recipients and allocations (full addresses)",
  amountStroops: "Payment amount (integer stroops)",
  amountPerIntervalStroops: "Amount per interval (integer stroops)",
  amountPerPeriodStroops: "Amount per period (integer stroops)",
  minAmountStroops: "Minimum amount (integer stroops)",
  percentageBps: "Payment share (basis points; 10000 = 100%)",
  subscriber: "Subscriber (full address)",
  relayer: "Relayer (full address)",
  pauseAllowed: "Pause allowed",
  retrieveAllowed: "Retrieval allowed",
  nextStepNodeIds: "Next pipeline nodes",
  pathANodeIds: "True branch nodes",
  pathBNodeIds: "False branch nodes",
  beforeNodeIds: "Before-deadline nodes",
  afterNodeIds: "At/after-deadline nodes",
  mode: "Payout / release mode",
  fullAmount: "Full incoming amount",
  fieldPolicy: "Lifetime field policy",
  initialAdditionalRecipients: "Initial additional recipients (full addresses)",
  condition: "Condition",
  threshold: "Threshold",
  signers: "Signers (full addresses)",
  slippageBps: "Slippage (basis points)",
  deadlineSecs: "Swap deadline (seconds)",
  router: "Swap router (full address)",
  vault: "Vault (full address)",
  executionNodeId: "Execution root node",
};
const date = (seconds: number) =>
  `${new Date(seconds * 1000).toISOString()} (${seconds} Unix seconds)`;
/** Read only persisted admission values. Never run the compiler or use today's clock here. */
export default function CompiledTerms({ terms }: { terms: InstanceCompiledTerms }) {
  return (
    <section aria-label="Admitted compiled contract terms" className="space-y-4">
      <h5 className="font-semibold">Admitted compiled contract terms</h5>
      <p className="text-sm">
        These original deployment terms are verified against the exact saved unsigned transaction,
        including its final router and relayer authority bindings. Dates below are the actual
        compiled agreement window, which can differ from the saved exemplar. They remain the same on
        reload. They describe initial configuration, not current mutable state.
      </p>
      {terms.map((node) => (
        <section
          key={node.nodeId}
          aria-label={`Compiled ${node.nodeId}`}
          className="border-outline-variant/40 space-y-3 rounded border p-3"
        >
          <h6 className="font-semibold">
            {node.nodeId} · {node.templateKind}
          </h6>
          <dl className="space-y-3 text-sm">
            {Object.entries(node.params)
              .filter(([key]) => key !== "kind")
              .map(([key, value]) => {
                const label =
                  key === "startTs"
                    ? "Agreement start (UTC)"
                    : key === "endTs"
                      ? "Agreement end (UTC)"
                      : key === "intervalSeconds"
                        ? "Payment interval (seconds)"
                        : key === "unlockTime"
                          ? "Unlock / branch deadline (UTC)"
                          : (labels[key] ?? key);
                const rendered =
                  (key === "startTs" || key === "endTs" || key === "unlockTime") &&
                  typeof value === "number"
                    ? date(value)
                    : typeof value === "object" && value !== null
                      ? JSON.stringify(value, null, 2)
                      : typeof value === "boolean"
                        ? value
                          ? "Yes"
                          : "No"
                        : String(value);
                return (
                  <div key={key}>
                    <dt className="text-on-surface-variant">{label}</dt>
                    <dd className="mt-1 font-mono text-xs break-all whitespace-pre-wrap">
                      {rendered || "No stored value; see the declared runtime policy"}
                    </dd>
                  </div>
                );
              })}
          </dl>
        </section>
      ))}
    </section>
  );
}
