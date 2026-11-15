vi.hoisted(() =>
  Object.defineProperty(globalThis, "Uint8Array", {
    configurable: true,
    writable: true,
    value: Object.getPrototypeOf(Buffer.prototype).constructor,
  }),
);
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorConfigurationValues } from "@/components/deploy/conditional-configuration-values";
import { conditionalOwnerFixture } from "@/tests/fixtures/conditional-owner-configuration";
import {
  conditionalAcceptanceDefinition,
  conditionalAcceptancePlan,
} from "@/tests/fixtures/conditional-v2-acceptance";
import { CONDITIONAL_V2_WASM_HASHES } from "@/lib/stellar/conditional-artifacts";
afterEach(cleanup);
describe("conditional owner stored field controls", () => {
  it("allows only mutable threshold edits and explains strict post-prefix equality", () => {
    const f = conditionalOwnerFixture(),
      values = f.state.statuses.map(({ state }) => state),
      changed = vi.fn();
    const view = render(<EditorConfigurationValues values={values} onChange={changed} />);
    expect(screen.getByRole("textbox", { name: "Threshold for condition" })).toBeTruthy();
    expect(screen.getByText(/Equality takes False/)).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Threshold for condition" }), {
      target: { value: "0" },
    });
    expect(changed).toHaveBeenCalled();
    const state = values[2]!;
    if (state.configuration.kind === "condition") state.configuration.thresholdMode = "constant";
    view.rerender(<EditorConfigurationValues values={values} onChange={changed} />);
    expect(screen.queryByRole("textbox", { name: "Threshold for condition" })).toBeNull();
  });
  it("renders Return to immutable full owner with no editing control or payer substitution", () => {
    const definition = conditionalAcceptanceDefinition();
    const plan = conditionalAcceptancePlan(definition, CONDITIONAL_V2_WASM_HASHES);
    render(
      <EditorConfigurationValues values={[plan.manifest.nodes.at(-1)!.state]} onChange={vi.fn()} />,
    );
    expect(screen.getByText(/Immutable owner recipient:/).textContent).toContain(definition.owner);
    expect(screen.getByText(/never the payer/)).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
  });
  it("renders both branch mutable recipients while configured constants and modes remain read-only", () => {
    const f = conditionalOwnerFixture();
    render(
      <EditorConfigurationValues
        values={f.state.statuses.map(({ state }) => state)}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("textbox", { name: "Recipient for yes first" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Recipient for no first" })).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Recipient for yes second" })).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});
