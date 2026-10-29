import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { describe, expect, it, vi } from "vitest";
import type { FlowNode } from "@/lib/flows/schema";
import { FlowPatchSchema } from "@/lib/flows/schema";
import { SplitRecipientsEditor } from "@/components/builder/panels/split-recipients-editor";
type SplitNode = Extract<
  FlowNode,
  {
    type: "split";
  }
>;
const TRIGGER: FlowNode = { id: "t", type: "on_receive", config: { asset: { kind: "native" } } };
const SPLIT: SplitNode = {
  id: "s",
  type: "split",
  config: {
    asset: { kind: "native" },
    recipients: [
      { address: "PENDING:a", label: "Alice", mode: "percentage", bps: 5000 },
      { address: "PENDING:b", label: "Bob", mode: "percentage", bps: 5000 },
    ],
  },
};
function Owned({
  initial = SPLIT,
  spy,
  errors,
}: {
  initial?: SplitNode;
  spy: (node: SplitNode) => void;
  errors?: Map<string, string>;
}) {
  const [node, setNode] = useState(initial);
  return (
    <SplitRecipientsEditor
      node={node}
      trigger={TRIGGER}
      sourceAmount={undefined}
      addressBook={[]}
      offrampEnabled={false}
      sandbox
      fieldErrors={errors}
      onChange={(next) => {
        if (next.type !== "split") throw new Error("Expected split");
        // Every emission must remain autosaveable, including zero amounts and cleared shares.
        expect(
          FlowPatchSchema.safeParse({
            graph: { nodes: [TRIGGER, next], edges: [{ id: "e", source: "t", target: "s" }] },
          }).success,
        ).toBe(true);
        spy(next);
        setNode(next);
      }}
    />
  );
}
function latest(spy: ReturnType<typeof vi.fn<(node: SplitNode) => void>>) {
  return spy.mock.lastCall![0];
}
describe("Split on shared inputs", () => {
  it("clears a share without committing zero and keeps fractional basis points exact", async () => {
    const user = userEvent.setup();
    const spy = vi.fn<(node: SplitNode) => void>();
    render(<Owned spy={spy} />);
    const share = screen.getByRole("textbox", { name: "Share for Alice" }) as HTMLInputElement;
    await user.clear(share);
    await user.tab();
    expect(spy).not.toHaveBeenCalled();
    expect(share.value).toBe("");
    await user.type(share, "12.");
    expect(share.value).toBe("12.");
    await user.type(share, "5");
    expect(latest(spy).config.recipients[0]).toMatchObject({ mode: "percentage", bps: 1250 });
    expect(latest(spy).config.recipients[1]).toEqual(SPLIT.config.recipients[1]);
  });
  it("keeps fixed amount clearing and decimal entry, and restores shares when changing modes", async () => {
    const user = userEvent.setup();
    const spy = vi.fn<(node: SplitNode) => void>();
    render(<Owned spy={spy} />);
    await user.selectOptions(screen.getByRole("combobox", { name: "Distribution mode" }), "fixed");
    const amount = screen.getByRole("textbox", { name: "Amount for Alice" }) as HTMLInputElement;
    await user.clear(amount);
    await user.type(amount, "1.5");
    expect(latest(spy).config.recipients[0]).toMatchObject({
      mode: "fixed",
      amountStroops: "15000000",
    });
    await user.clear(amount);
    expect(latest(spy).config.recipients[0]).toMatchObject({ amountStroops: "0" });
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Distribution mode" }),
      "percentage",
    );
    expect(latest(spy).config.recipients).toEqual(SPLIT.config.recipients);
  });
  it("keeps recipient values attached to the remaining row after removing a recipient", async () => {
    const user = userEvent.setup();
    const spy = vi.fn<(node: SplitNode) => void>();
    render(<Owned spy={spy} />);
    const first = screen.getByRole("textbox", { name: "Share for Alice" });
    await user.clear(first);
    await user.type(first, "25");
    await user.click(screen.getByRole("button", { name: "Remove recipient 1" }));
    expect(latest(spy).config.recipients).toEqual([SPLIT.config.recipients[1]]);
    expect((screen.getByRole("textbox", { name: "Share for Bob" }) as HTMLInputElement).value).toBe(
      "50",
    );
  });
  it("connects share errors to the input and has no axe violations", async () => {
    const { container } = render(
      <Owned
        spy={vi.fn()}
        errors={new Map([["recipients.0.bps", "Shares must add up to 100%"]])}
      />,
    );
    const input = screen.getByRole("textbox", { name: "Share for Alice" });
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(input.getAttribute("aria-describedby")!)?.textContent).toContain(
      "Shares must add up to 100%",
    );
    const { violations } = await axe.run(container, { rules: { region: { enabled: false } } });
    expect(violations.map((v) => v.id)).toEqual([]);
  });
});

it("lets a payroll author enter every immutable bank field and displays recipient field errors", async () => {
  const user = userEvent.setup();
  const spy = vi.fn<(node: SplitNode) => void>();
  const payroll: FlowNode = {
    id: "t",
    type: "payroll",
    config: {
      asset: { kind: "known", symbol: "USDC" },
      employer: "PENDING:employer",
      intervalAmount: 1,
      intervalUnit: "week",
    },
  };
  const errors = new Map([
    ["recipients.0.accountName", "Enter the account name for this fiat recipient."],
    ["recipients.0.accountNumber", "Enter the account number for this fiat recipient."],
    ["recipients.0.bankCode", "Enter the bank code for this fiat recipient."],
  ]);
  function PayrollEditor() {
    const [node, setNode] = useState<SplitNode>({
      id: "s",
      type: "split",
      config: {
        asset: { kind: "known", symbol: "USDC" },
        recipients: [
          {
            address: "PENDING:salary",
            label: "Employee",
            mode: "fixed",
            amountStroops: "10000000",
            payoutMode: "fiat",
          },
        ],
      },
    });
    return (
      <SplitRecipientsEditor
        node={node}
        trigger={payroll}
        sourceAmount={undefined}
        addressBook={[]}
        offrampEnabled
        fieldErrors={errors}
        onChange={(next) => {
          if (next.type !== "split") throw new Error("Expected Split");
          spy(next);
          setNode(next);
        }}
      />
    );
  }
  render(<PayrollEditor />);
  for (const message of errors.values()) expect(screen.getByText(message)).toBeTruthy();
  await user.type(screen.getByRole("textbox", { name: /Account name/ }), "Recipient");
  await user.type(screen.getByRole("textbox", { name: /Account number/ }), "1234567890");
  await user.selectOptions(screen.getByRole("combobox", { name: /^Bank/ }), "BASECPH");
  expect(latest(spy).config.recipients[0]).toMatchObject({
    accountName: "Recipient",
    accountNumber: "1234567890",
    bankCode: "BASECPH",
  });
});
