import { ReadOnlyDeploymentCanvas } from "@/components/deploy/deployment-canvas";
import type { PublicEmbedData } from "@/lib/deployments/public-embed";
import { stellarExpertContractUrl, stellarExpertTxUrl } from "@/lib/stellar/explorer";
import { formatStroops } from "@/lib/utils";

/** Public viewing has no owner controls, credential props, or private API reads. */
export default function PublicDeploymentView({ data }: { data: PublicEmbedData }) {
  const explorerUrl = data.network
    ? stellarExpertContractUrl(data.contractAddress, data.network)
    : null;
  return (
    <div className="space-y-6">
      <section className="glass-panel p-md rounded-xl">
        <h1 className="text-headline-sm text-on-surface">Deployment</h1>
        <p className="text-label-sm text-on-surface-variant mt-2 font-mono">
          {data.network?.toUpperCase() ?? "NETWORK UNKNOWN"} · CONFIRMED
        </p>
        {explorerUrl ? (
          <a
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary mt-2 block font-mono text-xs break-all"
          >
            {data.contractAddress}
          </a>
        ) : (
          <p className="mt-2 font-mono text-xs break-all">{data.contractAddress}</p>
        )}
      </section>
      <ReadOnlyDeploymentCanvas graph={data.graph} />
      <section className="glass-panel p-md rounded-xl">
        <h2 className="text-headline-sm text-on-surface">Recent activity</h2>
        <p className="text-label-sm text-on-surface-variant mt-2">
          Refresh this page for the latest recorded activity.
        </p>
        <ul className="mt-md max-h-96 space-y-3 overflow-y-auto">
          {data.initialEvents.length === 0 && <li>No recorded activity yet.</li>}
          {data.initialEvents.map((event) => (
            <li
              key={event.eventId}
              className="border-outline-variant/30 rounded border p-3 font-mono text-xs"
            >
              <span>
                {event.kind} · ledger #{event.ledger}
              </span>
              {event.amountStroops !== undefined && (
                <span> · amount {formatStroops(event.amountStroops)}</span>
              )}
              <time dateTime={event.occurredAt} className="text-on-surface-variant mt-1 block">
                {event.occurredAt}
              </time>
              {data.network ? (
                <a
                  href={stellarExpertTxUrl(event.txHash, data.network)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary mt-1 block break-all"
                >
                  {event.txHash}
                </a>
              ) : (
                <span className="mt-1 block break-all">{event.txHash}</span>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
