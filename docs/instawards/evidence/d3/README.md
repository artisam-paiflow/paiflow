# D3 evidence pack

The evidence for [D3 — Shared builder inputs](../../deliverables/d3.md): the Swapper panel before
and after it was rebuilt on the shared inputs, the recorded run, the code change, the CI test
report and the product-analytics check.

Every app capture comes from the public app. The screenshots are from [paiflow.xyz](https://paiflow.xyz)
except `13`, which is from beta.app.paiflow.xyz, the same Railway service, so it ran the same build as paiflow.xyz at the time
([counting rules](../../metrics.md#counting-rules)). `21-ci-summary.png` is a GitHub Actions page
and `22` is a PostHog query, so neither is an app capture. Where a meta file sits beside a set, it
records the URL (the flow id elided), the build, the browser and the viewport.

## Which "before" is which

There are two, and only one of them is D3's.

- **`00`–`02`, 9 September: the pre-sprint baseline, D1's "before".** paiflow.xyz still served the
  pre-D1 panel then: `Asset In`, `Asset Out` and a raw `Rate (basis points, 1–10000)`, with no
  slippage, no deadline and no router. The fields that differ between these shots and today's panel
  are D1's work and are not claimed for D3.
- **D3's "before" is D1's "after"**, [`d1/02-swap-panel-after.png`](../d1/02-swap-panel-after.png)
  and [`d1/08-swap-panel-live-quote.png`](../d1/08-swap-panel-live-quote.png), plus **`09`–`14`**:
  the same D1 panel on paiflow.xyz on 22 September (the #599 build, before #612 and #613 were
  promoted), captured to show what D3 fixes in it: keyboard focus, the slippage field, the
  same-asset error, the router and the keyboard open/close.

## Numbering

The numbers record the order the files were claimed, not a single sequence. `03`–`08` were first
used by #613's end-to-end spec, so #614's before set took `09`–`14`. #637 continued the after set at
`15`–`18`, then re-captured `03`–`08` and `15` from paiflow.xyz under the same names, replacing
their original local-dev output. `13` was held for the real-phone check (#641), which was made after D3 was
promoted, so it shows the new panel even though it sits in the before range. `19`–`22` are the
recording, the code diff, the CI report and the PostHog check.

## Files

| File                                                                      | What it is                                                                                                                                                                                                                                                                  | Status                                  |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `00-palette-before.png`                                                   | The palette before the Swap block was unhidden, paiflow.xyz, 9 September                                                                                                                                                                                                    | **Pre-sprint baseline (D1's "before")** |
| `01-builder-before.png`                                                   | The builder with the pre-D1 swap node selected, 9 September                                                                                                                                                                                                                 | **Pre-sprint baseline (D1's "before")** |
| `02-swap-panel-before.png`                                                | The pre-D1 Swapper panel: two assets and a raw rate field, 9 September                                                                                                                                                                                                      | **Pre-sprint baseline (D1's "before")** |
| `03-18-after-meta.json`                                                   | Provenance for `03`–`08` and `15`–`18`: paiflow.xyz on 25 September (staging `27f7f68`), `tests/e2e/d3-swap-panel.spec.ts` in a no-account sandbox session, the viewports, the router id, how `17` was composed, and the before → after pairs below                         | After (#637)                            |
| `03-keyboard-open-{desktop,mobile}.png`                                   | The panel opened with Enter on the focused Swap node, focus on the "Swap settings" heading                                                                                                                                                                                  | After (#637)                            |
| `04-keyboard-error-{desktop,mobile}.png`                                  | `Asset Out` moved onto XLM from the keyboard: the same-asset error under the control, which carries `aria-invalid` and `aria-describedby`                                                                                                                                   | After (#637)                            |
| `05-builder-after.png`                                                    | The desktop builder with the floating panel open and the live quote loaded                                                                                                                                                                                                  | After (#637)                            |
| `06-swap-panel-after.png`                                                 | The desktop panel alone, with the live quote loaded                                                                                                                                                                                                                         | After (#637)                            |
| `07-docked-sheet-mobile.png`                                              | The Pixel 7 (412px) bottom sheet with the live quote loaded                                                                                                                                                                                                                 | After (#637)                            |
| `08-docked-sheet-scrolled-mobile.png`                                     | The same sheet scrolled to its foot, the live quote in the ticket                                                                                                                                                                                                           | After (#637)                            |
| `09-14-before-meta.json`                                                  | Provenance for `09`–`14`: paiflow.xyz on 22 September, the #599 build, Chrome at 1536×904 and devicePixelRatio 1.25, and one finding per capture                                                                                                                            | D3's "before" (#614)                    |
| `09-swap-panel-keyboard-focus-before.png`                                 | The slippage field reached from the keyboard, showing only the browser's default outline; the focused canvas node shows no focus at all                                                                                                                                     | D3's "before" (#614)                    |
| `10-slippage-typing-before-{1,2,3}.png`, `10-slippage-typing-before.json` | Typing `0.5` into `Max slippage (%)`, one capture per keystroke: `0 → 0.3`, `. → 0.3`, `5 → 0.35`, because the 0.3% floor was applied on every keystroke                                                                                                                    | D3's "before" (#614)                    |
| `11-same-asset-error-before.png`                                          | The same-asset message under `Asset Out`, with no `aria-invalid`, no `aria-describedby` and no live region, so it is never announced                                                                                                                                        | D3's "before" (#614)                    |
| `12-router-select-before.png`                                             | The router as a disabled one-option select, "Soroswap (testnet)", with no contract id shown                                                                                                                                                                                 | D3's "before" (#614)                    |
| `13-phone-keyboard-up.jpg`, `13-phone-meta.json`                          | A real phone (vivo Y22s, Android 14, Chrome) on beta.app.paiflow.xyz, 25 September: `Max slippage (%)` focused with the keyboard up, the field and its hint still visible, no zoom on focus. Taken after promotion, so it is an "after"                                     | After (#641); no longer reserved        |
| `14-keyboard-open-close-before.gif`                                       | The Swap node reached by Tab, then Enter and Space not opening the panel, and Escape not closing it once it has been opened by click                                                                                                                                        | D3's "before" (#614)                    |
| `15-slippage-error-{desktop,mobile}.png`                                  | A flow saved at 0.1% slippage: the 0.3% floor error on the shared input (#665)                                                                                                                                                                                              | After (#637)                            |
| `16-swap-panel-advanced-after-{desktop,mobile}.png`                       | Advanced open: the pinned Soroswap router (short id, copy button, stellar.expert link) and the deadline, the live quote in the ticket above                                                                                                                                 | After (#637)                            |
| `17-swap-panel-before-after.png`                                          | **The side-by-side**: `09` on the left, scaled to 1 CSS px per pixel, and `16`'s desktop capture on the right, labelled and dated                                                                                                                                           | After (#637)                            |
| `18-pay-panel-legacy-{desktop,mobile}.png`                                | The contrast: the Pay panel in the same viewport, still on the legacy asset select, payout-mode select and bare checkbox beside the migrated address picker                                                                                                                 | After (#637)                            |
| `19-recording-run.json`, `19-recording-run.getTransaction.json`           | The record of the [screen recording](https://drive.google.com/file/d/1bcZP0jpYhn_9kdQzs73kr01DpXBeXn2Y/view?usp=sharing) (25 September, 7:19): timestamps, pipeline, amounts, and the raw RPC responses for the deploy and the 50 XLM trigger                               | Present (#639)                          |
| `20-code-diff.md`                                                         | The change shown in code. Each claim comes with the command that proves it: four shared inputs, swap code removed from `config-panel.tsx`, one `validateFlow` call, one rule function, one error flattener, one path normaliser, and the legacy panels kept as the contrast | Present (#638)                          |
| `21-vitest-junit.xml`                                                     | The junit report from [public mirror CI run 35982489259](https://github.com/artisam-paiflow/paiflow/actions/runs/35982489259) (the #670 merge, mirror `5a866ae`): 121 files, 1756 tests, `dom` 7 files / 83 tests                                                           | Present (#640)                          |
| `21-ci-summary.png`                                                       | That run's node job summary, captured signed in (GitHub hides summaries from signed-out viewers)                                                                                                                                                                            | Present (#640)                          |
| `21-ci-meta.json`                                                         | The run URL, SHAs, resolved Node v22.23.2, artifact digest, counts and cross-checks                                                                                                                                                                                         | Present (#640)                          |
| `22-posthog-validation.json`                                              | PostHog swap validation errors in the week before and the days after the D3 promotion, with the queries. Verdict: too little traffic to compare                                                                                                                             | Present (#641)                          |

## Before → after pairs

`03-18-after-meta.json` pairs each D3 "before" with the "after" that answers it, and records what
no capture shows.

| Before | After                  | What changed                                                                                                              | Not captured                                                                                                                                                                                           |
| ------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `09`   | `03`, `04`             | Enter on the focused node opens the panel with focus on its heading; the focused control carries the app's own focus ring | No after shot has a valid field focused (the ring in `04` is its error variant). The canvas node's focus ring came later; the recording shows it on paiflow.xyz                                        |
| `10`   | `15`                   | A value below the 0.3% floor shows the floor error on the shared input, announced through `aria-describedby`              | No capture of the typing itself: that `0.5` stays `0.5` and `0.1` is raised to `0.3` on blur is covered by `swap-panel.test.tsx` and `share-input.test.tsx`, and the recording shows the clamp on blur |
| `11`   | `04`                   | The same-asset error, with `aria-invalid` on the control and the message in its `aria-describedby`                        |                                                                                                                                                                                                        |
| `12`   | `16`                   | The pinned router in place of the one-option select: short id, copy button, stellar.expert link                           | The stellar.expert page itself; the spec asserts the link's target instead                                                                                                                             |
| `14`   | the recording, at 5:44 | A visible focus ring across the canvas, Enter opening a node's panel and Escape closing it with focus back on the node    | That segment uses the On Receive node; the Swap panel's full keyboard walk is asserted by `tests/e2e/d3-swap-panel.spec.ts`                                                                            |

`17` is the one-picture version of the `09`/`16` pair, which is what SOW §6.1's "side-by-side"
asks for. `18` is the panel D3 did not migrate, kept as the argument for adopting the shared inputs
across the rest of the builder in a later phase.
