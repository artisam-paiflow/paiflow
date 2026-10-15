import { describe, expect, it } from "vitest";
import { ApiDailyReportSchema } from "@/lib/api/request-history/daily-schema";

const input = {
  start: "2026-10-13",
  end: "2026-10-15",
  network: "testnet",
  audience: "EXTERNAL",
  environment: "beta",
};
describe("daily API report windows", () => {
  it("accepts whole UTC dates beyond raw-history retention", () => {
    expect(ApiDailyReportSchema.parse({ ...input, start: "2025-01-01" }).start).toBe("2025-01-01");
  });
  it.each([
    { start: "2026-02-30" },
    { start: "2026-99-99" },
    { start: "2026-10-13T00:00:00+08:00" },
    { start: "2026-10-15" },
    { end: "2026-10-12" },
    { start: "1900-01-01" },
    { network: "other" },
    { audience: "people" },
    { environment: "" },
    { extra: true },
  ])("rejects invalid or ambiguous report scope %j", (patch) => {
    expect(ApiDailyReportSchema.safeParse({ ...input, ...patch }).success).toBe(false);
  });
});
