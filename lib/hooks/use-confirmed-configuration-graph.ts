"use client";
import { useEffect, useState } from "react";
import type { FlowGraph } from "@/lib/flows/schema";
import { hasMutablePolicies } from "@/lib/flows/execution-v1";
import { ExecutionDiscoverySchema } from "@/lib/api/v1/execution-schema";
import { projectConfirmedGraph } from "@/lib/mutations/graph";

/** Refresh on events and periodically for direct-chain updates. An unavailable
 * current observation hides stale terms rather than falling back to the graph. */
export function useConfirmedConfigurationGraph(
  deploymentId: string,
  initial: FlowGraph | null,
  eventTick: number,
) {
  const mutable = !!initial && hasMutablePolicies(initial);
  const [observation, setObservation] = useState<{
    deploymentId: string;
    graph: FlowGraph;
    ledger: number;
  } | null>(null);
  useEffect(() => {
    if (!mutable || !initial) return;
    let stopped = false,
      inFlight = false,
      controller: AbortController | undefined;
    const refresh = async () => {
      if (inFlight) return;
      inFlight = true;
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 30000);
      try {
        const response = await fetch(`/api/deployments/${deploymentId}/configuration`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error();
        const body = await response.json();
        const {
          admin: _admin,
          mutationSupported: _supported,
          obligations: _obligations,
          ...discovery
        } = body.data;
        const current = ExecutionDiscoverySchema.parse(discovery);
        if (!current.supported || current.deploymentId !== deploymentId) throw new Error();
        const graph = projectConfirmedGraph(initial, current.configurations);
        if (!stopped)
          setObservation((previous) =>
            previous &&
            previous.deploymentId === deploymentId &&
            previous.ledger > current.confirmedLedger
              ? previous
              : { deploymentId, graph, ledger: current.confirmedLedger },
          );
      } catch {
        if (!stopped) setObservation(null);
      } finally {
        clearTimeout(timeout);
        inFlight = false;
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 15000);
    return () => {
      stopped = true;
      clearInterval(timer);
      controller?.abort();
    };
  }, [deploymentId, initial, mutable, eventTick]);
  const observed = observation?.deploymentId === deploymentId ? observation : null;
  return {
    graph: mutable ? (observed?.graph ?? null) : initial,
    configurationLedger: mutable ? (observed?.ledger ?? null) : null,
    configurationUnavailable: mutable && !observed,
  };
}
