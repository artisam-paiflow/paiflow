# The code behind the Swapper panel's before and after

**Checked:** 24 September 2026, against the public mirror's `develop` at
[`5a866ae`](https://github.com/artisam-paiflow/paiflow/commit/5a866ae46ba2b56975a1e2c3ba79fb35fc9ca15c)
(the #670 merge). **Before** is the panel as it stood when the sprint opened,
[`a3f9c4c`](https://github.com/artisam-paiflow/paiflow/commit/a3f9c4ca47f515c683d7b28743cf5044bc337987)
(the #598 merge). A screenshot pair of the same panel looks alike at a glance, so this note shows
the change in the code instead: each claim is one sentence, followed by the command that proves
it and what the command prints. Every command runs in a clone of
[the mirror](https://github.com/artisam-paiflow/paiflow) with `develop` checked out.

## 1. The Swapper panel is built from the four shared inputs

The panel imports the four components the sprint set out to build. The one input it still draws
itself, the deadline, is covered in [section 3](#3-hand-written-inputs-before-and-after).

```bash
sed -n '8,12p' components/builder/panels/swap-panel.tsx
```

```tsx
import { AddressPicker } from "../inputs/address-picker";
import { AmountInput } from "../inputs/amount-input";
import { AssetSelect } from "../inputs/asset-select";
import { Field } from "../inputs/field";
import { ShareInput } from "../inputs/share-input";
```

Where each one is used in `components/builder/panels/swap-panel.tsx`:

| Component       | Lines      | What it does in this panel                                                                                                                                        |
| --------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AssetSelect`   | `:59-72`   | Asset In and Asset Out, the same component twice                                                                                                                  |
| `ShareInput`    | `:73-80`   | Max slippage, with a floor (`minBps`) and no running total (no `remainingBps`)                                                                                    |
| `AmountInput`   | `:91-98`   | The amount in the Preview box (`:81-105`). It only sizes the quote: it is held in local state (`:41-43`) and never saved into the flow                            |
| `AddressPicker` | `:127-130` | The router, pinned: shown and copyable, not editable. It sits under **Advanced** with the deadline, and that section opens on its own when either needs attention |

The panel's component test checks the same list:
`tests/unit/builder/panels/swap-panel.test.tsx:149` (`// AssetSelect ×2, AddressPicker (pinned), ShareInput, AmountInput.`).

Built in [#612](https://github.com/artisam-paiflow/paiflow/commit/9ca788726f05b68dbe54941252cad02bd4f6dae4)
(merged in [#633](https://github.com/artisam-paiflow/paiflow/commit/cdbb8ee3242caa04cb33f7b97a3e3f289d9046d3));
laid out as it is now in [#670](https://github.com/artisam-paiflow/paiflow/commit/5a866ae46ba2b56975a1e2c3ba79fb35fc9ca15c).

## 2. The swap code left the 2,800-line config panel

Before, the Swapper's form was 88 lines written inline in `config-panel.tsx` (`:1373-1460` at
`a3f9c4c`). Now it is a single 12-line `<SwapPanel … />` (`:1359-1370`), and the file is 242 lines
shorter.

```bash
git diff --stat a3f9c4c 5a866ae -- components/builder/config-panel.tsx
git show a3f9c4c:components/builder/config-panel.tsx | wc -l
git show 5a866ae:components/builder/config-panel.tsx | wc -l
```

```text
 components/builder/config-panel.tsx | 314 +++++-------------------------------
 1 file changed, 36 insertions(+), 278 deletions(-)
2872
2630
```

The `AssetSimpleSelect` wrapper the old form used was deleted outright:

```bash
git grep -c AssetSimpleSelect a3f9c4c -- components
git grep -c AssetSimpleSelect 5a866ae -- components
```

```text
a3f9c4c:components/builder/config-panel.tsx:3
```

(The second command prints nothing: no file mentions it any more.)

The old form also had a **Router** dropdown that was always disabled and had only one option. It
looked like a choice but wasn't one. It is gone, and a test fails if an editable router field ever
comes back: `tests/unit/builder/panels/swap-panel.test.tsx:330` asserts there is no Router text box,
and `:152` that the router is shown as read-only output.

## 3. Hand-written inputs, before and after

| In the swap form      | Before (`a3f9c4c`)                                                  | After (`5a866ae`)                                                |
| --------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Asset In / Asset Out  | 2 × `AssetSimpleSelect`, a wrapper local to `config-panel.tsx`      | 2 × shared `AssetSelect`                                         |
| Router                | a raw `<select>`, disabled, one option                              | shared `AddressPicker`, pinned                                   |
| Max slippage          | a raw `<input type="number">`, with its own clamping written inline | shared `ShareInput`                                              |
| Deadline              | a raw `<input type="number">`, with its own clamping written inline | `DeadlineInput` (see below)                                      |
| Preview amount        | none: the quote always used 10 units                                | shared `AmountInput`                                             |
| Styling of the inputs | the `:global(.input)` rule inside `config-panel.tsx`                | the shared `inputClass` in `components/builder/inputs/styles.ts` |

One input is still specific to this panel, stated here rather than left for a reader to find:
the deadline. `DeadlineInput` (`swap-panel.tsx:144-180`) is a small local component, but it is
assembled from the shared parts (`Field` for the label and error, `inputClass` for the styling,
`useDraftNumber` for typing and range checks), so it looks and behaves like the other four. None of
the other nodes needs a deadline, so there was nothing to share it with.

The pinned router also stopped styling itself: since
[#660](https://github.com/artisam-paiflow/paiflow/commit/0219f128ed17524e360e88827c6aa5b6f3a24a84),
`AddressPicker` draws its inputs with the same `inputClass`
(`components/builder/inputs/address-picker.tsx:18`).

## 4. The builder checks the flow once, not twice

Before, the builder ran the full flow check twice every time the flow changed: once for the canvas
and again inside the config panel. Now it runs once, and the panel receives the results.

```bash
git grep -n 'validateFlow(' a3f9c4c -- components/builder
git grep -n 'validateFlow(' 5a866ae -- components/builder
```

```text
a3f9c4c:components/builder/builder-client.tsx:278:  const validation = useMemo(() => validateFlow(graph), [graph]);
a3f9c4c:components/builder/config-panel.tsx:155:    const result = validateFlow(graph);
5a866ae:components/builder/builder-client.tsx:290:  const validation = useMemo(() => validateFlow(graph), [graph]);
```

`config-panel.tsx:104` now declares `errors: ValidationIssue[]` as a prop. Changed in
[`456ec18`](https://github.com/artisam-paiflow/paiflow/commit/456ec180d2af9d6943e5bea926ce6e0c7192d8ec)
(#611, merged in [#623](https://github.com/artisam-paiflow/paiflow/commit/fdb04daa3c1435673563314b8a5d1c736bf1f870)).

## 5. The swap rules live in one function, each with a fixed code

The rules that apply only to a Swapper are in one function, and each has a code that stays the same
when its wording changes. The code, not the sentence, is what the rest of the app matches on.

```bash
git grep -n 'swapConfigIssues(' 5a866ae -- lib app components
sed -n '2,7p' lib/flows/issue.ts
```

```text
5a866ae:lib/flows/swap-rules.ts:41:export function swapConfigIssues(node: SwapNode, ctx: SwapRuleContext): ValidationIssue[] {
5a866ae:lib/flows/validate.ts:704:        ...swapConfigIssues(n, {
```

```ts
export type SwapIssueCode =
  | "SWAP_SAME_ASSET"
  | "SWAP_SLIPPAGE_TOO_LOW"
  | "SWAP_NEEDS_NEXT_STEP"
  | "SWAP_SINGLE_EDGE"
  | "SWAP_ASSET_NOT_SUPPORTED";
```

It is defined once and called from one place, the flow check that both the builder and the
server run. Added in
[`ddd9aa5`](https://github.com/artisam-paiflow/paiflow/commit/ddd9aa58b80c35e2cb67d76d9cd816560b422cec)
(#610, merged in [#631](https://github.com/artisam-paiflow/paiflow/commit/e3ba1dc78875f9498613c62f1d2848be3b9c87b9)).

One check on a Swapper sits outside it and has no code: "Asset In" must match the asset that
actually flows into the swap (`lib/flows/validate.ts:1066-1083`). That is the asset-flow check every
paying step shares, not a swap rule, so it stays where the other steps' version is.

## 6. Amounts and percentages are checked by the same rules everywhere

The rules for "a valid amount" and "a valid percentage" are written once, in
`lib/flows/primitives.ts`, and used by the flow schema, the Soroswap quote endpoint and the
trigger endpoint.

```bash
git grep -n -E 'stroopsSchema\(|bpsSchema\(' 5a866ae -- lib/flows/schema.ts lib/soroswap/quote.ts 'app/api/deployments/[id]/trigger/route.ts'
```

```text
5a866ae:app/api/deployments/[id]/trigger/route.ts:18:  amount: stroopsSchema({ message: "Must be a positive whole number of stroops" }),
5a866ae:lib/flows/schema.ts:372:    slippageBps: bpsSchema().default(100),
5a866ae:lib/soroswap/quote.ts:52:    amountStroops: stroopsSchema({ message: "Must be a positive integer in stroops" }),
5a866ae:lib/soroswap/quote.ts:53:    slippageBps: bpsSchema({ coerce: true }).default(100),
```

The shared `AmountInput` takes its upper limit from the same file
(`components/builder/inputs/amount-input.tsx:3`, `I128_MAX`), so the field and the server stop at
the same number. Added in
[#628](https://github.com/artisam-paiflow/paiflow/commit/5f4c28d7c3e08d2a0ebfdb5071017cae0027e0ad).

## 7. Every endpoint turns flow errors into field errors the same way

The four endpoints that check a flow all turn its problems into per-field messages with the one
shared helper. None of them builds that shape by hand any more.

```bash
git grep -c 'Object.fromEntries(v.errors' a3f9c4c -- app
git grep -n 'issuesToFields(' 5a866ae -- app
git grep -c 'Object.fromEntries(v.errors' 5a866ae -- app
```

```text
a3f9c4c:app/api/deployments/prepare/route.ts:1
a3f9c4c:app/api/flows/[id]/edit/route.ts:1
a3f9c4c:app/api/flows/[id]/resolve-addresses/route.ts:1
a3f9c4c:app/api/flows/route.ts:1
5a866ae:app/api/deployments/prepare/route.ts:44:      throw new AppError("VALIDATION", "Flow is invalid", issuesToFields(v.errors));
5a866ae:app/api/flows/[id]/edit/route.ts:346:      const fieldErrors = issuesToFields(v.errors);
5a866ae:app/api/flows/[id]/resolve-addresses/route.ts:79:        issuesToFields(v.errors),
5a866ae:app/api/flows/route.ts:51:      throw new AppError("VALIDATION", "Invalid flow graph", issuesToFields(v.errors));
```

Before, each of the four routes built the shape by hand. The last command prints nothing: no
matches. Added in
[`ddd9aa5`](https://github.com/artisam-paiflow/paiflow/commit/ddd9aa58b80c35e2cb67d76d9cd816560b422cec).

## 8. One helper picks out a node's errors

Each error names the field it belongs to, such as "nodes.3.config.slippageBps". Before, the config
panel took those names apart itself (`config-panel.tsx:150-160` at `a3f9c4c`). Now it asks the
shared `nodeIssues()` for the errors of the node it shows.

```bash
git grep -n 'nodeIssues(' 5a866ae -- components lib
```

```text
5a866ae:components/builder/config-panel.tsx:151:        ? nodeIssues(
5a866ae:lib/flows/issue-paths.ts:11:export function nodeIssues(
```

Adopted in [`d10dc0b`](https://github.com/artisam-paiflow/paiflow/commit/d10dc0bcbcb2d53aa051c97f057bd6e466f2e63a)
(#646, merged in [#650](https://github.com/artisam-paiflow/paiflow/commit/d4bacbf037fca056c1fbe3bb89be9b1b2eb5364e)).

## 9. Every input shows its error the same way

Each shared input draws its label, hint and error through one component, `Field`. It also links
the error to the control (`aria-invalid`, `aria-describedby`), so a screen reader announces it the
same way in every field.

```bash
git grep -l '<Field' 5a866ae -- components/builder/inputs
```

```text
5a866ae:components/builder/inputs/address-picker.tsx
5a866ae:components/builder/inputs/amount-input.tsx
5a866ae:components/builder/inputs/asset-select.tsx
5a866ae:components/builder/inputs/percent-bps-input.tsx
```

`ShareInput` is a `PercentBpsInput` with the running total left off
(`components/builder/inputs/share-input.tsx:4`), and the panel's `DeadlineInput` uses `Field` too
([section 3](#3-hand-written-inputs-before-and-after)).

## 10. The shared inputs are ready for the other nodes

None of the shared inputs depends on the Swapper. They import only general helpers and the flow
schema, so another node's panel can use them unchanged.

```bash
git grep -n -E 'swap-panel|swap-rules' 5a866ae -- components/builder/inputs
```

(Prints nothing: no shared input imports the Swapper's panel or its rules.)

## 11. What was left alone on purpose

The sprint moved one panel onto the shared inputs; the other nodes still use the old ones, among
them Pay (`config-panel.tsx:507`) and Split (`:793`). They stay as they are to serve as the
contrast, and moving them is a later phase.

```bash
git grep -n ':global(.input)' 5a866ae -- components/builder/config-panel.tsx
git grep -n 'export function AssetField(' 5a866ae -- components/builder/panels/asset-fields.tsx
git grep -c '<AssetField\b' 5a866ae -- components/builder/config-panel.tsx
```

```text
5a866ae:components/builder/config-panel.tsx:1741:        :global(.input) {
5a866ae:components/builder/panels/asset-fields.tsx:118:export function AssetField({
5a866ae:components/builder/config-panel.tsx:10
```

The old global input style is still in the config panel, and the old `AssetField` asset picker is
still used 10 times there, by the panels that have not been migrated.
