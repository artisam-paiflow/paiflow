import { AsyncLocalStorage } from "node:async_hooks";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import http from "node:http";
import https from "node:https";
import { format } from "prettier";
import { Account, Address, nativeToScVal } from "@stellar/stellar-sdk";
import { afterEach, expect, it, vi } from "vitest";
import type { BalanceDeployment } from "@/lib/stellar/balances";
const state = vi.hoisted(() => ({
  rpc: {} as Record<string, unknown>,
  db: {} as Record<string, unknown>,
}));
vi.mock("@/lib/stellar/client", () => ({
  sorobanRpc: () => state.rpc,
  decodeContractAddress: (value: string) => new Address(value).toBuffer(),
}));
vi.mock("@/lib/db", () => ({ db: state.db }));
vi.mock("@/lib/redis", () => ({ redis: () => null }));
vi.mock("@/lib/log", () => ({ log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/flow-notifications", () => ({
  sendEmailNotificationsForTransactions: async () => {},
}));
const START = Date.parse("2026-10-06T00:00:00Z");
const DURATION = 600_000;
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const contract = (n: number) => Address.contract(Buffer.alloc(32, n)).toString();
const wallet = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const reports: unknown[] = [];
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
});
for (const shared of [false, true])
  for (const latencyMs of [350, 3_000])
    for (const activeLimit of [2, 4]) {
      it(`mixed traffic shared=${shared} latency=${latencyMs} batches=${activeLimit}`, async () => {
        vi.resetModules();
        const { ENV_VAR_NAMES } = await import("@/lib/env");
        for (const name of ENV_VAR_NAMES) vi.stubEnv(name, undefined);
        vi.stubEnv("AUTH_SECRET", "synthetic-dashboard-workload-auth-32chars");
        vi.stubEnv("DATABASE_URL", "postgresql://unused:unused@127.0.0.1:1/unused");
        vi.stubEnv("NODE_ENV", "test");
        vi.stubEnv("LOG_LEVEL", "silent");
        vi.useFakeTimers();
        vi.setSystemTime(START);
        let externalRequests = 0;
        const forbidden = () => {
          externalRequests++;
          throw new Error("Network forbidden in local synthetic rehearsal");
        };
        vi.spyOn(globalThis, "fetch").mockImplementation(forbidden);
        for (const transport of [http, https]) {
          vi.spyOn(transport, "request").mockImplementation(forbidden);
          vi.spyOn(transport, "get").mockImplementation(forbidden);
        }
        const context = new AsyncLocalStorage<string>();
        const calls: Record<string, number> = {};
        const successes: Record<string, number> = {};
        let activeRpc = 0,
          peakRpc = 0,
          activeDashboardRpc = 0,
          peakDashboardRpc = 0;
        let rejectedRpc = 0;
        async function rpcCall() {
          const source = context.getStore() ?? "other";
          calls[source] = (calls[source] ?? 0) + 1;
          activeRpc++;
          peakRpc = Math.max(peakRpc, activeRpc);
          if (source === "balances") {
            activeDashboardRpc++;
            peakDashboardRpc = Math.max(peakDashboardRpc, activeDashboardRpc);
          }
          try {
            await pause(latencyMs);
            // Inject one minute of outage, followed by recovery; no inferred provider cap.
            if (Date.now() - START >= 120_000 && Date.now() - START < 180_000) {
              rejectedRpc++;
              throw new Error("Injected outage");
            }
            successes[source] = (successes[source] ?? 0) + 1;
          } finally {
            activeRpc--;
            if (source === "balances") activeDashboardRpc--;
          }
        }
        state.rpc = {
          getAccount: async () => {
            await rpcCall();
            return new Account(wallet, "100");
          },
          simulateTransaction: async () => {
            await rpcCall();
            return { result: { retval: nativeToScVal(100n) } };
          },
          getHealth: async () => {
            await rpcCall();
            return {
              oldestLedger: 1,
              latestLedger: Math.floor((Date.now() - START) / 5_000) + 100,
            };
          },
          getEvents: async () => {
            await rpcCall();
            return { events: [], latestLedger: Math.floor((Date.now() - START) / 5_000) + 100 };
          },
        };
        const graph = {
          nodes: [
            { id: "t", type: "on_receive", config: { asset: { kind: "native" } } },
            {
              id: "p",
              type: "pay",
              config: {
                asset: { kind: "native" },
                recipient: wallet,
                amountStroops: "100",
                mode: "fixed",
              },
            },
          ],
          edges: [{ id: "tp", source: "t", target: "p" }],
        };
        const fixtures = Array.from({ length: 100 }, (_, n) => ({
          id: `d${n}`,
          ownerId: `owner${n}`,
          status: "CONFIRMED",
          sourceAccount: wallet,
          contractAddress: contract(n + 1),
          graphSnapshot: graph,
          pipelineSnapshot: Array.from({ length: 10 }, (_, k) => ({
            nodeId: `p${k}`,
            contractAddress: contract(((n + k) % 250) + 1),
            templateKind: k < 8 ? "PAYER" : "DEPOSIT_TRIGGER",
          })),
          cursor: { lastLedger: 99 },
          flow: { templateKind: "PAYER" },
        }));
        Object.assign(state.db, {
          deployment: {
            findUnique: async ({ where }: { where: { id: string } }) =>
              fixtures.find((f) => f.id === where.id),
          },
          eventCursor: {
            updateMany: async ({
              where,
              data,
            }: {
              where: { deploymentId: string };
              data: { lastLedger: number };
            }) => {
              const fixture = fixtures.find((f) => f.id === where.deploymentId)!;
              fixture.cursor.lastLedger = Math.max(fixture.cursor.lastLedger, data.lastLedger);
              return { count: 1 };
            },
          },
        });
        const { getWorkflowBalances } = await import("@/lib/stellar/balances");
        const { createDashboardBalanceCache } =
          await import("@/lib/stellar/dashboard-balance-cache");
        const { createDashboardBalanceAdmission } =
          await import("@/lib/stellar/dashboard-balance-admission");
        const { createBalanceRefreshScheduler } =
          await import("@/lib/hooks/balance-refresh-scheduler");
        const { pollEventsForWithOutcome } = await import("@/lib/stellar/events");
        const admission = createDashboardBalanceAdmission({ activeLimit });
        const cache = createDashboardBalanceCache({
          load: (deployment, signal) =>
            admission.run(() => getWorkflowBalances(deployment, signal), signal),
        });
        const environment = { network: "testnet", rpcUrl: "https://synthetic.invalid" };
        let endpointReads = 0,
          overloads = 0,
          partial = 0;
        const ages: number[] = [],
          latency: number[] = [];
        const work = new Set<Promise<unknown>>();
        function launch(source: string, fn: () => Promise<unknown>) {
          const promise = context
            .run(source, fn)
            .catch(() => {})
            .finally(() => work.delete(promise));
          work.add(promise);
        }
        const tabs = Array.from({ length: 10 }, (_, n) => {
          const deployment = fixtures[shared ? 0 : n]! as unknown as BalanceDeployment & {
            ownerId: string;
            status: string;
          };
          let seed = n;
          return createBalanceRefreshScheduler(
            async () => {
              endpointReads++;
              const began = Date.now();
              try {
                const value = await context.run("balances", () =>
                  cache.read(deployment, environment),
                );
                latency.push(Date.now() - began);
                for (const target of value.freshness.targets)
                  if (target.readAt) ages.push(Date.now() - Date.parse(target.readAt));
                if (value.freshness.status !== "fresh") {
                  partial++;
                  return { retryMs: 0 };
                }
              } catch {
                overloads++;
                return { retryMs: 5_000 };
              }
            },
            () => ((seed++ * 37) % 100) / 100,
          );
        });
        tabs.forEach((tab) => tab.setVisible(true));
        let eventComplete = 0,
          eventFailed = 0,
          transactions = 0,
          automation = 0;
        const timers = [
          setInterval(() => {
            const n = Math.floor((Date.now() - START) / 6_000) % 10;
            cache.invalidate("testnet", fixtures[shared ? 0 : n]!.id, `tx${Date.now()}`);
            for (const tab of shared ? tabs : [tabs[n]!]) for (let k = 0; k < 5; k++) tab.request();
          }, 6_000),
          setInterval(
            () =>
              launch("events", async () => {
                // Six workers, matching the integrated event cron's concurrency.
                let index = 0;
                await Promise.all(
                  Array.from({ length: 6 }, async () => {
                    while (index < fixtures.length) {
                      const result = await pollEventsForWithOutcome(fixtures[index++]!.id);
                      if (result.status === "complete") eventComplete++;
                      else eventFailed++;
                    }
                  }),
                );
              }),
            60_000,
          ),
          setInterval(
            () =>
              launch("transactions", async () => {
                await rpcCall();
                await rpcCall();
                await rpcCall();
                transactions++;
              }),
            12_000,
          ),
          setInterval(
            () =>
              launch("automation", async () => {
                await rpcCall();
                await rpcCall();
                await rpcCall();
                automation++;
              }),
            30_000,
          ),
        ];
        await vi.advanceTimersByTimeAsync(DURATION);
        const cursorAges = fixtures.map(
          (f) =>
            Math.max(0, Math.floor((Date.now() - START) / 5_000) + 100 - f.cursor.lastLedger) *
            5_000,
        );
        const backlogAtEnd = work.size;
        timers.forEach(clearInterval);
        tabs.forEach((tab) => tab.stop());
        await vi.advanceTimersByTimeAsync(120_000);
        expect(work.size).toBe(0);
        expect(activeRpc).toBe(0);
        expect(externalRequests).toBe(0);
        expect(peakDashboardRpc).toBeLessThanOrEqual(activeLimit * 2);
        expect(admission.stats()).toMatchObject({ active: 0, queued: 0 });
        const percentile = (values: number[], fraction: number) =>
          [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * fraction) - 1)] ??
          0;
        reports.push({
          shared,
          latencyMs,
          activeLimit,
          endpointReads,
          calls,
          successes,
          rejectedRpc,
          overloads,
          partial,
          peakRpc,
          peakDashboardRpc,
          admission: admission.stats(),
          cache: cache.stats(),
          balanceAgeP95Ms: percentile(ages, 0.95),
          endpointLatencyP95Ms: percentile(latency, 0.95),
          eventComplete,
          eventFailed,
          eventCursorAgeMaxMs: Math.max(...cursorAges),
          transactions,
          automation,
          backlogAtEnd,
          backlogAfterDrain: work.size,
          externalRequests,
        });
      });
    }
it("writes synthetic evidence", async () => {
  await writeFile(
    "docs/evidence/dashboard-balance-workload.json",
    await format(
      JSON.stringify(
        {
          measuredAt: new Date().toISOString(),
          sourceSha256: Object.fromEntries(
            await Promise.all(
              [
                "tests/rehearsal/dashboard-balance-workload.test.ts",
                "lib/hooks/balance-refresh-scheduler.ts",
                "lib/stellar/dashboard-balance-admission.ts",
                "lib/stellar/dashboard-balance-cache.ts",
                "lib/stellar/balances.ts",
                "lib/stellar/balance.ts",
                "lib/stellar/events.ts",
              ].map(async (path) => [
                path,
                createHash("sha256")
                  .update(await readFile(path))
                  .digest("hex"),
              ]),
            ),
          ),
          environment: "virtual-time; mocked RPC/DB; no live traffic",
          durationMs: DURATION,
          pipelines: 100,
          contractsPerPipeline: 10,
          targetsPerDashboard: 8,
          visibleTabs: 10,
          outageMs: [120_000, 180_000],
          reports,
        },
        null,
        2,
      ),
      { parser: "json" },
    ),
  );
});
