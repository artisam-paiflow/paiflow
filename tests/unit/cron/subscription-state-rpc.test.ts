// Admission/retirement is exercised with real PostgreSQL in retirement.test.ts.
// This suite isolates its existing domain behavior from that service boundary.
vi.mock("@/lib/deployments/service-route", () => ({
  deploymentServiceRoute: (handler: unknown) => handler,
}));
vi.mock("@/lib/deployments/service-work", () => ({
  assertDeploymentService: vi.fn(async () => undefined),
  withDeploymentWork: async (_id: string, _kind: string, fn: () => Promise<unknown>) => fn(),
  runDeploymentWork: async (_id: string, _kind: string, fn: () => Promise<unknown>) => fn(),
  beforeExternalRelayer: vi.fn(async () => undefined),
  observeExternalRelayer: vi.fn(async () => undefined),
  beforeServiceSubmission: vi.fn(async () => undefined),
  observeServiceTransaction: vi.fn(async () => undefined),
}));
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { Account, StrKey, nativeToScVal } from "@stellar/stellar-sdk";
import {
  relayer,
  contract,
  values,
  map,
  missingState,
} from "../stellar/subscription-state-fixtures";

const { server, db, prepare, submit } = vi.hoisted(() => ({
  server: { getAccount: vi.fn(), simulateTransaction: vi.fn() },
  db: { deployment: { findMany: vi.fn(), update: vi.fn() } },
  prepare: vi.fn(),
  submit: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/redis", () => ({ redis: () => null }));
vi.mock("@/lib/stellar/client", () => ({
  sorobanRpc: () => server,
  decodeContractAddress: (address: string) => StrKey.decodeContract(address),
  TENANT_RELAYER_TIMEOUT_MS: 25,
}));
vi.mock("@/lib/stellar/relayer-channels", () => ({
  withRelayerChannel: (fn: (channel: unknown) => unknown) => fn({}),
}));
vi.mock("@/lib/stellar/relayer", async () => ({
  ...(await vi.importActual<typeof import("@/lib/stellar/relayer")>("@/lib/stellar/relayer")),
  prepareSubscriptionChargeByRelayerTx: prepare,
  submitSubscriptionChargeByRelayerTx: submit,
}));
beforeEach(() => {
  vi.resetAllMocks();
  vi.resetModules();
  process.env.STELLAR_RELAYER_ADDRESS = relayer;
  process.env.CONTRACT_READ_CACHE_ENABLED = "false";
  server.getAccount.mockImplementation(async () => new Account(relayer, "1"));
  db.deployment.findMany.mockResolvedValue([
    {
      id: "fixture",
      chargeEndAt: null,
      chargeRelayerMode: "PLATFORM",
      pipelineSnapshot: [
        { nodeId: "sub", contractAddress: contract, templateKind: "SUBSCRIPTION" },
      ],
    },
  ]);
  submit.mockResolvedValue({ status: "SUCCESS" });
});
afterEach(() => {
  delete process.env.STELLAR_RELAYER_ADDRESS;
  delete process.env.CONTRACT_READ_CACHE_ENABLED;
});

it.each([
  "combined",
  "legacy",
  "dev",
  "cancelled",
  "not-due",
  "outage",
  "legacy-cancelled",
  "legacy-not-due",
  "dev-cancelled",
  "dev-not-due",
])("measures actual cron %s preflight", async (mode) => {
  let charged = false;
  const snapshot = values();
  if (mode.includes("cancelled")) snapshot.is_cancelled = nativeToScVal(true);
  if (mode.includes("not-due"))
    snapshot.next_charge_at = nativeToScVal(BigInt(Math.floor(Date.now() / 1000) + 86400), {
      type: "u64",
    });
  if (mode.startsWith("dev")) {
    const rows = await db.deployment.findMany();
    rows[0].pipelineSnapshot[0].templateKind = "SUBSCRIPTION_DEV";
  }
  server.simulateTransaction.mockImplementation(async (tx) => {
    const fn = tx.operations[0].func.invokeContract().functionName().toString();
    if (mode === "outage") throw new Error("RPC down");
    if (fn === "state" && mode.startsWith("legacy")) return missingState();
    const retval =
      fn === "state"
        ? map(snapshot)
        : fn === "allowance"
          ? nativeToScVal(1000n, { type: "i128" })
          : fn === "next_charge_at" && charged
            ? nativeToScVal(BigInt(Math.floor(Date.now() / 1000) + 86400), { type: "u64" })
            : snapshot[fn as keyof typeof snapshot];
    return { _parsed: true, id: "1", latestLedger: 1, events: [], result: { retval, auth: [] } };
  });
  prepare.mockImplementation(async () => {
    const expected = mode === "combined" ? 4 : mode === "legacy" ? 16 : 14;
    expect(server.getAccount.mock.calls.length + server.simulateTransaction.mock.calls.length).toBe(
      expected,
    );
    charged = true;
    return { xdr: "fixture" };
  });
  const { POST } = await import("@/app/api/cron/auto-charge-subscriptions/route");
  const result = await (
    await POST({ headers: new Headers() } as import("next/server").NextRequest)
  ).json();
  if (mode.includes("cancelled") || mode.includes("not-due") || mode === "outage") {
    expect(prepare).not.toHaveBeenCalled();
    const reads = mode.startsWith("legacy") ? 3 : mode.startsWith("dev") ? 2 : 1;
    expect(server.getAccount).toHaveBeenCalledTimes(reads);
    expect(server.simulateTransaction).toHaveBeenCalledTimes(reads);
    expect(result.data[mode === "outage" ? "failed" : "skipped"]).toBe(1);
  } else {
    expect(result.data.platformCharged).toBe(1);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(db.deployment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ nextChargeAt: expect.any(Date) }),
      }),
    );
  }
});
