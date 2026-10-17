/**
 * #588: what the config panel's address fields commit to the graph. They use
 * `AddressInput` in its default mode, which forwards every edit, so the graph
 * always holds what the field shows: a draft saves (the shape schema takes any
 * string) and validateFlow refuses it, rather than the graph keeping a previous
 * address the user has already replaced on screen. The one change made to what
 * was typed is trimming surrounding whitespace; nothing is upper-cased,
 * truncated or otherwise turned into a different address.
 */
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StrKey } from "@stellar/stellar-sdk";
import AddressInput from "@/components/builder/address-input";
import { FlowGraphSchema } from "@/lib/flows/schema";
import { addressIssues } from "@/lib/flows/address-rules";

const ACCOUNT = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const CONTRACT = "CAEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQTD2L";
const BAD_CHECKSUM = ACCOUNT.slice(0, -1) + (ACCOUNT.endsWith("A") ? "B" : "A");

// Mirrors a panel call site: unlabelled, controlled by the node's config.
function PayRecipient({
  initial = "",
  onCommit,
}: {
  initial?: string;
  onCommit: (v: string) => void;
}) {
  const [recipient, setRecipient] = useState(initial);
  return (
    <label>
      Recipient
      <AddressInput
        value={recipient}
        onChange={(v) => {
          onCommit(v);
          setRecipient(v);
        }}
      />
    </label>
  );
}

function field() {
  return screen.getByRole("combobox", { name: /Recipient/ }) as HTMLInputElement;
}

/** The address issues validateFlow would raise for a pay step to `recipient`. */
function issuesFor(recipient: string) {
  const graph = FlowGraphSchema.parse({
    nodes: [
      {
        id: "p",
        type: "pay",
        config: {
          recipient,
          asset: { kind: "native" },
          mode: "fixed",
          amountStroops: "1",
        },
      },
    ],
    edges: [],
  });
  return addressIssues(graph);
}

beforeEach(() => {
  Element.prototype.scrollIntoView = () => {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("panel address field commits (#588)", () => {
  it("typing part of an address commits each prefix exactly, and the draft is refused before deploy", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<PayRecipient onCommit={onCommit} />);
    await user.type(field(), "GAB");
    expect(onCommit.mock.calls.map(([v]) => v)).toEqual(["G", "GA", "GAB"]);
    expect(field().value).toBe("GAB");
    expect(issuesFor("GAB")).toHaveLength(1);
  });

  it("pasting a full valid address commits it unchanged, and it passes", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<PayRecipient onCommit={onCommit} />);
    await user.click(field());
    await user.paste(ACCOUNT);
    expect(onCommit).toHaveBeenLastCalledWith(ACCOUNT);
    expect(issuesFor(ACCOUNT)).toEqual([]);
  });

  it("pasting with surrounding whitespace commits the address without it, and nothing else changes", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<PayRecipient onCommit={onCommit} />);
    await user.click(field());
    await user.paste(`  ${ACCOUNT}\t `);
    expect(onCommit).toHaveBeenLastCalledWith(ACCOUNT);
    expect(field().value).toBe(ACCOUNT);
  });

  it("clearing a committed address commits an empty string, which is refused before deploy", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<PayRecipient initial={ACCOUNT} onCommit={onCommit} />);
    await user.clear(field());
    expect(onCommit).toHaveBeenLastCalledWith("");
    const [issue] = issuesFor("");
    expect(issue!.friendlyMessage).toMatch(/^Enter a complete wallet address/);
  });

  it("a lower-case address is committed as typed, never upper-cased into a valid one", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<PayRecipient onCommit={onCommit} />);
    await user.click(field());
    await user.paste(ACCOUNT.toLowerCase());
    expect(onCommit).toHaveBeenLastCalledWith(ACCOUNT.toLowerCase());
    expect(onCommit).not.toHaveBeenCalledWith(ACCOUNT);
    expect(issuesFor(ACCOUNT.toLowerCase())[0]!.friendlyMessage).toContain("lower case");
  });

  it("a wrong prefix (a C… contract in a wallet field) is committed as typed and refused", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<PayRecipient onCommit={onCommit} />);
    await user.click(field());
    await user.paste(CONTRACT);
    expect(onCommit).toHaveBeenLastCalledWith(CONTRACT);
    expect(issuesFor(CONTRACT)[0]!.friendlyMessage).toContain("needs a wallet address (G…)");
  });

  it("a bad checksum is committed as typed and refused", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<PayRecipient onCommit={onCommit} />);
    await user.click(field());
    await user.paste(BAD_CHECKSUM);
    expect(onCommit).toHaveBeenLastCalledWith(BAD_CHECKSUM);
    expect(issuesFor(BAD_CHECKSUM)).toHaveLength(1);
  });

  it("editing a valid address never leaves the old one in the graph behind a different draft", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<PayRecipient initial={ACCOUNT} onCommit={onCommit} />);
    await user.type(field(), "X");
    expect(onCommit).toHaveBeenLastCalledWith(`${ACCOUNT}X`);
    expect(field().value).toBe(`${ACCOUNT}X`);
    expect(issuesFor(`${ACCOUNT}X`)).toHaveLength(1);
  });

  it("a PENDING: placeholder is committed as typed and passes", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<PayRecipient onCommit={onCommit} />);
    await user.click(field());
    await user.paste("PENDING:alice");
    expect(onCommit).toHaveBeenLastCalledWith("PENDING:alice");
    expect(issuesFor("PENDING:alice")).toEqual([]);
  });

  it("a pasted secret seed is never committed or shown, and the field says why", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<PayRecipient initial={ACCOUNT} onCommit={onCommit} />);
    // A valid-checksum seed for a throwaway key (jsdom has no keypair RNG).
    const seed = StrKey.encodeEd25519SecretSeed(Buffer.alloc(32, 7));
    await user.clear(field());
    onCommit.mockClear();
    await user.paste(seed);
    expect(onCommit).not.toHaveBeenCalled();
    expect(field().value).toBe("");
    expect(document.body.textContent).not.toContain(seed);
    const describedBy = field().getAttribute("aria-describedby") ?? "";
    const note = describedBy
      .split(" ")
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ");
    expect(note).toContain("secret key");
  });

  it("typing an S commits nothing, and a following address clears the note", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<PayRecipient onCommit={onCommit} />);
    await user.type(field(), "S");
    expect(onCommit).not.toHaveBeenCalled();
    expect(field().value).toBe("");
    await user.paste(ACCOUNT);
    expect(onCommit).toHaveBeenLastCalledWith(ACCOUNT);
    expect(field().getAttribute("aria-describedby") ?? "").toBe("");
  });
});
