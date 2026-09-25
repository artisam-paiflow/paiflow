import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import RaftLog from "@/components/builder/raft-log";

describe("RaftLog collapsed tab", () => {
  // jsdom has no layout, so it leaves this out; the chat scrolls to its foot on mount.
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("shows the tab while collapsed", () => {
    render(<RaftLog messages={[]} onSend={vi.fn()} collapsed />);
    expect(screen.getByTitle("Open AI chat")).toBeTruthy();
  });

  // A phone's docked sheet covers the tab's corner; hidden, it leaves the tab order.
  it("renders no tab when hideTab is set", () => {
    render(<RaftLog messages={[]} onSend={vi.fn()} collapsed hideTab />);
    expect(screen.queryByTitle("Open AI chat")).toBeNull();
  });
});
