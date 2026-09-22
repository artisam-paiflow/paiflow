import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AddressPicker,
  type AddressKind,
  type PinnedAddress,
} from "@/components/builder/inputs/address-picker";
import AddressInput from "@/components/builder/address-input";
import type { AddressEntry } from "@/lib/address-book.types";

// Checksummed strkeys: an account (Circle's USDC issuer) and two contracts.
const ACCOUNT = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const ACCOUNT_2 = "GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57";
const CONTRACT = "CAEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQTD2L";

const BOOK: AddressEntry[] = [
  { label: "Alice", address: ACCOUNT },
  { label: "Bob", address: ACCOUNT_2 },
];

function describedText(el: HTMLElement): string {
  return (el.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" | ");
}

async function axeViolations() {
  // The listbox is portalled to <body>, so scan the whole document; `region`
  // is a page-level rule a rendered fragment can never satisfy.
  const results = await axe.run(document.body, { rules: { region: { enabled: false } } });
  return results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.html) }));
}

function Harness({
  onChange,
  initial = "",
  ...rest
}: {
  onChange: (v: string) => void;
  initial?: string;
  accept?: AddressKind;
  commit?: "always" | "valid";
  pendingAllowed?: boolean;
  addressBook?: AddressEntry[];
}) {
  const [value, setValue] = useState(initial);
  return (
    <AddressPicker
      label="Recipient"
      value={value}
      onChange={(v) => {
        onChange(v);
        setValue(v);
      }}
      {...rest}
    />
  );
}

beforeEach(() => {
  // jsdom has no layout; the picker scrolls the highlighted row into view.
  Element.prototype.scrollIntoView = () => {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AddressPicker accept modes", () => {
  const cases: { accept: AddressKind; ok: string[]; refused: string[] }[] = [
    { accept: "account", ok: [ACCOUNT], refused: [CONTRACT, "GABC", "not an address"] },
    { accept: "contract", ok: [CONTRACT], refused: [ACCOUNT, "CABC", "not an address"] },
    { accept: "either", ok: [ACCOUNT, CONTRACT], refused: ["GABC", "CABC", "not an address"] },
  ];

  for (const { accept, ok, refused } of cases) {
    it(`"${accept}" commits ${ok.length} kind(s) and refuses the rest`, async () => {
      for (const input of [...ok, ...refused]) {
        const user = userEvent.setup();
        const onChange = vi.fn();
        const { unmount } = render(<Harness onChange={onChange} accept={accept} commit="valid" />);
        await user.click(screen.getByRole("combobox", { name: "Recipient" }));
        await user.paste(input);
        if (ok.includes(input)) expect(onChange, input).toHaveBeenCalledWith(input);
        else expect(onChange, input).not.toHaveBeenCalled();
        unmount();
      }
    });
  }

  it("defaults to G… accounts with a PENDING: placeholder, as before", () => {
    render(<AddressPicker label="Recipient" value="" onChange={() => {}} />);
    const input = screen.getByRole("combobox", { name: "Recipient" }) as HTMLInputElement;
    expect(input.placeholder).toBe("G... or PENDING:label");
  });

  it("drops PENDING: from the placeholder and refuses it when pendingAllowed is false", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} accept="contract" commit="valid" pendingAllowed={false} />);
    const input = screen.getByRole("combobox", { name: "Recipient" }) as HTMLInputElement;
    expect(input.placeholder).toBe("C...");
    await user.click(input);
    await user.paste("PENDING:router");
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('AddressPicker commit="valid"', () => {
  it("never calls onChange for an incomplete address, and keeps the draft on screen", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} commit="valid" />);
    const input = screen.getByRole("combobox", { name: "Recipient" }) as HTMLInputElement;
    await user.type(input, "GABC");
    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe("GABC");
  });

  it("commits a PENDING: label and an explicit clear", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} commit="valid" initial={ACCOUNT} />);
    const input = screen.getByRole("combobox", { name: "Recipient" });
    await user.clear(input);
    expect(onChange).toHaveBeenLastCalledWith("");
    await user.paste("PENDING:alice");
    expect(onChange).toHaveBeenLastCalledWith("PENDING:alice");
  });

  it('"always" (the default) still forwards every keystroke', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.type(screen.getByRole("combobox", { name: "Recipient" }), "GAB");
    expect(onChange.mock.calls.map(([v]) => v)).toEqual(["G", "GA", "GAB"]);
  });
});

describe("AddressPicker error message", () => {
  it("renders a string error under the field and describes the input with it", async () => {
    render(
      <AddressPicker
        label="Recipient"
        value="GABC"
        onChange={() => {}}
        error="Enter a valid Stellar address."
      />,
    );
    const input = screen.getByRole("combobox", { name: "Recipient" });
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(describedText(input)).toBe("Enter a valid Stellar address.");
    expect(screen.getByText("Enter a valid Stellar address.")).toBeTruthy();
    expect(await axeViolations()).toEqual([]);
  });

  it("a boolean error colours the border and renders no text, as before", () => {
    const { container } = render(<AddressInput value="GABC" onChange={() => {}} error />);
    const input = screen.getByRole("combobox");
    expect(input.className).toMatch(/border-error/);
    expect(input.getAttribute("aria-describedby")).toBeNull();
    expect(container.querySelector("p")).toBeNull();
  });
});

