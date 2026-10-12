"use client";

import { useState } from "react";
import type { DeploymentCapabilities } from "@/lib/api/v1/schema";

const TRIGGER_GUIDANCE = {
  deposit:
    "Prepare a deposit, sign with the paying wallet, then submit the signed transaction. Standard flows use their configured recipients.",
  webhook:
    "Call the webhook when your application event happens. Use the webhook secret for callbacks and a deployment API token to track the resulting payment.",
  subscription:
    "The configured subscriber approves an allowance with their wallet. Scheduled charges use that allowance; approval does not immediately make a payment.",
  payroll:
    "Payroll uses the employer’s allowance and its payroll workflow. Manage approval and runs with the payroll controls in the deployment overview.",
  schedule:
    "Fund the stream using the deployment overview. Scheduled payments follow its configured timing and relayer workflow.",
  oracle: "This flow runs when its configured relayer reports a value that meets the condition.",
  unknown:
    "The trigger could not be identified from the deployment snapshot. Check the deployment before attempting to run it.",
} satisfies Record<DeploymentCapabilities["triggerType"], string>;

const OPERATION_LABELS = {
  execute: "Prepare and submit a payment",
  events: "Read payment events",
  balances: "Read contract balances",
  transactions: "Check transaction status",
  releaseEarly: "Release a timelock early",
  payouts: "Prepare a payment with a recipient",
  webhook: "Trigger a webhook",
  subscriptionAllowance: "Approve a subscription allowance",
  swapQuote: "Estimate a deployed Swap output",
  scheduleState: "Read current Schedule state",
  scheduleControls: "Control Schedule with its wallet",
  subscriptionState: "Read current subscription state",
  subscriptionCancel: "Cancel a subscription with the subscriber wallet",
  subscriptionReactivate: "Reactivate a subscription with the subscriber wallet",
} satisfies Record<keyof DeploymentCapabilities["operations"], string>;

const AUTH_LABELS = {
  deployment_token: "Deployment API token",
  webhook_secret: "Webhook secret",
  subscriber_wallet: "Subscriber wallet",
};

export function deploymentTokenExample(
  deploymentId: string,
  capabilities: DeploymentCapabilities | null,
  origin: string,
  token: string,
) {
  const base = `${origin}/api/v1/deployments/${deploymentId}`;
  if (capabilities?.operations.execute.status === "supported") {
    return `curl -X POST '${base}/execute' \\\n  -H 'Authorization: Bearer ${token}' \\\n  -H 'Content-Type: application/json' \\\n  -d '{"from":"G_PAYING_WALLET_ADDRESS","amount":"10000000"}'`;
  }
  return `curl '${base}/events' \\\n  -H 'Authorization: Bearer ${token}'`;
}

