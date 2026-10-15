import { render, screen, within } from "@testing-library/react";
import axe from "axe-core";
import { describe, expect, it } from "vitest";
import { AllocationBar } from "@/components/builder/panels/allocation-bar";

describe("AllocationBar", () => {
  it("shows recipient percentages without requiring hover, including zero allocations", async () => {
    const { container } = render(
      <AllocationBar
        recipients={[
          { address: "PENDING:alice", label: "Alice", mode: "percentage", bps: 7500 },
          { address: "PENDING:bob", mode: "percentage", bps: 2500 },
          { address: "PENDING:charlie", mode: "percentage", bps: 0 },
        ]}
      />,
    );
    const list = screen.getByRole("list", { name: "Recipient allocations" });
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Alice: 75%", "Recipient 2: 25%", "Recipient 3: 0%"]);
    expect(list.closest('[aria-hidden="true"]')).toBeNull();
    expect(list.className).not.toContain("sr-only");
    expect(container.querySelector("[title]")).toBeNull();
    expect((await axe.run(container)).violations).toEqual([]);
  });
});
