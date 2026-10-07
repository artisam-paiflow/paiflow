import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ALL_FEATURES_ON } from "@/lib/feature-flags";
import Palette from "@/components/builder/palette";
import PaletteSidebar from "@/components/builder/palette-sidebar";

function SidebarHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <PaletteSidebar onOpenChange={setOpen}>
        <Palette
          onAdd={() => {}}
          flowNodes={[]}
          features={ALL_FEATURES_ON}
          collapsed={!open}
          onExpand={() => setOpen(true)}
        />
      </PaletteSidebar>
      <button type="button">Canvas</button>
    </>
  );
}

function openSidebar() {
  render(<SidebarHarness />);
  const sidebar = screen
    .getByRole("button", { name: "Expand sidebar" })
    .closest("aside")!.parentElement!;
  fireEvent.mouseEnter(sidebar);
  return sidebar;
}

describe("palette sidebar focus", () => {
  it("keeps a focused template visible when the pointer leaves, then closes on focus exit", async () => {
    const user = userEvent.setup();
    const sidebar = openSidebar();
    const template = screen.getByRole("button", { name: /On Receive/ });
    await user.click(template);

    fireEvent.mouseLeave(sidebar);

    expect(screen.getByRole("button", { name: /On Receive/ })).toBe(template);
    expect(document.activeElement).toBe(template);

    await user.click(screen.getByRole("button", { name: "Canvas" }));

    expect(screen.queryByRole("button", { name: /On Receive/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeTruthy();
  });

  it("closes on pointer exit when focus is outside the sidebar", () => {
    const sidebar = openSidebar();
    fireEvent.mouseLeave(sidebar);
    expect(screen.queryByRole("button", { name: /On Receive/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeTruthy();
  });

  it("stays open when keyboard focus moves between templates after pointer exit", async () => {
    const user = userEvent.setup();
    const sidebar = openSidebar();
    await user.click(screen.getByRole("button", { name: /On Receive/ }));
    fireEvent.mouseLeave(sidebar);
    await user.tab();

    expect(document.activeElement).toBe(screen.getByRole("button", { name: /On Schedule/ }));
    expect(screen.queryByRole("button", { name: "Expand sidebar" })).toBeNull();
  });

  it("stays open when focus leaves but the pointer still hovers over the sidebar", async () => {
    const user = userEvent.setup();
    const sidebar = openSidebar();
    const matches = vi.spyOn(sidebar, "matches").mockReturnValue(true);
    await user.click(screen.getByRole("button", { name: /On Receive/ }));
    await user.click(screen.getByRole("button", { name: "Canvas" }));

    expect(matches).toHaveBeenCalledWith(":hover");
    expect(screen.getByRole("button", { name: /On Receive/ })).toBeTruthy();
    matches.mockRestore();

    fireEvent.mouseLeave(sidebar);
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeTruthy();
  });
});