export default function ApiOperationGuide({
  deploymentId,
  capabilities,
  webhookSecret,
  origin,
  copy,
}: {
  deploymentId: string;
  capabilities: DeploymentCapabilities | null;
  webhookSecret: string | null;
  origin: string;
  copy: (value: string) => Promise<void>;
}) {
  const [secretVisible, setSecretVisible] = useState(false);
  if (!capabilities) {
    return (
      <p className="text-label-md text-on-surface-variant mt-md">
        API operation guidance is unavailable because this deployment is on a different network from
        this environment. Open it in the matching environment to use its API.
      </p>
    );
  }
  const webhookUrl = `${origin}/api/webhooks/${deploymentId}`;
  const webhookEnabled = capabilities.operations.webhook.status === "supported";
  const webhookExample = `curl -X POST '${webhookUrl}' \\\n  -H 'x-webhook-secret: YOUR_WEBHOOK_SECRET' \\\n  -H 'Idempotency-Key: reward-event-123' \\\n  -H 'Content-Type: application/json' \\\n  -d '{"escrow":true,"amount":"10000000"}'`;
  const tokenExample = deploymentTokenExample(deploymentId, capabilities, origin, "YOUR_API_TOKEN");
  const supported = (Object.keys(OPERATION_LABELS) as Array<keyof typeof OPERATION_LABELS>).filter(
    (key) => capabilities.operations[key].status !== "unsupported",
  );
  return (
    <div className="mt-md space-y-4" data-testid="api-operation-guide">
      <p className="text-body-md text-on-surface">{TRIGGER_GUIDANCE[capabilities.triggerType]}</p>
      <p className="text-label-sm text-on-surface-variant">
        These operations reflect the deployment snapshot. Balances, consent and current readiness
        are checked when you use them. Event collection can lag; a missing event or UNKNOWN
        transaction status does not prove failure.
      </p>
      {webhookEnabled && (
        <div className="border-outline-variant/30 rounded-lg border p-3">
          <h3 className="text-label-md text-on-surface font-semibold">Webhook callback</h3>
          <p className="text-label-sm text-on-surface-variant mt-1">
            Authenticate with x-webhook-secret. A deployment API token cannot authorize this
            callback.
          </p>
          <div className="mt-3 min-w-0">
            <span className="text-label-sm text-on-surface-variant">Webhook URL</span>
            <div className="mt-1 flex items-start gap-2">
              <code className="text-on-surface min-w-0 flex-1 text-sm break-all">{webhookUrl}</code>
              <button
                type="button"
                onClick={() => void copy(webhookUrl)}
                className="text-primary shrink-0 text-sm"
              >
                Copy URL
              </button>
            </div>
          </div>
          {webhookSecret ? (
            <div className="ph-no-capture mt-3" data-testid="webhook-secret">
              <span className="text-label-sm text-on-surface-variant">Webhook secret</span>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <code className="text-on-surface min-w-0 basis-full text-sm break-all sm:flex-1 sm:basis-0">
                  {secretVisible ? webhookSecret : "••••••••••••••••"}
                </code>
                <button
                  type="button"
                  onClick={() => setSecretVisible(!secretVisible)}
                  aria-expanded={secretVisible}
                  className="text-primary text-sm"
                >
                  {secretVisible ? "Hide secret" : "Show secret"}
                </button>
                <button
                  type="button"
                  onClick={() => void copy(webhookSecret)}
                  className="text-primary text-sm"
                >
                  Copy secret
                </button>
              </div>
            </div>
          ) : null}
          <p className="text-label-sm text-on-surface-variant mt-3">
            Fund the reward pool first using the deployment overview. This example requests one unit
            of the input asset: amount is in stroops (10000000 is one unit). Set it to your intended
            reward amount; omitting amount or using "0" releases the entire available pool.
            Non-escrow callbacks require the source account’s signed authorization.
          </p>
          <CodeExample label="Escrow reward callback" value={webhookExample} copy={copy} />
          <p className="text-label-sm text-on-surface-variant mt-3">
            Replace the secret placeholder and use a unique key for each application event. Retry
            the same event with the same key and payload. A changed payload returns a conflict;
            unkeyed callbacks can each pay again. For PENDING or UNKNOWN, keep the original key and
            check the original transaction hash when available. An interrupted preparation can
            remain UNKNOWN without a hash and need operator investigation.
          </p>
        </div>
      )}
      {capabilities.operations.subscriptionAllowance.status !== "unsupported" && (
        <a
          href={`/allowance/${deploymentId}`}
          className="text-primary inline-block text-sm underline"
        >
          Open subscriber allowance approval
        </a>
      )}
      <CodeExample
        label={
          capabilities.operations.execute.status === "supported"
            ? "Prepare a payment"
            : "Read payment events"
        }
        value={tokenExample}
        copy={copy}
      />
      {capabilities.operations.execute.status === "supported" && (
        <p className="text-label-sm text-on-surface-variant">
          Replace the wallet placeholder. Amount is in stroops of the input asset (10000000 is one
          unit). Sign the returned XDR with that wallet using the returned network passphrase, then
          POST {'{"signedXdr":"YOUR_SIGNED_XDR"}'} to{" "}
          <code className="break-all">/api/v1/deployments/{deploymentId}/execute/submit</code>. A
          deployment token alone cannot sign a deposit.
        </p>
      )}
      <div>
        <h3 className="text-label-md text-on-surface font-semibold">Available operations</h3>
        <div className="mt-2 space-y-2">
          <details className="border-outline-variant/20 rounded-lg border p-3">
            <summary className="text-on-surface cursor-pointer text-sm">
              Read deployment capabilities · Deployment API token
            </summary>
            <p className="text-on-surface-variant mt-2 text-sm">
              GET <code className="break-all">/api/v1/deployments/{deploymentId}/capabilities</code>{" "}
              to discover supported operations and prerequisites from your backend. This reads the
              deployment snapshot and does not verify live readiness or return credentials.
            </p>
          </details>
          {supported.map((key) => {
            const operation = capabilities.operations[key];
            return (
              <details key={key} className="border-outline-variant/20 rounded-lg border p-3">
                <summary className="text-on-surface cursor-pointer text-sm">
                  {OPERATION_LABELS[key]} · {AUTH_LABELS[operation.authentication]}
                  {operation.status === "conditional" ? " · Requires eligibility checks" : ""}
                </summary>
                {key === "balances" && (
                  <p className="text-on-surface-variant mt-2 text-sm">
                    GET{" "}
                    <code className="break-all">/api/v1/deployments/{deploymentId}/balances</code>{" "}
                    to read held contract funds. Check freshness and totalsComplete; unknown
                    balances are not zero. Contract balances are not Schedule payout availability or
                    proof of a successful payment. Poll no faster than every 10 seconds.
                  </p>
                )}
                {key === "transactions" && (
                  <p className="text-on-surface-variant mt-2 text-sm">
                    GET{" "}
                    <code className="break-all">
                      /api/v1/deployments/{deploymentId}/transactions/{"{txHash}"}
                    </code>{" "}
                    with the original transaction hash. Only transactions attributable to this
                    deployment can be read; a 404 does not prove payment failure.
                  </p>
                )}
                <ul className="text-on-surface-variant mt-2 list-disc space-y-1 pl-5 text-sm">
                  {operation.requirements.map((requirement) => (
                    <li key={requirement}>{requirement}</li>
                  ))}
                </ul>
              </details>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function CodeExample({
  label,
  value,
  copy,
}: {
  label: string;
  value: string;
  copy: (value: string) => Promise<void>;
}) {
  return (
    <div className="mt-3 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-label-sm text-on-surface-variant">{label}</span>
        <button
          type="button"
          onClick={() => void copy(value)}
          aria-label={`Copy ${label.toLowerCase()} example`}
          className="text-primary shrink-0 text-sm"
        >
          Copy example
        </button>
      </div>
      <pre
        tabIndex={0}
        role="region"
        aria-label={`${label} command`}
        className="text-on-surface bg-surface-container-lowest mt-1 overflow-x-auto rounded p-3 font-mono text-xs"
      >
        {value}
      </pre>
    </div>
  );
}
