import type { ExecutionAdditionalRecipient, PaiflowDeployment } from "@paiflow/sdk";

/** Trusted-server example for a known, owned policy-aware deployment. The owner
 * configured constant platform terms when deploying; callers never send them as
 * overrides. The payer later signs through your existing wallet boundary.
 *
 * Persist the returned preparation, intent/hash, request key and history metadata
 * before asking for that signature. Do not rebuild on an unknown outcome. See
 * payment-server.ts/payment-browser.ts for application ownership and consent
 * boundaries. Keep signed XDR ephemeral; use the original intent/hash for recovery.
 */
export async function prepareVariableRecipient(input: {
  deployment: PaiflowDeployment;
  payNodeId: string;
  payer: string;
  recipient: string;
  amountStroops: string;
  paymentKey: string;
}) {
  return input.deployment.execute.prepare(
    {
      from: input.payer,
      amount: input.amountStroops,
      arguments: {
        version: 1,
        inputs: [{ kind: "pay", nodeId: input.payNodeId, recipient: input.recipient }],
      },
    },
    { idempotencyKey: input.paymentKey },
  );
}

/** Works only if this immutable Split policy declares an additional execution
 * roster. Every configured row is omitted: constant recipient/share/fee survives.
 * Percentage workers must fill the remaining bps; fixed workers must fill the
 * exact per-hop incoming amount minus configured fixed amounts. The server and
 * contracts validate the final total, duplicates, modes and resource bounds.
 */
export async function prepareWorkerRoster(input: {
  deployment: PaiflowDeployment;
  splitNodeId: string;
  payer: string;
  amountStroops: string;
  workers: ExecutionAdditionalRecipient[];
  paymentKey: string;
}) {
  return input.deployment.execute.prepare(
    {
      from: input.payer,
      amount: input.amountStroops,
      arguments: {
        version: 1,
        inputs: [
          {
            kind: "split",
            nodeId: input.splitNodeId,
            rows: [],
            additionalRecipients: input.workers,
          },
        ],
      },
    },
    { idempotencyKey: input.paymentKey },
  );
}
