import { describe, expect, it } from "vitest";
import { browserProperties, validateBrowserContext } from "@/lib/analytics/browser-policy";
import { analyticsRoute, audienceFor } from "@/lib/analytics/policy";
import { eventProperties } from "@/lib/analytics/event-policy";
import { redactDeep } from "@/lib/analytics/client";
const context = {
  account_id: "",
  caller_type: "wallet",
  audience: "UNCLASSIFIED",
  stellar_network: "testnet",
  app_env: "local",
  app_version: "dev",
  app_host: "localhost:3000",
  tracking_version: "usage-v2",
};
const control = { tag_name: "button", "attr__data-analytics-control": "new-flow" };
describe("future capture policy", () => {
  it.each(["$autocapture", "$dead_click", "$rageclick"])(
    "allows only the approved control for %s",
    (name) => {
      const input = {
        $event_type: "click",
        $el_text: "PRIVATE USER",
        $current_url: "https://app/account?token=secret",
        $elements: [
          {
            ...control,
            $el_text: "PRIVATE USER",
            "attr__aria-label": "private",
            attr__title: "secret",
            attr__href: "/reset?token=secret",
          },
          { tag_name: "div", "attr__data-secret": "private ancestor" },
        ],
        unexpected: { deep: "secret" },
      };
      const captured = browserProperties(name, input, "/dashboard", context);
      expect(captured).toMatchObject({
        control_id: "new-flow",
        route: "/dashboard",
        $geoip_disable: true,
        $ip: null,
      });
      expect(JSON.stringify(captured)).not.toMatch(
        /PRIVATE|private|secret|aria-label|href|title|elements/,
      );
    },
  );
  it.each(["$autocapture", "$dead_click", "$rageclick"])(
    "blocks sensitive and unapproved controls for %s",
    (name) => {
      const input = { $event_type: "click", $elements: [control] };
      for (const path of ["/account", "/account/address-book", "/admin/users", "/unknown/name"])
        expect(browserProperties(name, input, path, context)).toBeNull();
      expect(
        browserProperties(
          name,
          { $event_type: "click", $elements: [{ tag_name: "input" }, control] },
          "/dashboard",
          context,
        ),
      ).toBeNull();
      expect(
        browserProperties(
          name,
          {
            $event_type: "click",
            $elements: [{ tag_name: "div", "attr__data-analytics-control": "new-flow" }],
          },
          "/dashboard",
          context,
        ),
      ).toBeNull();
      expect(
        browserProperties(
          name,
          {
            $event_type: "click",
            $elements: [{ ...control, "attr__data-analytics-control": "account-details" }],
          },
          "/dashboard",
          context,
        ),
      ).toBeNull();
    },
  );
  it("supports the SDK's serialized element chain without copying it into analytics", () => {
    const chain =
      'button.text-label-md.bg-primary:attr__data-analytics-control="new-flow"attr__title="private"nth-child="1";div:attr__aria-label="private ancestor"';
    expect(
      browserProperties(
        "$autocapture",
        { $event_type: "click", $elements_chain: chain },
        "/dashboard",
        context,
      ),
    ).toMatchObject({ control_id: "new-flow" });
    expect(
      JSON.stringify(
        browserProperties(
          "$autocapture",
          { $event_type: "click", $elements_chain: chain },
          "/dashboard",
          context,
        ),
      ),
    ).not.toContain("private");
    const ancestor = 'button:nth-child="1";div:attr__data-analytics-control="new-flow"';
    expect(
      browserProperties(
        "$autocapture",
        { $event_type: "click", $elements_chain: ancestor },
        "/dashboard",
        context,
      ),
    ).toBeNull();
    const injected = 'button:text="attr__data-analytics-control=\\"new-flow\\""nth-child="1"';
    expect(
      browserProperties(
        "$autocapture",
        { $event_type: "click", $elements_chain: injected },
        "/dashboard",
        context,
      ),
    ).toBeNull();
  });
  it("drops unknown events, snapshots, raw exceptions and server business events from the browser", () => {
    for (const name of [
      "unknown",
      "$snapshot",
      "$exception",
      "wallet_connect_succeeded",
      "transaction_outcome",
      "trigger_succeeded",
    ])
      expect(browserProperties(name, {}, "/dashboard", context)).toBeNull();
    expect(browserProperties("$pageview", {}, "/dashboard", null)).toBeNull();
  });
  it("retains explicit builder/error events without arbitrary messages or graph/form data", () => {
    expect(
      eventProperties("node_added", {
        node_type: "split",
        graph: { secret: "x" },
        username: "PRIVATE",
      }),
    ).toEqual({ node_type: "split" });
    expect(
      eventProperties("error_shown", {
        error_class: "user_rejected",
        error_code: "SOME_PRIVATE_NAME",
        message_key: "PRIVATE USER failed",
      }),
    ).toEqual({
      error_class: "user_rejected",
      error_code: "UNKNOWN",
      message_key: "structured_error",
    });
    expect(
      eventProperties("exception_captured", {
        stage: "runtime",
        error_class: "network",
        error_code: null,
        frames: ["/_next/static/chunks/app-abc.js:1:25", "https://private/name?token=secret"],
      }),
    ).toMatchObject({ frames: ["/_next/static/chunks/app-abc.js:1:25"] });
  });
  it("preserves positive integer canonical outcome revisions and blocks them in the browser", () => {
    expect(
      eventProperties("transaction_outcome", { outcome: "ACCEPTED", outcome_revision: 3 }),
    ).toEqual({ outcome: "ACCEPTED", outcome_revision: 3 });
    for (const value of [0, -1, 1.5, "3", Number.MAX_SAFE_INTEGER + 1])
      expect(eventProperties("transaction_outcome", { outcome_revision: value })).toEqual({});
    expect(
      browserProperties(
        "transaction_outcome",
        { outcome: "ACCEPTED", outcome_revision: 3 },
        "/dashboard",
        context,
      ),
    ).toBeNull();
  });
  it("allows signing addresses only on declared fields", () => {
    const address = `G${"B".repeat(55)}`;
    expect(
      eventProperties("transaction_signed", {
        signer_address: address,
        recipient_address: address,
        kind: "trigger",
      }),
    ).toEqual({ signer_address: address, kind: "trigger" });
  });
  it("drops deep and cyclic branches rather than returning raw references", () => {
    const value: Record<string, unknown> = { secret: "S" + "A".repeat(55) };
    value.loop = value;
    const result = redactDeep(value);
    expect(() => JSON.stringify(result)).not.toThrow();
    expect(JSON.stringify(result)).not.toContain("A".repeat(55));
  });
  it("normalizes routes and does not infer external people from roles", () => {
    expect(analyticsRoute("/deployments/00000000-0000-0000-0000-000000000001/embed")).toBe(
      "/deployments/:id/embed",
    );
    expect(analyticsRoute("/dashboard?token=private")).toBeNull();
    expect(audienceFor({ role: "USER" })).toBe("UNCLASSIFIED");
    expect(audienceFor({ role: "ADMIN" })).toBe("UNCLASSIFIED");
    expect(audienceFor({ role: "SANDBOX", analyticsAudience: "EXTERNAL" })).toBe("SANDBOX");
    expect(validateBrowserContext({ ...context, audience: "human" })).toBeNull();
  });
});
