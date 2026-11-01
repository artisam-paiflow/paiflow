import { describe, expect, it } from "vitest";
import { Networks, xdr } from "@stellar/stellar-sdk";
import capture from "@/docs/evidence/2026-11-01-stellar-network-settings.json";

describe("dated public network settings evidence (no live requests)", () => {
  it.each(capture.networks)(
    "decodes the actual $network XDR rather than trusting prose summaries",
    (network) => {
      expect(capture.observedAtStartUtc).toBe("2026-11-01T10:05:02.563Z");
      const identity = network.results.find((entry) => entry.request.method === "getNetwork")!
        .response.result;
      expect(identity.protocolVersion).toBe(29);
      expect(identity.passphrase).toBe(
        network.network === "testnet" ? Networks.TESTNET : Networks.PUBLIC,
      );
      const ledger = network.results.find((entry) => entry.request.method === "getLedgerEntries")!;
      const entries = ledger.response.result.entries!;
      expect(entries).toHaveLength(4);
      for (const entry of entries) {
        const key = xdr.LedgerKey.fromXDR(entry.key, "base64");
        const setting = xdr.LedgerEntryData.fromXDR(entry.xdr, "base64").configSetting();
        expect(key.configSetting().configSettingId().value).toBe(setting.switch().value);
        switch (setting.switch().value) {
          case 0:
            expect(setting.contractMaxSizeBytes()).toBe(131_072);
            break;
          case 1:
            expect(setting.contractCompute().txMaxInstructions().toString()).toBe("400000000");
            expect(setting.contractCompute().txMemoryLimit()).toBe(41_943_040);
            break;
          case 4:
            expect(setting.contractEvents().txMaxContractEventsSizeBytes()).toBe(16_384);
            break;
          case 5:
            expect(setting.contractBandwidth().txMaxSizeBytes()).toBe(132_096);
            break;
          default:
            throw new Error("Unexpected captured configuration entry");
        }
      }
    },
  );
});
