import { implementationLabel } from "@/lib/flows/implementation";
import { shortAddr } from "@/lib/utils";
import { stellarExpertContractUrl, type StellarNetwork } from "@/lib/stellar/explorer";

export type MonitoredPipelineNode = {
  nodeId: string;
  contractAddress: string;
  templateKind: string;
  implementation?: unknown;
};

export default function PipelineImplementations({
  pipeline,
  network,
}: {
  pipeline: MonitoredPipelineNode[];
  network: StellarNetwork | null;
}) {
  const seen = new Set<string>();
  const contracts = pipeline.filter((node) => {
    if (!node.contractAddress || seen.has(node.contractAddress)) return false;
    seen.add(node.contractAddress);
    return true;
  });
  if (!contracts.length) return null;
  return (
    <details className="glass-panel p-md rounded-xl">
      <summary className="text-on-surface cursor-pointer">Where blocks run</summary>
      <ul className="mt-3 space-y-3">
        {contracts.map((node) => {
          const label = implementationLabel(node.implementation);
          const url = network ? stellarExpertContractUrl(node.contractAddress, network) : null;
          return (
            <li
              key={node.contractAddress}
              className="flex flex-wrap items-baseline justify-between gap-2"
            >
              <span className="text-on-surface text-sm">{label ?? node.templateKind}</span>
              <span className="text-on-surface-variant font-mono text-xs">
                {url ? (
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-primary"
                  >
                    {shortAddr(node.contractAddress)}
                  </a>
                ) : (
                  shortAddr(node.contractAddress)
                )}
                {!label && <span className="ml-2">Block associations unavailable</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
