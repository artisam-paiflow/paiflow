import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  NotificationSettings,
  NotificationSettingsDialog,
  RecipientEmailField,
} from "@/components/builder/notification-settings";
import type { FlowGraph } from "@/lib/flows/schema";

afterEach(cleanup);
function Settings({ email = "" }: { email?: string }) {
  const [value, setValue] = useState<NonNullable<FlowGraph["notify"]>>({
    mode: "every_transaction",
    sendTo: email,
  });
  return <NotificationSettings value={value} onChange={setValue} />;
}
describe("notification fields", () => {
  it("uses the decided option labels and allows an empty Send to", () => {
    render(<Settings />);
    expect(screen.getByRole("option", { name: "Only when a deposit falls short" })).toBeTruthy();
    expect(screen.getByText("Add an email to get notified")).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "Send to" }) as HTMLInputElement).required).toBe(
      false,
    );
  });
  it("pre-fills the supplied account email", () => {
    render(<Settings email="account@example.com" />);
    expect((screen.getByRole("textbox", { name: "Send to" }) as HTMLInputElement).value).toBe(
      "account@example.com",
    );
  });
  it("supports keyboard edits and changing the mode", async () => {
    const user = userEvent.setup();
    render(<Settings />);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("combobox", { name: "Notify me" }));
    await user.selectOptions(screen.getByRole("combobox"), "shortfalls_only");
    await user.tab();
    await user.keyboard("owner@example.com");
    expect((screen.getByRole("textbox", { name: "Send to" }) as HTMLInputElement).value).toBe(
      "owner@example.com",
    );
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("shortfalls_only");
  });
  it("shows a connected inline error for invalid recipient email", () => {
    render(<RecipientEmailField value="wrong" onChange={() => {}} />);
    const input = screen.getByRole("textbox", { name: "Recipient email (optional)" });
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(input.getAttribute("aria-describedby")!)?.textContent).toContain(
      "valid email",
    );
  });
  it("does not mark an empty recipient field required or invalid", () => {
    render(<RecipientEmailField onChange={() => {}} />);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.required).toBe(false);
    expect(input.getAttribute("aria-invalid")).toBe("false");
  });
});

describe("notification settings dialog", () => {
  it("focuses its heading and handles Close and Escape without testing ConfigPanel", async () => {
    const previous = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value() {
        this.setAttribute("open", "");
      },
    });
    try {
      const onClose = vi.fn();
      const user = userEvent.setup();
      render(
        <NotificationSettingsDialog
          value={{ mode: "off", sendTo: "" }}
          onChange={() => {}}
          onClose={onClose}
        />,
      );
      const heading = screen.getByRole("heading", { name: "Email notifications" });
      expect(document.activeElement).toBe(heading);
      expect(screen.getByRole("dialog", { name: "Email notifications" })).toBeTruthy();
      await user.click(screen.getByRole("button", { name: "Close" }));
      expect(onClose).toHaveBeenCalledTimes(1);
      fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
      expect(onClose).toHaveBeenCalledTimes(2);
    } finally {
      if (previous) Object.defineProperty(HTMLDialogElement.prototype, "showModal", previous);
      else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
    }
  });
});
