import { describe, expect, it } from "vitest";
import { requestEndpoint } from "@/lib/api/request-history/schema";
import { eventProperties } from "@/lib/analytics/event-policy";
describe("Schedule endpoint allowlists", () => {
  it.each([
    "state",
    ...["pause", "resume", "retrieve"].flatMap((a) => [a, `${a}/submit`, `${a}/reconcile`]),
  ])("keeps %s through history and telemetry", (suffix) => {
    const endpoint = requestEndpoint(`/api/v1/deployments/deployment/schedule/${suffix}`);
    expect(endpoint).toBe(`/api/v1/deployments/:id/schedule/${suffix}`);
    expect(eventProperties("api_request_completed", { endpoint })).toEqual({ endpoint });
  });
  it("rejects arbitrary action and identifiers from telemetry", () => {
    expect(requestEndpoint("/api/v1/deployments/id/schedule/cancel")).toBe(
      "/api/v1/deployments/:id/:unknown",
    );
    expect(
      eventProperties("api_request_completed", {
        endpoint: "/api/v1/deployments/id/schedule/pause",
      }),
    ).toEqual({});
  });
});
