# Week 3 — 21–27 September 2026

**Window:** 21–27 September 2026 · **Focus:** D3 — reusable builder input components

**Deliverable:** [D3 — Shared builder inputs](deliverables/d3.md) · **Evidence:** [before-and-after captures](evidence/README.md#screenshots-and-recordings)

{% hint style="info" %}
Written on 26 September. The changelog below covers 21–26 September, the extent of the public
mirror when it was generated; anything merged on the 27th is added when the mirror next syncs.
{% endhint %}

## Summary

The Swapper configuration panel was rebuilt on four shared input components, an asset select, an
amount input, an address picker and a share input, which label, check and report errors the same
way from one set of swap rules that the panel and the server both apply, and the project's first
component tests now check them in CI on every change. For a user, the panel says what is wrong on
the field that is wrong, no longer rewrites a number while it is being typed, and works with a
keyboard alone and on a phone. Nothing in the plan was dropped; three details depart from the
Statement of Work's wording, each to narrow a risk rather than the scope, and are recorded as
[scope notes](deliverables/d3.md#scope-notes).

## Changelog

Generated with:

```bash
pnpm instawards:changelog --since 2026-09-21 --until 2026-09-27 \
  --ref mirror/develop --repo https://github.com/artisam-paiflow/paiflow
```

| Date       | Change                                                                                                    | Issues           | Commit                                                                                                  |
| ---------- | --------------------------------------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------- |
| 2026-09-26 | docs(instawards): D3 page close-out: status, traceability, scope notes, props contract, §6.1 ticks (#642) | #642             | [`0334cd5`](https://github.com/artisam-paiflow/paiflow/commit/0334cd5ac3544eb9f3a61ffd7c7063d08a931c18) |
| 2026-09-26 | docs(instawards): D3 evidence pack README, evidence index, and the external QA run (#643, #658)           | #643, #658       | [`d7f437c`](https://github.com/artisam-paiflow/paiflow/commit/d7f437c07c9a79a1d113a8a6b31e6cf385704e97) |
| 2026-09-25 | docs(instawards): real-phone check and PostHog swap validation before/after (#641)                        | #641             | [`1d62025`](https://github.com/artisam-paiflow/paiflow/commit/1d62025bb24fe6ee63af9afb223232eccddc1624) |
| 2026-09-25 | docs(instawards): D3 screen recording as evidence 19                                                      | #639             | [`d496d47`](https://github.com/artisam-paiflow/paiflow/commit/d496d47915e98fbc20cdcd7abd0c01ac51824969) |
| 2026-09-25 | fix(builder): give the canvas the screen on phones                                                        | #679             | [`e192dc9`](https://github.com/artisam-paiflow/paiflow/commit/e192dc912b76294fed5d20b0ba90540887032c32) |
| 2026-09-25 | fix(builder): visible keyboard focus on canvas nodes and edges, and a Skip to canvas button               | #677             | [`56a3c58`](https://github.com/artisam-paiflow/paiflow/commit/56a3c58122c984239817bc2ed5a615f295919434) |
| 2026-09-25 | docs(instawards): record the D3 09–12 after-pairs (#637)                                                  | #676             | [`c51088b`](https://github.com/artisam-paiflow/paiflow/commit/c51088b3201e10ee1d66d52d29ca710fb5852fbd) |
| 2026-09-25 | docs(instawards): D3 after-captures from paiflow.xyz, router, composite and Pay contrast (#637)           | #675             | [`e647615`](https://github.com/artisam-paiflow/paiflow/commit/e64761506a925f49825a74f212ccf311c8dfb7c2) |
| 2026-09-25 | docs(instawards): D3 CI test report from the public mirror run (#640)                                     | #640             | [`5302056`](https://github.com/artisam-paiflow/paiflow/commit/5302056bf3f125dbb242984effd692c0479141d1) |
| 2026-09-25 | docs(instawards): the D3 code-diff note, each claim with the command that proves it                       | #638             | [`389c45f`](https://github.com/artisam-paiflow/paiflow/commit/389c45f0e20547c30ed935703f7873e60142ebd1) |
| 2026-09-24 | feat(builder): simplify the Swapper panel                                                                 | #670             | [`5a866ae`](https://github.com/artisam-paiflow/paiflow/commit/5a866ae46ba2b56975a1e2c3ba79fb35fc9ca15c) |
| 2026-09-24 | feat(homepage): embed the Paiflow explainer video                                                         | #668             | [`14c837c`](https://github.com/artisam-paiflow/paiflow/commit/14c837c95d88e1121a6e6ec7b3176d7f69577fcd) |
| 2026-09-24 | docs(instawards): capture D3's "before" from paiflow.xyz ahead of promotion (#614)                        | #666             | [`0214190`](https://github.com/artisam-paiflow/paiflow/commit/0214190a3ddf3856aca71959190882c8beef7422) |
| 2026-09-23 | test(builder): capture the slippage floor error on the shared input (#637)                                | #665             | [`5aad410`](https://github.com/artisam-paiflow/paiflow/commit/5aad410039efbc3f1eb2fff86c6c96f53ed3be4b) |
| 2026-09-23 | fix(builder): name AddressPicker's editable controls and give them real targets (#661)                    | #661             | [`c28cb8c`](https://github.com/artisam-paiflow/paiflow/commit/c28cb8cc3d918612416350a8a7b70e939d515101) |
| 2026-09-23 | fix(builder): AddressPicker's editable branch is styled from styles.ts (#648)                             | #648             | [`0219f12`](https://github.com/artisam-paiflow/paiflow/commit/0219f128ed17524e360e88827c6aa5b6f3a24a84) |
| 2026-09-22 | test(swap): prove a same-asset swap is refused at prepare, and pin CI Node to engines (#649)              | #649             | [`a976d78`](https://github.com/artisam-paiflow/paiflow/commit/a976d780a4a8e3dd050b572bde5ba6e07e6d49db) |
| 2026-09-22 | fix(builder): the edge packet, chat glow and grid honour reduced motion (#647)                            | #647             | [`0617084`](https://github.com/artisam-paiflow/paiflow/commit/0617084de09148c2fa6f9c107cd23bee90bbee3e) |
| 2026-09-22 | refactor(builder): the config panel uses nodeIssues() (#646)                                              | #646             | [`d4bacbf`](https://github.com/artisam-paiflow/paiflow/commit/d4bacbf037fca056c1fbe3bb89be9b1b2eb5364e) |
| 2026-09-22 | feat(builder): keyboard, focus and a docked sheet for the config panel (#613)                             | #613             | [`a494e86`](https://github.com/artisam-paiflow/paiflow/commit/a494e862bdd8298052d3acdce0211c3cab43d9c5) |
| 2026-09-22 | feat(builder): rebuild the Swapper panel on the shared inputs (#612)                                      | #612, #454, #453 | [`cdbb8ee`](https://github.com/artisam-paiflow/paiflow/commit/cdbb8ee3242caa04cb33f7b97a3e3f289d9046d3) |
| 2026-09-22 | feat(builder): AddressPicker with its own error, combobox ARIA and a pinned mode (#609)                   | #609             | [`945c627`](https://github.com/artisam-paiflow/paiflow/commit/945c6271c50694d1f1bc7292758d6bb9e7bc4d8c) |
| 2026-09-22 | feat(validation): one swap rule set and one error model for the swapper flow                              | #610             | [`e3ba1dc`](https://github.com/artisam-paiflow/paiflow/commit/e3ba1dc78875f9498613c62f1d2848be3b9c87b9) |
| 2026-09-22 | chore(testers): seed the alpha guide's starter flow for tester accounts                                   | #630             | [`d46a981`](https://github.com/artisam-paiflow/paiflow/commit/d46a981fdc7d914b0f17fa861c34e949a231a949) |
| 2026-09-22 | feat(builder): AmountInput and ShareInput on a draft-then-commit numeric core (#608)                      | #608             | [`4bb8fde`](https://github.com/artisam-paiflow/paiflow/commit/4bb8fded6fcecfb54b6c6054a9774f1aa4d72b26) |
| 2026-09-21 | feat(builder): input foundation — Field wiring, input tokens, AssetSelect (#607)                          | #607             | [`decf7e4`](https://github.com/artisam-paiflow/paiflow/commit/decf7e49507a9902759bbbeef85f5edd507babff) |
| 2026-09-21 | fix(trigger): refuse a zero or out-of-i128 amount with a 422                                              | #628             | [`5f4c28d`](https://github.com/artisam-paiflow/paiflow/commit/5f4c28d7c3e08d2a0ebfdb5071017cae0027e0ad) |
| 2026-09-21 | chore(graphify): remove the graphify setup                                                                | #626             | [`95c8871`](https://github.com/artisam-paiflow/paiflow/commit/95c88719f049f49003f939d070b60d6a8faa26c6) |
| 2026-09-21 | chore(graphify): refresh the local graph on pull and branch switch                                        | #625             | [`17b2fb9`](https://github.com/artisam-paiflow/paiflow/commit/17b2fb948212dbfcec9e1edc1f7041cd1d801dde) |
| 2026-09-21 | refactor(builder): extract the Swapper panel and validate the graph once per render                       | #611             | [`fdb04da`](https://github.com/artisam-paiflow/paiflow/commit/fdb04daa3c1435673563314b8a5d1c736bf1f870) |
| 2026-09-21 | test(ci): add a jsdom component-test lane and a CI test report                                            | #606             | [`44928ca`](https://github.com/artisam-paiflow/paiflow/commit/44928ca744f62a7b6f588d992ac5a85bbe3ecd93) |
| 2026-09-21 | chore(graphify): add a local knowledge-graph setup for Claude Code                                        | #624             | [`268200c`](https://github.com/artisam-paiflow/paiflow/commit/268200c50ba594cfecd6671a08fc785300b8d740) |
| 2026-09-21 | docs(instawards): name the D1 panel as D3's "before"                                                      | #621             | [`a84b5da`](https://github.com/artisam-paiflow/paiflow/commit/a84b5dabac7aa87251e7342dfacf21de3fc6d742) |

## Statement of Work progress

Rows that moved this week. The full table, with the change behind each row, lives on the
[D3 page](deliverables/d3.md#traceability).

| SOW clause                                                                   | Deliverable              | Status    | Evidence                                                                                                                                                       |
| ---------------------------------------------------------------------------- | ------------------------ | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Design shared input components (§4.1)                                        | [D3](deliverables/d3.md) | Evidenced | [`21-vitest-junit.xml`](evidence/d3/21-vitest-junit.xml); [props contract](deliverables/d3.md#props-contract)                                                  |
| Adopt them in the Swapper config panel (§4.1; §3.8)                          | [D3](deliverables/d3.md) | Evidenced | [`17`](evidence/d3/17-swap-panel-before-after.png); [recording](https://drive.google.com/file/d/1bcZP0jpYhn_9kdQzs73kr01DpXBeXn2Y/view?usp=sharing), 0:31–2:50 |
| Unify Zod validation schemas and error rendering (§4.1)                      | [D3](deliverables/d3.md) | Evidenced | [`15`](evidence/d3/15-slippage-error-desktop.png); [code-diff note](evidence/d3/20-code-diff.md)                                                               |
| Build the components so they can be reused (§4.1)                            | [D3](deliverables/d3.md) | Done      | One non-swap test per component ([props contract](deliverables/d3.md#props-contract))                                                                          |
| Add component tests (§4.1; §5.1)                                             | [D3](deliverables/d3.md) | Evidenced | Seven `.test.tsx` files, 83 tests, in [`21-vitest-junit.xml`](evidence/d3/21-vitest-junit.xml)                                                                 |
| Accessibility and mobile viewport pass (§4.1; §5.1)                          | [D3](deliverables/d3.md) | Evidenced | [`07`](evidence/d3/07-docked-sheet-mobile.png), [`13`](evidence/d3/13-phone-keyboard-up.jpg) (a real phone); recording, 5:44 and 6:38                          |
| Week 3: "UX pass" (§5.1)                                                     | [D3](deliverables/d3.md) | Evidenced | Before → after pairs in the [evidence pack](evidence/d3/README.md)                                                                                             |
| §3.2: "consistent config-panel inputs and validation messages"               | [D3](deliverables/d3.md) | Evidenced | [`04`](evidence/d3/04-keyboard-error-desktop.png), [`15`](evidence/d3/15-slippage-error-desktop.png)                                                           |
| §3.7(c): inputs standardised "without breaking existing templates"           | [D3](deliverables/d3.md) | Done      | `tests/e2e/swap-panel.spec.ts`; [`18`](evidence/d3/18-pay-panel-legacy-desktop.png), a panel still on the legacy inputs                                        |
| Week 3: "Validation errors display consistently in the Swapper panel" (§5.1) | [D3](deliverables/d3.md) | Evidenced | [`04`](evidence/d3/04-keyboard-error-desktop.png), [`15`](evidence/d3/15-slippage-error-desktop.png)                                                           |
| Week 3: "Shared inputs pass smoke tests" (§5.1)                              | [D3](deliverables/d3.md) | Evidenced | `smoke.test.tsx` in [`21-vitest-junit.xml`](evidence/d3/21-vitest-junit.xml)                                                                                   |
| Week 3: "UI tests green in CI" (§5.1)                                        | [D3](deliverables/d3.md) | Evidenced | [CI run 35982489259](https://github.com/artisam-paiflow/paiflow/actions/runs/35982489259); [`21-ci-summary.png`](evidence/d3/21-ci-summary.png)                |
| §6.1: live app URL, screen recording, side-by-side screenshots, CI report    | [D3](deliverables/d3.md) | Evidenced | [Evidence](deliverables/d3.md#evidence)                                                                                                                        |

Status values: Not started · In progress · Done · **Evidenced** (done _and_ proven by a public
link).

## Evidence added

| Item                                                                                       | Type             | Link                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------ | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Swapper panel before and after D3, side by side**                                        | Screenshot       | [`d3/17-swap-panel-before-after.png`](evidence/d3/17-swap-panel-before-after.png)                                                                                             |
| **Screen recording of building a Swapper flow with the new inputs** (25 Sep, 7:19)         | Recording        | [Google Drive](https://drive.google.com/file/d/1bcZP0jpYhn_9kdQzs73kr01DpXBeXn2Y/view?usp=sharing); record in [`d3/19-recording-run.json`](evidence/d3/19-recording-run.json) |
| The recorded run's deploy, from the builder with Freighter                                 | Transaction hash | [`f82d7486…`](https://stellar.expert/explorer/testnet/tx/f82d74863e90e36184bd7809b525fbf7f923843963b3c3178f94a1b576b33d63)                                                    |
| The recorded run's trigger: 50 XLM → 5.2731437 USDC, split 60/40                           | Transaction hash | [`34048835…`](https://stellar.expert/explorer/testnet/tx/34048835187d7d4c66d496e35bbb4994caee88a82b362131ac5b260d52baeb31)                                                    |
| Raw `getTransaction` for that trigger                                                      | RPC record       | [`d3/19-recording-run.getTransaction.json`](evidence/d3/19-recording-run.getTransaction.json)                                                                                 |
| After D3, from paiflow.xyz: the panel, the builder, keyboard open and error, docked sheet  | Screenshot       | [`03`–`08`](evidence/d3/06-swap-panel-after.png); provenance in [`d3/03-18-after-meta.json`](evidence/d3/03-18-after-meta.json)                                               |
| After D3: the 0.3% slippage floor error on the shared input                                | Screenshot       | [`d3/15-slippage-error-desktop.png`](evidence/d3/15-slippage-error-desktop.png)                                                                                               |
| After D3: Advanced open, the pinned Soroswap router and the deadline                       | Screenshot       | [`d3/16-swap-panel-advanced-after-desktop.png`](evidence/d3/16-swap-panel-advanced-after-desktop.png)                                                                         |
| Contrast: the Pay panel, not migrated, in the same viewport                                | Screenshot       | [`d3/18-pay-panel-legacy-desktop.png`](evidence/d3/18-pay-panel-legacy-desktop.png)                                                                                           |
| Before D3, from paiflow.xyz on 22 September: focus, typing, same-asset error, router       | Screenshot       | [`09`–`12`](evidence/d3/09-swap-panel-keyboard-focus-before.png); provenance in [`d3/09-14-before-meta.json`](evidence/d3/09-14-before-meta.json)                             |
| Before D3: Enter, Space and Escape do not open or close the panel                          | Recording (GIF)  | [`d3/14-keyboard-open-close-before.gif`](evidence/d3/14-keyboard-open-close-before.gif)                                                                                       |
| Real-phone check: slippage field with the keyboard up, no zoom (vivo Y22s, Android 14)     | Screenshot       | [`d3/13-phone-keyboard-up.jpg`](evidence/d3/13-phone-keyboard-up.jpg)                                                                                                         |
| The Swapper panel's change in code, each claim with the command that proves it             | Artefact         | [`d3/20-code-diff.md`](evidence/d3/20-code-diff.md)                                                                                                                           |
| CI job summary for the component tests (public mirror run, 24 Sep)                         | Screenshot       | [`d3/21-ci-summary.png`](evidence/d3/21-ci-summary.png)                                                                                                                       |
| The CI junit report (121 files, 1756 tests; the `dom` project 7 files, 83 tests), run meta | Test report      | [`d3/21-vitest-junit.xml`](evidence/d3/21-vitest-junit.xml), [`d3/21-ci-meta.json`](evidence/d3/21-ci-meta.json)                                                              |
| PostHog swap validation errors before and after the D3 promotion                           | Query result     | [`d3/22-posthog-validation.json`](evidence/d3/22-posthog-validation.json)                                                                                                     |
| The D3 evidence pack, pairing each "before" with its "after"                               | Index            | [`d3/README.md`](evidence/d3/README.md)                                                                                                                                       |
| The live database at the close of week 3                                                   | Metrics          | [`metrics-live-2026-09-26.json`](evidence/metrics-live-2026-09-26.json)                                                                                                       |
| Swapper flows on the live database, D3's recorded run among them                           | Metrics          | [`swapper-flows-live-2026-09-26.json`](evidence/swapper-flows-live-2026-09-26.json)                                                                                           |
| Alpha-tester snapshot, all five issued accounts active, both groups                        | Metrics          | [`alpha-metrics-2026-09-26-groups.json`](evidence/alpha-metrics-2026-09-26-groups.json)                                                                                       |

All four of D3's §6.1 evidence items are present and public. The rebuilt panel has been live on
[paiflow.xyz](https://paiflow.xyz) since 23 September. The screen recording was made on
25 September by a registered account deploying and triggering a swap-and-split flow with Freighter.
The side-by-side capture puts the panel as it was on 22 September beside the panel as it is. The CI
test report comes from the public mirror's own run. Every capture after D3 was taken on a build that
includes the simplified panel (#670). None was taken on a build with #679's phone changes; that fix
is evidenced by its code and tests only.

## Metrics

See [metrics](metrics.md) for the running totals and how each number is measured.

| Metric                        | Target | Archive (to 16 Sep) | Live (since 15 Sep) | Alpha testers (5 active / 5 issued / 5 planned) |
| ----------------------------- | ------ | ------------------- | ------------------- | ----------------------------------------------- |
| Unique flows deployed         | ≥ 5    | 26                  | 64 (was 36)         | 26 (was 22)                                     |
| Contract executions / events  | ≥ 60   | 61                  | 128 (was 79)        | — (not cohort-filterable)                       |
| Unique swapper flows executed | ≥ 5    | 16                  | 17 (was 11)         | 5 (unchanged)                                   |
| Distinct deploying wallets    | ≥ 6    | 7                   | 20 (was 7)          | 7 (was 5)                                       |
| Contract WASM uploaded        | ≥ 1    | 1                   | 1                   | 1 (the same binary)                             |

"Was" is the 18 September snapshot, the last one in week 2. The archive column is frozen at the
16 September cutover and does not move.

The live database was read again on 26 September
([`evidence/metrics-live-2026-09-26.json`](evidence/metrics-live-2026-09-26.json)). Its swapper
flows now outnumber the archive's, 17 against 16, and all 17 belong to registered accounts rather
than sandbox visitors: 24 swap transactions from 9 distinct signers
([`evidence/swapper-flows-live-2026-09-26.json`](evidence/swapper-flows-live-2026-09-26.json)).
Six of them are new since 18 September. The last of those is D3's recorded run, deployment
`a0072403-163d-436e-a35b-1ed7798b668b`, with its swap-and-split
[`34048835…`](https://stellar.expert/explorer/testnet/tx/34048835187d7d4c66d496e35bbb4994caee88a82b362131ac5b260d52baeb31).
It was the project's own evidence run, from a registered `USER` account on paiflow.xyz, and both of
its recipients are the project's own wallets. It counts under the usual rules as public-app
activity, not as outside use. Deploying wallets went from 7 to 20 in the same week that sandbox sessions went from 14 to 31
(44 users in all, against 22), and a sandbox session signs with the visitor's own wallet. The
snapshot does not split wallets by account type, so how much of the rise they account for is not
measured.

On the alpha-tester basis
([`evidence/alpha-metrics-2026-09-26-groups.json`](evidence/alpha-metrics-2026-09-26-groups.json)),
the round now has all five planned testers, and all five have run a session: the project member's
pilot and **four external testers, two on the interview protocol (group A) and two on the quick
test (group B)**. The two group B testers ran their sessions on 22 and 24 September. The quick test
reaches the deploy review without a wallet and makes deploying an optional bonus, so group B moved
the figures little by design: one bonus deploy added a seventh deploying wallet. Those seven are
addresses, not people: three of them belong to the one project member in the round, so the target
is met by addresses from four people, as the [metrics page](metrics.md) explains. PostHog misses a
counterpart for two records, one of tester-3's deployments and one of tester-10's; the figures are
reported as generated rather than corrected by hand.

## Decisions

- **No blockers to the deliverable.** D3's code is merged, and the promotion that put it on the
  public app (#636) landed on 23 September, ahead of every capture and the recording. Each of the
  thirteen SOW rows above is Done or Evidenced. The two left at Done, reuse in other node types and
  "without breaking existing templates", are proven by tests rather than a capture, which is how
  they are meant to be proven.
- **Three departures from the SOW's wording, none of them a drop in scope.** Each is recorded with
  its reason in the [D3 scope notes](deliverables/d3.md#scope-notes), without editing the SOW.
  - **The router is shown, not chosen**, carried over from D1. An editable router would let a flow
    send its funds through an arbitrary contract.
  - **Slippage is the share input, and the amount input sizes the quote but stores nothing.**
    Storing an amount would change the contract's interface and replace the WASM hash D1
    evidenced.
  - **The two cross-field swap rules live in the deploy gate, not in the Zod shape.** The editor
    autosaves through a route that parses the graph, so a cross-field rule there would refuse every
    autosave of a half-built flow and lose the user's edits.
- **Two notes from the record correction (#645).**
  - The deadline is a fifth field with no shared component of its own. The SOW names four
    components, not "only four fields".
  - Reduced motion covers the canvas edge animation only since #647. Before that fix the animation
    was set inline, where the reduced-motion rule did not reach it.
- **The panel was simplified after the rebuild** (#670, 24 September). With every field at equal
  weight and several lines of help under each, the rebuilt panel was still hard to read. #670
  changed its presentation only:
  - one line of help per field;
  - a Preview card with the quote as its figure;
  - the router and deadline behind a collapsed Advanced section that opens itself on an error.

  The `swap` config, validation and contracts are untouched. Every "after" capture, the recording
  and the CI report were taken on a build that includes it.

- **Four development-only dependencies, added with the component-test lane** (#622):
  - `jsdom` is the DOM the component tests run in;
  - `@testing-library/react` renders components and queries them by role, the way the
    accessibility work has to be asserted;
  - `@testing-library/user-event` types real keystroke sequences, which is how the lost decimal
    point in `1.5` (#615) shows up;
  - `axe-core` runs the accessibility scan in component tests and in Playwright.

  None of them reaches the shipped bundle. `pnpm audit` was unchanged from `develop` (1 low,
  1 moderate, both pre-existing). jsdom's Node floor then led CI to pin its Node version to
  `package.json` (#649).

- **The PostHog before-and-after is not reported as a result, because there was too little traffic
  to compare.** In the 7 days before the D3 panel went live (to 23 September, 00:53 UTC), 4 people
  produced 26 swap validation errors. In the 2.6 days after, 3 people produced 20. All of them were
  on beta.app.paiflow.xyz, and `swap.config.slippageBps` did not appear in either window. That is
  too few people to read a change from, so there is no chart
  ([`d3/22-posthog-validation.json`](evidence/d3/22-posthog-validation.json)).

## Issues found and fixed

Defects caught and closed inside the week, and what each would have done if it had shipped.

- **Keyboard focus on the canvas was invisible** (PR #677). Tab reached the flow's nodes and edges,
  but nothing on screen showed it: React Flow draws a focus ring only for its built-in node types,
  and Paiflow's are custom. Found while rehearsing the screen recording on paiflow.xyz. A focused
  node or edge now shows a primary-coloured ring, and a **Skip to canvas** button is the first stop
  after the header. If shipped, a keyboard user would have been tabbing through the canvas blind (a
  WCAG 2.4.7 failure), and the keyboard-only part of the recording could not have been followed.
- **On a phone the builder's controls covered most of the canvas** (PR #679). On a Pixel 7:
  - the header wrapped onto two rows;
  - Ask AI sat on top of the flow title;
  - the English preview took three lines;
  - the MiniMap covered part of the canvas;
  - the canvas's bottom edge sat under the browser's address bar.

  Now the header is one row, the preview collapses behind a toggle (its error count stays visible),
  Ask AI is a bottom-right button and the MiniMap is hidden. Two further defects surfaced along the
  way and were fixed in the same PR:
  - the Errors button carried `role="alert"`, which hid its button role from assistive tech;
  - the docked sheet covered the moved Ask AI button while leaving it in the tab order, so focus
    could land on something unseen.

  If shipped, a phone user would have built flows in a strip of canvas. The fix is evidenced by code
  and tests only; no capture was taken on a build that has it.

- **The slippage field rewrote itself while being typed** (#454, fixed by #633). The 0.3% floor was
  applied on every keystroke, so typing `0.5` ended as `0.35`, with no message. The floor now
  applies when the field loses focus and says "Raised to the minimum, 0.3%." If shipped unchanged,
  users could not type a value below 1% and would not have been told the value had changed.
- **A negative test could no longer fail** (#453, fixed by #633). The end-to-end case for 0 bps
  slippage had been unreachable since the floor landed. It is replaced by an API-level case that
  expects a 422. If left, it would have given false assurance.
- **The config panel could not be opened or closed from the keyboard** (#634). Enter and Space
  selected a node without opening its panel, and there was no Close button and no Escape. A keyboard
  user could not configure a flow at all.
- **Dragging a node toggled its panel** (#634). A drag opened or closed the settings as a side
  effect.
- **On a 412px-wide phone the page was 560px wide** (#634). The canvas column grew to the toolbar's
  width, and the sheet's Close and Delete buttons landed off screen.
- **A `PENDING:` asset issuer on a swap was a 500** (#631). Preparing the deployment threw and
  marked it `FAILED` with no field error. It is now a 422 naming the field. #617, the wider report
  that covers every node's custom asset and not only swap's, is still open.
- **A zero or oversized trigger amount was a 500** (#628). `"0"` was accepted, and a digit string
  past the 128-bit range threw while being encoded, on a public, sandbox-reachable route. Both are
  now a 422 on `amount`, before any database read.
- **Reduced motion did not stop the canvas edge animation** (#647). The animation was set inline,
  where the reduced-motion rule could not override it. Motion-sensitive users would have kept seeing
  it.
- **The address picker's editable mode bypassed the shared styles** (#648). Its 14px text makes iOS
  zoom the page on focus, and its targets were small. Every panel that uses it would have zoomed
  and been hard to tap on a phone.
- **The save-to-address-book button had no accessible name and needed two clicks** (#661). A screen
  reader read it as "bookmark_add". The first click opened the save form and an effect wiped it
  straight away.
- **The config panel kept its own copy of the issue logic** (#646). The tested `nodeIssues()` was
  unused. There was no visible defect, but the panel and the tested code could have drifted apart.
- **"A same-asset swap is refused at prepare" was claimed but not tested, and CI could run on a Node
  below jsdom's floor** (#649). Both are closed: a test proves the refusal, and CI reads its Node
  version from `package.json`.

The builder survey of 20 September filed six issues that are **still open**, not absorbed into D3:

- #615, the decimal point lost in amount fields outside the Swapper panel;
- #616, the global `.input` style with no focus style;
- #617, the `PENDING:` issuer on any node;
- #618, no check that a Soroswap pool exists before deploy;
- #619, duplicate address and stroops schemas;
- #620, low-severity follow-ups.

D3's own inputs fix #615 for the Swapper panel only.

## Planned maintenance

A read-only TTL check on 24 September (#636) found nothing archived. The WASM code entries,
including the factory and the swapper, stay live to about 11 March 2027 (ledger 7742749 onward).
The public factory instance runs to ledger 7756749, and needs extending before then; it is one of
the contracts with no `extend_ttl` call of its own. The Soroswap router,
`CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD`, is Soroswap's contract, not ours. It
runs to ledger 7561567, about 157 days from the check. `pnpm soroswap:check` confirmed it on the
same day with a 10 XLM → 1.05 USDC quote.

One trap is worth writing down. A default `pnpm contracts:extend-ttl` run reads `.env.local`, whose
local swapper and factory entries are already archived. The run has to be pointed at the deployed
hashes. Defect #459, where a deploy with an archived WASM entry still simulates successfully, remains
open.

## Next week

Week 4 is the validation package in §5.1 of the Statement of Work:

- an end-to-end integration test with an external wallet;
- a 3–5 minute technical demo video;
- an integration guide with curl examples and sample XDR payloads;
- the list of every on-chain receipt's transaction hash on Stellar Expert;
- a final CI and typecheck pass;
- the evidence handoff for the Ambassador Chapter Lead.

D3 is complete. The alpha round continues alongside.
