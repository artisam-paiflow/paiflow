import { afterEach, expect, it, vi } from "vitest";
import { PostHog, type CaptureResult } from "posthog-js";
import { browserEvent, type BrowserContext } from "@/lib/analytics/browser-policy";
import { CONTROL_SELECTORS } from "@/lib/analytics/policy";
const context = {
  account_id: "",
  caller_type: "wallet",
  audience: "UNCLASSIFIED",
  stellar_network: "testnet",
  app_env: "local",
  app_version: "dev",
  app_host: "localhost",
  tracking_version: "usage-v2",
};
afterEach(() => {
  document.body.replaceChildren();
  window.history.replaceState({}, "", "/");
  vi.restoreAllMocks();
});
function sdk(initialContext: BrowserContext = context) {
  const captured: CaptureResult[] = [];
  let activeContext = initialContext;
  const ph = new PostHog();
  // Suppress transmission after the SDK applies before_send, leaving its final
  // envelope available for assertions (rather than returning null from the hook).
  const requests = vi.spyOn(XMLHttpRequest.prototype, "send").mockImplementation(() => {});
  ph.init("phc_policy_test", {
    api_host: "/ingest",
    api_transport: "XHR",
    disable_compression: true,
    persistence: "memory",
    bootstrap: { distinctID: "synthetic-anonymous-id", isIdentifiedID: false },
    request_batching: false,
    advanced_disable_decide: true,
    disable_external_dependency_loading: true,
    capture_pageview: false,
    capture_pageleave: false,
    capture_exceptions: false,
    disable_session_recording: true,
    person_profiles: "identified_only",
    capture_dead_clicks: false,
    mask_all_text: true,
    mask_all_element_attributes: false,
    autocapture: {
      css_selector_allowlist: CONTROL_SELECTORS,
      element_allowlist: ["button", "a"],
      dom_event_allowlist: ["click"],
      element_attribute_ignorelist: ["aria-label", "title", "href", "value", "name"],
    },
    before_send: (event) => {
      const clean = event
        ? browserEvent(event, window.location.pathname, activeContext, "phc_policy_test")
        : null;
      if (clean) captured.push(clean);
      return clean;
    },
  });
  ph.opt_in_capturing();
  return {
    ph,
    captured,
    requests,
    setContext: (value: BrowserContext) => {
      activeContext = value;
    },
  };
}
it("lets actual SDK DOM capture identify an approved button without transmitting its content", () => {
  window.history.replaceState({}, "", "/dashboard");
  const { ph, captured, requests } = sdk();
  const panel = document.createElement("div");
  panel.setAttribute("data-private", "PRIVATE ANCESTOR");
  const button = document.createElement("button");
  button.dataset.analyticsControl = "new-flow";
  button.textContent = "PRIVATE TEXT";
  button.setAttribute("aria-label", "PRIVATE LABEL");
  button.setAttribute("title", "PRIVATE TITLE");
  panel.append(button);
  document.body.append(panel);
  button.click();
  expect(captured).toHaveLength(1);
  expect(captured[0]).toMatchObject({ properties: { control_id: "new-flow" } });
  expect(JSON.stringify(captured)).not.toContain("PRIVATE");
  expect(JSON.stringify(requests.mock.calls)).not.toContain("PRIVATE");
  expect(requests).toHaveBeenCalled();
  const unrelated = document.createElement("button");
  unrelated.textContent = "PRIVATE ACCOUNT";
  panel.append(unrelated);
  unrelated.click();
  expect(captured).toHaveLength(1);
  ph.opt_out_capturing();
});

it("sanitizes SDK initial/current URLs, campaign/referrer and all top-level person properties", () => {
  window.history.replaceState(
    {},
    "",
    "/login?ticket=SYNTHETIC_QUERY_MARKER&utm_campaign=PRIVATE_CAMPAIGN",
  );
  const { ph, captured, requests, setContext } = sdk();
  const account = "00000000-0000-0000-0000-000000000001";
  window.history.replaceState({}, "", "/dashboard?token=PRIVATE_CURRENT");
  setContext({ ...context, account_id: account, caller_type: "session", audience: "EXTERNAL" });
  ph.identify(account, { role: "USER", username: "PRIVATE_USERNAME" }, { note: "PRIVATE_NOTE" });
  const identified = captured.find((event) => event.event === "$identify");
  expect(identified).toMatchObject({
    $set: { role: "USER" },
    $set_once: {},
    properties: { $process_person_profile: true },
  });
  expect(JSON.stringify(captured)).not.toMatch(
    /PRIVATE|SYNTHETIC_QUERY_MARKER|\$current_url|\$initial_/,
  );
  expect(JSON.stringify(requests.mock.calls)).not.toMatch(/PRIVATE|SYNTHETIC_QUERY_MARKER/);

  const address = `G${"B".repeat(55)}`;
  ph.setPersonProperties({ wallet_address: address, arbitrary: { deep: "PRIVATE_DEEP" } });
  expect(captured.at(-1)).toMatchObject({ properties: { $set: { wallet_address: address } } });
  const final = ph.capture(
    "$set",
    {},
    {
      $set: { role: ["USER"], password: "PRIVATE_PASSWORD" },
      $unset: ["role", "PRIVATE_UNSET"],
    },
  );
  expect(final).toMatchObject({ $set: {}, $unset: ["role"] });
  expect(ph.capture("$set", { $unset: ["role", "PRIVATE_UNSET"] })).toMatchObject({
    properties: { $unset: ["role"] },
  });
  expect(JSON.stringify(requests.mock.calls)).not.toContain("PRIVATE");
  ph.opt_out_capturing();
});

it("keeps anonymous events personless and permits profiles only after session identity synchronization", () => {
  window.history.replaceState({}, "", "/dashboard");
  const { ph, setContext } = sdk();
  expect(ph.capture("$pageview")?.properties.$process_person_profile).toBe(false);
  const account = "00000000-0000-0000-0000-000000000001";
  setContext({ ...context, account_id: account, caller_type: "session", audience: "INTERNAL" });
  ph.identify(account);
  expect(ph.capture("$pageview")?.properties.$process_person_profile).toBe(true);
  ph.reset();
  setContext(context);
  expect(ph.capture("$pageview")?.properties.$process_person_profile).toBe(false);
  ph.opt_out_capturing();
});
