import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import DevModeToggle from "@/components/builder/dev-mode-toggle";

const track = vi.hoisted(() => vi.fn());
vi.mock("@/lib/analytics/client", () => ({ track }));

describe("Dev mode toggle", () => {
  it.each([false, true])(
    "is unavailable when disabled, including a saved Dev flow (%s)",
    (value) => {
      const onChange = vi.fn();
      render(<DevModeToggle enabled={false} value={value} onChange={onChange} />);
      expect(screen.queryByRole("switch", { name: "Dev mode" })).toBeNull();
      expect(onChange).not.toHaveBeenCalled();
    },
  );

  it("allows enabling Dev mode when the feature is available", async () => {
    const onChange = vi.fn();
    render(<DevModeToggle enabled value={false} onChange={onChange} />);
    const toggle = screen.getByRole("switch", { name: "Dev mode" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    await userEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(true);
    expect(track).toHaveBeenCalledWith("off_script_feature_used", { feature: "dev_mode_on" });
  });
});