describe("AddressPicker combobox ARIA", () => {
  it("is a combobox whose active descendant follows ArrowDown / ArrowUp", async () => {
    const user = userEvent.setup();
    render(<AddressPicker label="Recipient" value="" onChange={() => {}} addressBook={BOOK} />);
    const input = screen.getByRole("combobox", { name: "Recipient" });
    expect(input.getAttribute("aria-autocomplete")).toBe("list");
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(input.getAttribute("aria-controls")).toBeNull();

    await user.click(input);
    expect(input.getAttribute("aria-expanded")).toBe("true");
    const listbox = screen.getByRole("listbox", { name: "Saved contacts" });
    expect(input.getAttribute("aria-controls")).toBe(listbox.id);

    // The search box takes focus when the address book has entries.
    const focused = document.activeElement as HTMLElement;
    const active = () =>
      document.getElementById(focused.getAttribute("aria-activedescendant") ?? "")?.textContent;

    expect(active()).toMatch(/^Alice/);
    await user.keyboard("{ArrowDown}");
    expect(active()).toMatch(/^Bob/);
    expect(input.getAttribute("aria-activedescendant")).toBe(
      focused.getAttribute("aria-activedescendant"),
    );
    await user.keyboard("{ArrowUp}");
    expect(active()).toMatch(/^Alice/);
    expect(await axeViolations()).toEqual([]);
  });

  it("reusable outside the swap: an account field with an address book and a picked entry", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onSelectEntry = vi.fn();
    render(
      <AddressPicker
        label="Employer"
        accept="account"
        value={ACCOUNT_2}
        onChange={onChange}
        onSelectEntry={onSelectEntry}
        addressBook={BOOK}
      />,
    );
    await user.click(screen.getByRole("combobox", { name: "Employer" }));
    const bob = screen.getByRole("option", { name: /Bob/ });
    expect(bob.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement?.getAttribute("aria-activedescendant")).toBe(bob.id);
    expect(await axeViolations()).toEqual([]);

    await user.keyboard("{ArrowUp}{Enter}");
    expect(onSelectEntry).toHaveBeenCalledWith(BOOK[0]);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("is axe clean closed and with an empty address book open", async () => {
    const user = userEvent.setup();
    render(<AddressPicker label="Recipient" value="" onChange={() => {}} />);
    expect(await axeViolations()).toEqual([]);
    await user.click(screen.getByRole("combobox", { name: "Recipient" }));
    expect(screen.getByText("NO SAVED CONTACTS.")).toBeTruthy();
    expect(screen.getByRole("combobox").getAttribute("aria-expanded")).toBe("false");
    expect(await axeViolations()).toEqual([]);
  });
});

describe("AddressPicker pinned mode", () => {
  const pinned: PinnedAddress = { id: CONTRACT, label: "Soroswap router", network: "mainnet" };

  it("shows the id truncated in mono and exposes the full id", async () => {
    render(<AddressPicker pinned={pinned} />);
    const readout = screen.getByRole("status", { name: "Soroswap router" });
    expect(readout.querySelector("[aria-hidden]")?.textContent).toBe("CAEQ…TD2L");
    expect(readout.textContent).toContain(CONTRACT);
    expect(readout.className).toMatch(/font-mono/);
    expect(await axeViolations()).toEqual([]);
  });

  it("copies the full id", async () => {
    const user = userEvent.setup();
    render(<AddressPicker pinned={pinned} />);
    await user.click(screen.getByRole("button", { name: "Copy Soroswap router address" }));
    expect(await navigator.clipboard.readText()).toBe(CONTRACT);
  });

  it.each([
    ["mainnet", "public"],
    ["testnet", "testnet"],
  ] as const)("links %s to stellar.expert's %s explorer", (network, segment) => {
    render(<AddressPicker pinned={{ ...pinned, network }} />);
    const link = screen.getByRole("link", { name: /View Soroswap router on stellar.expert/ });
    expect(link.getAttribute("href")).toBe(
      `https://stellar.expert/explorer/${segment}/contract/${CONTRACT}`,
    );
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("shows the unconfigured state in the error style when the id is missing", async () => {
    render(<AddressPicker pinned={{ ...pinned, id: undefined }} />);
    const readout = screen.getByRole("status", { name: "Soroswap router" });
    expect(readout.textContent).toBe("Not configured on this environment");
    expect(readout.getAttribute("aria-invalid")).toBe("true");
    expect(readout.querySelector(".text-error")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(await axeViolations()).toEqual([]);
  });

  it("cannot be edited by typing or pasting, and never opens a listbox", async () => {
    const user = userEvent.setup();
    render(<AddressPicker pinned={pinned} />);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    const readout = screen.getByRole("status", { name: "Soroswap router" });
    expect(readout.tabIndex).toBe(-1);

    await user.click(readout);
    await user.keyboard("GABC{ArrowDown}");
    await user.paste(ACCOUNT);
    expect(readout.textContent).toContain(CONTRACT);
    expect(readout.textContent).not.toContain(ACCOUNT);
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
