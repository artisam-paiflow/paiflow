import type { Role } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sorobanRpc } = vi.hoisted(() => ({ sorobanRpc: vi.fn() }));
vi.mock("@/lib/stellar/client", () => ({ sorobanRpc, horizon: vi.fn() }));

const flowId = "11111111-1111-4111-8111-111111111111";
const flowKey = "STELLAR_DEPLOY_RECONCILIATION_REHEARSAL_FLOW_ID";
const expiryKey = "STELLAR_DEPLOY_RECONCILIATION_REHEARSAL_UNTIL";
const now = new Date("2026-10-06T08:00:00Z");

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(now);
  delete process.env[flowKey];
  delete process.env[expiryKey];
  process.env.STELLAR_NETWORK = "testnet";
});
afterEach(() => {
  delete process.env[flowKey];
  delete process.env[expiryKey];
  delete process.env.STELLAR_NETWORK;
  vi.useRealTimers();
  vi.resetModules();
});
async function enabled(role: Role = "ADMIN", network = "testnet", id = flowId) {
  const { isDeploymentReconciliationRehearsal } =
    await import("@/lib/deployments/reconciliation-rehearsal");
  return isDeploymentReconciliationRehearsal({ flowId: id, network }, role);
}
function configure() {
  process.env[flowKey] = flowId;
  process.env[expiryKey] = "2026-10-06T08:30:00Z";
}

describe("expiring deployment recovery rehearsal", () => {
  it.each([undefined, ""])("is disabled with %s configuration", async (value) => {
    if (value !== undefined) {
      process.env[flowKey] = value;
      process.env[expiryKey] = value;
    }
    expect(await enabled()).toBe(false);
  });
  it("only enables the selected admin-owned testnet flow", async () => {
    configure();
    expect(await enabled()).toBe(true);
    expect(await enabled("USER")).toBe(false);
    expect(await enabled("SANDBOX")).toBe(false);
    expect(await enabled("ADMIN", "mainnet")).toBe(false);
    expect(await enabled("ADMIN", "testnet", "22222222-2222-4222-8222-222222222222")).toBe(false);
  });
  it("expires even when env() is already memoized", async () => {
    configure();
    expect(await enabled()).toBe(true);
    vi.setSystemTime(new Date(process.env[expiryKey]!));
    expect(await enabled()).toBe(false);
  });
  it("permits restarting with an expired setting but keeps the rehearsal off", async () => {
    configure();
    process.env[expiryKey] = "2026-10-06T07:59:59Z";
    expect(await enabled()).toBe(false);
  });
  it("refuses mainnet configuration", async () => {
    configure();
    process.env.STELLAR_NETWORK = "mainnet";
    await expect(enabled()).rejects.toThrow(/testnet-only/);
  });
  it("refuses reconciliation-only submission on mainnet before touching RPC", async () => {
    process.env.STELLAR_NETWORK = "mainnet";
    const { submitDeployTx } = await import("@/lib/stellar/deploy");
    await expect(submitDeployTx("unused", { confirmation: "reconcile" })).rejects.toThrow(
      /testnet-only/,
    );
    expect(sorobanRpc).not.toHaveBeenCalled();
  });
  it.each([flowKey, expiryKey])("refuses missing %s", async (key) => {
    configure();
    delete process.env[key];
    await expect(enabled()).rejects.toThrow(/configured together/);
  });
  it.each([
    [flowKey, "not-a-uuid"],
    [expiryKey, "tomorrow"],
    [expiryKey, "2026-10-06T09:00:01Z"],
  ])("refuses malformed or overlong %s=%s", async (key, value) => {
    configure();
    process.env[key!] = value;
    await expect(enabled()).rejects.toThrow();
  });
});
