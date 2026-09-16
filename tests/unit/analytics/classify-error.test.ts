import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { classifyError } from "@/lib/analytics/classify-error";
import { apiError } from "@/lib/friendly-error";

describe("classifyError", () => {
  it.each([
    [new Error("User declined access"), "user_rejected"],
    [new Error("The request was rejected by the user"), "user_rejected"],
    [
      apiError({
        error: {
          code: "INSUFFICIENT_FUNDS",
          message: `Account G${"A".repeat(55)} is not funded. Send at least 2 XLM to activate it first.`,
        },
      }),
      "account_unfunded",
    ],
    [
      apiError({
        error: {
          code: "INSUFFICIENT_FUNDS",
          message: "Account has 1 XLM. Minimum 2 XLM required for deployment fees and rent.",
        },
      }),
      "min_balance",
    ],
    [new Error("trustline entry is missing for account"), "trustline_missing"],
    [
      new Error(
        "Soroswap would return less than the minimum allowed by the swap's slippage setting.",
      ),
      "slippage",
    ],
    [new Error("Timed out waiting for finality"), "timeout"],
    [new Error("Failed to fetch"), "network"],
    [{ error: { code: "RATE_LIMITED", message: "Too many deploys" } }, "rate_limited"],
    [apiError({ error: { code: "UPSTREAM_RPC", message: "Deployment failed" } }), "upstream_rpc"],
    [apiError({ error: { code: "VALIDATION", message: "Flow is invalid" } }), "validation"],
    [new Error("something odd"), "unknown"],
    [null, "unknown"],
  ])("classifies %s as %s", (err, expected) => {
    expect(classifyError(err).errorClass).toBe(expected);
  });

  it("keeps the AppError code through apiError()", () => {
    const err = apiError({ error: { code: "CONFLICT", message: "Deployment is FAILED" } });
    expect(classifyError(err)).toMatchObject({ errorClass: "unknown", errorCode: "CONFLICT" });
  });

  it("builds the message key from the friendly message, without addresses", () => {
    const { messageKey } = classifyError(new Error(`Pay G${"B".repeat(55)} failed: 3 retries`));
    expect(messageKey).toBe("Pay <address> failed: # retries");
  });

  it("keys a message-less error on the caller's fallback, matching the toast", () => {
    expect(classifyError(new Error(""), "Transaction failed").messageKey).toBe(
      "Transaction failed",
    );
  });
});

describe("session replay", () => {
  // Off by decision (16 Sep 2026). homepage/privacy.html and the alpha testing
  // guide both promise that we do not record the screen, so this is a guard on
  // a published commitment rather than a preference.
  //
  // vitest runs with environment "node", so posthog.init cannot be exercised
  // here — loadAnalytics() bails without a window. The config is a literal in
  // the source, so that is what gets asserted.
  it("is disabled in the client config, and the recorder is not bundled", async () => {
    const src = await readFile(resolve(process.cwd(), "lib/analytics/client.ts"), "utf8");
    expect(src).toContain("disable_session_recording: true");
    expect(src).not.toContain("posthog-js/dist/recorder");
  });

  it("no longer exports a replay masking config", async () => {
    const mod = await import("@/lib/analytics/client");
    expect("SESSION_RECORDING" in mod).toBe(false);
  });
});
