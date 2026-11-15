"use client";
import type { ConditionalDeploymentReview } from "@/lib/deployments/conditional-review-schema";
import { conditionalDefinitionEnglish } from "@/lib/flows/conditional-canvas";

export default function ConditionalDeploymentReviewPanel({
  review,
  feeStroops,
  acknowledged,
  onAcknowledge,
}: {
  review: ConditionalDeploymentReview;
  feeStroops: string;
  acknowledged: boolean;
  onAcknowledge: (value: boolean) => void;
}) {
  return (
    <section aria-label="Conditional deployment original review" className="space-y-3 break-words">
      <h3 className="font-bold">Review conditional deployment</h3>
      <p className="whitespace-pre-wrap">
        {conditionalDefinitionEnglish(review.envelope.definition)}
      </p>
      <p>
        Immutable deployment owner and Return to owner destination:{" "}
        <span className="font-mono">{review.sourceAccount}</span>
      </p>
      <p>
        Network: {review.network.toUpperCase()}. Fee: {feeStroops} stroops.
      </p>
      <p>
        Original transaction: <span className="font-mono">{review.txHash}</span>
      </p>
      <ol>
        {review.envelope.manifest.nodes.map(({ state, wasmHash }) => (
          <li key={state.nodeId} className="my-2">
            <p>
              {state.nodeId}: <span className="font-mono">{state.contractAddress}</span>
            </p>
            <p>
              Artifact: <span className="font-mono">{wasmHash}</span>. Initial revision:{" "}
              {state.revision}.
            </p>
          </li>
        ))}
      </ol>
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(event) => onAcknowledge(event.target.checked)}
        />
        I reviewed both branches, the deductions before the condition, strict comparison and
        equality taking False, field policies, owner destination and this original transaction.
      </label>
    </section>
  );
}
