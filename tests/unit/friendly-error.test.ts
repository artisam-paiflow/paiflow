import { describe, expect, it } from "vitest";
import { apiError, friendlyError } from "@/lib/friendly-error";

describe("friendlyError", () => {
  it("maps wallet rejections", () => {
    expect(friendlyError(new Error("User declined access")).message).toBe(
      "Transaction cancelled in your wallet.",
    );
    expect(friendlyError(new Error("The request was rejected by the user")).message).toBe(
      "Transaction cancelled in your wallet.",
    );
  });

  it("maps network failures", () => {
    expect(friendlyError(new Error("Failed to fetch")).message).toMatch(/check your connection/i);
    expect(
      friendlyError(new Error("NetworkError when attempting to fetch resource")).message,
    ).toMatch(/check your connection/i);
  });

  it("passes through API error bodies and preserves details", () => {
    const body = {
      error: {
        code: "UPSTREAM_RPC",
        message: "The schedule is invalid: the end time must be after the start time.",
        details: "Soroban simulate failed: HostError: ...",
      },
    };
    const f = friendlyError(body, "Deploy failed");
    expect(f.message).toBe(body.error.message);
    expect(f.details).toBe(body.error.details);
  });

  it("uses the fallback for empty messages", () => {
    expect(friendlyError(new Error(""), "Deploy failed").message).toBe("Deploy failed");
    expect(friendlyError(undefined, "Deploy failed").message).toBe("Deploy failed");
  });

  it("translates a raw Soroban dump as a backstop and keeps it as details", () => {
    const raw =
      'Soroban simulate failed: HostError: Error(Context, InvalidAction) Event log (newest first): 0: [Diagnostic Event] contract:CBFZ7Y3GKLV5K4M5J5Y5K5J5Y5K5J5Y5K5J5Y5K5J5Y5K5J5Y5K5J5Y5K5A, topics:[error, Error(Contract, 4)], data:"escalating error to VM trap"';
    const f = friendlyError(new Error(raw));
    expect(f.message).not.toMatch(/HostError|Diagnostic Event/);
    expect(f.details).toBe(raw);
  });

  it("passes through already-friendly server messages unchanged", () => {
    const f = friendlyError(new Error("Account has 1 XLM. Minimum 2 XLM required."));
    expect(f.message).toBe("Account has 1 XLM. Minimum 2 XLM required.");
    expect(f.details).toBeUndefined();
  });

  it("does not misclassify contract rejections as wallet rejections", () => {
    const f = friendlyError(new Error("The contract rejected this action."));
    expect(f.message).toBe("The contract rejected this action.");
  });
});

describe("apiError", () => {
  it("builds an Error that carries details through catches", () => {
    const body = {
      error: { message: "Friendly message", details: "raw dump" },
    };
    const err = apiError(body, "fallback");
    expect(err.message).toBe("Friendly message");
    // Round-trip: friendlyError surfaces the attached details again.
    const f = friendlyError(err);
    expect(f.message).toBe("Friendly message");
    expect(f.details).toBe("raw dump");
  });

  it("uses the fallback when the body has no message", () => {
    expect(apiError({}, "Prepare failed").message).toBe("Prepare failed");
    expect(apiError(null, "Prepare failed").message).toBe("Prepare failed");
  });
});
