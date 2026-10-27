import { act, fireEvent } from "@testing-library/react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveEvents, type Evt } from "@/components/deploy/live-events";

const occurredAt = "2026-10-27T23:45:12.000Z";
const paymentEvents: Evt[] = ["RECEIVE", "PAYOUT"].map((kind) => ({
  id: kind,
  eventId: `event-${kind}`,
  kind,
  ledger: 1234567,
  txHash: "synthetic-transaction",
  payload: null,
  decodedData: { amount: "10000000", from: "synthetic-sender", recipient: "synthetic-recipient" },
  occurredAt,
}));

afterEach(() => vi.restoreAllMocks());

describe("stored deployment event hydration", () => {
  it.each([
    ["en-PH", "Asia/Manila"],
    ["de-DE", "America/New_York"],
  ])("hydrates UTC server history in a %s / %s browser", async (locale, timeZone) => {
    const events: Evt[] = [
      ...paymentEvents,
      {
        ...paymentEvents[0]!,
        id: "schedule-update",
        eventId: "event-schedule-update",
        kind: "STATUS_CHANGE",
        payload: { topics: ["schedule_updated"] },
        decodedData: { startTime: "1793144712", endTime: "1793231112" },
      },
    ];
    // Delegate to the real Intl formatter, with distinct server/browser defaults.
    let browser = false;
    vi.spyOn(Date.prototype, "toLocaleTimeString").mockImplementation(function (this: Date) {
      return new Intl.DateTimeFormat(browser ? locale : "en-US", {
        timeZone: browser ? timeZone : "UTC",
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
      }).format(this);
    });
    vi.spyOn(Date.prototype, "toLocaleString").mockImplementation(function (this: Date) {
      return new Intl.DateTimeFormat(browser ? locale : "en-US", {
        timeZone: browser ? timeZone : "UTC",
        dateStyle: "medium",
        timeStyle: "medium",
      }).format(this);
    });
    const originalNumberFormat = Number.prototype.toLocaleString;
    vi.spyOn(Number.prototype, "toLocaleString").mockImplementation(function (
      this: number,
      locales,
      options,
    ) {
      return originalNumberFormat.call(this, locales ?? (browser ? locale : "en-US"), options);
    });
    const container = document.createElement("div");
    document.body.append(container);
    container.innerHTML = renderToString(<LiveEvents events={events} network="testnet" />);
    expect(container.textContent).toContain("23:45:12 UTC");
    browser = true;
    const onRecoverableError = vi.fn();
    let root: Root | undefined;
    try {
      await act(async () => {
        root = hydrateRoot(container, <LiveEvents events={events} network="testnet" />, {
          onRecoverableError,
        });
      });
      expect(onRecoverableError).not.toHaveBeenCalled();
      expect(container.querySelectorAll("li")).toHaveLength(3);
      expect(container.textContent).toContain(new Date(occurredAt).toLocaleTimeString());
      expect(container.textContent).toContain("ledger #1,234,567");
      for (const seconds of [1793144712, 1793231112]) {
        expect(container.textContent).toContain(new Date(seconds * 1000).toLocaleString());
      }
      const timestamp = container.querySelector("time")!;
      expect(timestamp.dateTime).toBe(occurredAt);
      expect(timestamp.title).toBe(`${occurredAt} (UTC)`);
      const expand = container.querySelector<HTMLButtonElement>('button[title="Expand"]')!;
      fireEvent.click(expand);
      expect(container.textContent).toContain(new Date(occurredAt).toLocaleString());
      expect(container.textContent).toContain("SSE · LIVE");
    } finally {
      await act(async () => root?.unmount());
      container.remove();
    }
  });
});
