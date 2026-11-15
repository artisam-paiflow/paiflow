import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hostedUiProtocol,
  readHostedUiRecovery,
  saveHostedUiRecovery,
  clearHostedUiRecovery,
} from "@/components/deploy/hosted-payment-protocol";
const id = "12281228-1228-4228-8228-122812281228",
  payer = "GAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQDZ7H";
const v2 = () => ({
  version: 2 as const,
  deploymentId: id,
  network: "testnet" as const,
  recoveryKey: "aa".repeat(32),
  request: { amount: "100", from: payer, arguments: { version: 2 as const, inputs: [] } },
  phase: "ownership" as const,
});
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});
describe("conditional hosted shared browser recovery boundary", () => {
  it("rejects either valid opposite generation without changing shared-key bytes", () => {
    const key = `paiflow_hosted_payment:testnet:${id}`,
      old = {
        recoveryKey: "bb".repeat(32),
        request: { amount: "100", from: payer, arguments: { version: 1, inputs: [] } },
        phase: "preparing",
      };
    localStorage.setItem(key, JSON.stringify(old));
    expect(() => readHostedUiRecovery(key, hostedUiProtocol(true, id, "testnet"))).toThrow(
      /generation/,
    );
    expect(localStorage.getItem(key)).toBe(JSON.stringify(old));
    localStorage.setItem(key, JSON.stringify(v2()));
    expect(() => readHostedUiRecovery(key, hostedUiProtocol(false, id, "testnet"))).toThrow(
      /generation/,
    );
    expect(localStorage.getItem(key)).toBe(JSON.stringify(v2()));
  });
  it.each(["version", "network", "deployment", "mixed", "xdr", "phase"])(
    "retains malformed %s records instead of fallback",
    (attack) => {
      const record: Record<string, unknown> = { ...v2() };
      if (attack === "version") record.version = 3;
      if (attack === "network") record.network = "mainnet";
      if (attack === "deployment") record.deploymentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      if (attack === "mixed")
        record.request = { ...v2().request, arguments: { version: 1, inputs: [] } };
      if (attack === "xdr") record.signedXdr = "never-store";
      if (attack === "phase") record.phase = "submitted";
      const bytes = JSON.stringify(record);
      localStorage.setItem("shared", bytes);
      expect(() => readHostedUiRecovery("shared", hostedUiProtocol(true, id, "testnet"))).toThrow();
      expect(localStorage.getItem("shared")).toBe(bytes);
    },
  );
  it("checks readback and refuses cross-tab transitions or clearing", () => {
    const protocol = hostedUiProtocol(true, id, "testnet"),
      record = v2();
    saveHostedUiRecovery("shared", record, protocol, null);
    const changed = { ...record, request: { ...record.request, amount: "200" } };
    localStorage.setItem("shared", JSON.stringify(changed));
    expect(() =>
      saveHostedUiRecovery("shared", { ...record, phase: "preparing" }, protocol, record),
    ).toThrow(/another tab/);
    expect(() => clearHostedUiRecovery("shared", record, protocol)).toThrow(/another tab/);
    expect(JSON.parse(localStorage.getItem("shared")!).request.amount).toBe("200");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {});
    expect(() => saveHostedUiRecovery("shared", record, protocol)).toThrow(/could not be saved/);
  });
  it("retains an original if storage removal fails", () => {
    const protocol = hostedUiProtocol(true, id, "testnet"),
      record = v2();
    saveHostedUiRecovery("shared", record, protocol, null);
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {});
    expect(() => clearHostedUiRecovery("shared", record, protocol)).toThrow(/advanced safely/);
    expect(readHostedUiRecovery("shared", protocol)).toEqual(record);
  });
});
