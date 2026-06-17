"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useDocumentVisibility } from "@/lib/hooks/use-document-visibility";
import { cn, formatAmount, shortAddr } from "@/lib/utils";
import { stellarExpertContractUrl, type StellarNetwork } from "@/lib/stellar/explorer";
import type { BalanceNode, BalanceNodeError, WorkflowBalances } from "@/lib/stellar/balances";

type LiveBalancesProps = {
  deploymentId: string;
  network: StellarNetwork | null;
  refreshTick?: number;
};

function isBalanceNode(node: BalanceNode | BalanceNodeError): node is BalanceNode {
  return "balanceStroops" in node;
}

export default function LiveBalances({
  deploymentId,
  network,
  refreshTick = 0,
}: LiveBalancesProps) {
  const [balances, setBalances] = useState<WorkflowBalances>({ totals: [], nodes: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [hasFetched, setHasFetched] = useState(false);
  const [displayBalances, setDisplayBalances] = useState<WorkflowBalances>({
    totals: [],
    nodes: [],
  });
  const isVisible = useDocumentVisibility();

  useEffect(() => {
    if (!loading) {
      setDisplayBalances(balances);
    }
  }, [loading, balances]);

  useEffect(() => {
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`/api/deployments/${deploymentId}/balances`);
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: { message?: string };
          };
          throw new Error(body.error?.message ?? `HTTP ${res.status}`);
        }
        const data = (await res.json()) as WorkflowBalances;
        if (!cancelled) {
          setBalances(data);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setHasFetched(true);
        }
      }
    }

    function start() {
      load();
      interval = setInterval(load, 10_000);
    }

    function stop() {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    }

    if (isVisible) {
      start();
    }

    return () => {
      cancelled = true;
      stop();
    };
  }, [deploymentId, refreshTick, isVisible]);

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    toast.success("Copied to clipboard.");
  }

  const hasBalances = displayBalances.totals.length > 0;
  const title = displayBalances.totals.length > 1 ? "Workflow balances" : "Contract balance";

  return (
    <section className="glass-panel p-md rounded-xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-on-surface-variant">account_balance</span>
          <h2 className="text-headline-sm text-on-surface">{title}</h2>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "material-symbols-outlined text-on-surface-variant transition-opacity",
              loading && "animate-spin opacity-100",
              !loading && "opacity-60",
            )}
            aria-hidden
          >
            sync
          </span>
          {displayBalances.nodes.length > 0 && (
            <button
              onClick={() => setExpanded((e) => !e)}
              aria-expanded={expanded}
              className="text-label-sm text-on-surface-variant hover:text-primary inline-flex items-center gap-1 font-mono transition-colors"
            >
              {expanded ? "Hide breakdown" : "Show breakdown"}
              <span className="material-symbols-outlined text-[18px]">
                {expanded ? "expand_less" : "expand_more"}
              </span>
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-error-container/30 text-error mt-md border-error/30 text-body-sm rounded border px-3 py-2">
          {error}
        </div>
      )}

      {!hasBalances && !error && (hasFetched || !loading) && (
        <p className="text-body-md text-on-surface-variant mt-md">
          This workflow does not currently hold any contract balances.
        </p>
      )}

      {hasBalances && (
        <div className="mt-md flex flex-wrap gap-4">
          {displayBalances.totals.map((total) => (
            <div
              key={total.symbol}
              className={cn(
                "border-primary/20 bg-primary/5 flex items-baseline gap-2 rounded-lg border px-4 py-3",
                displayBalances.totals.length === 1 && "flex-1",
              )}
            >
              <span className="text-display-sm text-on-surface font-display font-semibold">
                {formatAmount(total.balanceStroops)}
              </span>
              <span className="text-label-md text-on-surface-variant font-mono">
                {total.symbol}
              </span>
            </div>
          ))}
        </div>
      )}

      {expanded && displayBalances.nodes.length > 0 && (
        <div className="mt-md space-y-2">
          <p className="text-label-sm text-on-surface-variant font-mono uppercase">Per contract</p>
          <div className="divide-outline-variant/40 divide-y">
            {displayBalances.nodes.map((node) => {
              const explorerUrl = network
                ? stellarExpertContractUrl(node.contractAddress, network)
                : null;
              return (
                <div
                  key={node.nodeId}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="text-label-sm text-on-surface-variant font-mono">
                      {node.templateKind}
                    </span>
                    <div className="flex items-center gap-2">
                      {explorerUrl ? (
                        <a
                          href={explorerUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-on-surface hover:text-primary inline-flex items-center gap-1 font-mono text-[12px] break-all transition-colors"
                        >
                          {shortAddr(node.contractAddress)}
                          <span className="material-symbols-outlined text-[12px]">open_in_new</span>
                        </a>
                      ) : (
                        <span className="text-on-surface font-mono text-[12px] break-all">
                          {shortAddr(node.contractAddress)}
                        </span>
                      )}
                      <button
                        onClick={() => copy(node.contractAddress)}
                        aria-label="Copy contract address"
                        title="Copy contract address"
                        className="text-on-surface-variant hover:text-primary shrink-0 transition-colors"
                      >
                        <span className="material-symbols-outlined text-[14px]">content_copy</span>
                      </button>
                    </div>
                  </div>

                  <div className="text-right">
                    {isBalanceNode(node) ? (
                      <div className="flex items-baseline justify-end gap-1.5">
                        <span className="text-body-lg text-on-surface font-medium">
                          {formatAmount(node.balanceStroops)}
                        </span>
                        <span className="text-label-sm text-on-surface-variant font-mono">
                          {node.symbol}
                        </span>
                      </div>
                    ) : (
                      <span className="text-body-sm text-error">{node.error}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
