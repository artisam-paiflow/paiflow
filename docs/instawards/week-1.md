# Week 1 — 7–13 September 2026

**Window:** 7–13 September 2026 · **Focus:** D1 — the swapper executes a real swap through the Soroswap testnet router

_Interim report, written on Wednesday 9 September. Final figures on 13 September._

## Summary

The Swap block now exists end to end in the code: the contract calls the Soroswap router, the
pipeline compiles a swap block into it, and the builder shows the block and its settings. On
9 September it was exercised in a browser for the first time and behaved as specified, and the
live price preview that shows what a swap will return before deployment was merged the same day. What is
still missing is the proof the Statement of Work asks for — a swap flow deployed and triggered
from the public app, with its transaction on the explorer.

## Changelog

Generated with:

```bash
pnpm instawards:changelog --since 2026-09-07 --until 2026-09-13 \
  --ref mirror/develop --repo https://github.com/artisam-paiflow/paiflow
```

| Date       | Change                                                                            | Issues | Commit                                                                 |
| ---------- | --------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------- |
| 2026-09-09 | fix(tooling): deploy the factory when the hash is unchanged but none exists       | #394   | `05645d4` — mirror sync pending                                        |
| 2026-09-09 | feat(builder): live Soroswap quote in the swap panel and the deploy review        | #391   | `6ddd138` — mirror sync pending                                        |
| 2026-09-09 | feat(builder): show the Swap block, name the router's network, surface its errors | #402   | `b8fd9b8` — mirror sync pending                                        |
| 2026-09-07 | feat(pipeline): route the swap block through the Soroswap-backed swapper          | #388   | [`3a76e93`](https://github.com/artisam-paiflow/paiflow/commit/3a76e93) |
| 2026-09-07 | feat(swapper): swap through the Soroswap router with a spot-price slippage bound  | #387   | [`3315ea3`](https://github.com/artisam-paiflow/paiflow/commit/3315ea3) |

Every code change planned for D1 is merged. The one item still open is #390, the testnet
deploy-and-trigger run that produces the SOW evidence.

## Statement of Work progress

Rows that moved this week. The full tables live on the deliverable pages.

| SOW clause                                                                                                                              | Deliverable | Status      | Evidence                                                          |
| --------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ----------- | ----------------------------------------------------------------- |
| Call `swap_exact_tokens_for_tokens` on the Soroswap router; `execute_step`; `amount_out_min` from `slippage_bps`; constructor arguments | D1          | Done        | contract + unit tests; stage-1 tx `5389cdee…` (verification copy) |
| Swap flows no longer map to the splitter kind; constructor serialization; swap validation rules; swap event parsing                     | D1          | Done        | unit tests; local e2e stills 03–06                                |
| Swap block visible in the palette; configuration panel; edge-case errors display clearly                                                | D1          | Done        | local e2e stills 01–06                                            |
| Swapper simulation preview                                                                                                              | D1          | Done        | local e2e stills 07–10; live testnet quote                        |
| Deploy and trigger a swapper flow on testnet                                                                                            | D1          | In progress | stage 1 proven 6 Sep; stage 2 not started                         |

Status values: Not started · In progress · Done · **Evidenced** (done _and_ proven by a public
link).

Nothing is **Evidenced** yet: every artefact so far was produced on a local or verification
environment, and the counting rule is activity from [paiflow.xyz](https://paiflow.xyz).

## Evidence added

_Screenshots, recordings, transaction hashes and API samples added this week, linked from the_
_[evidence index](evidence/README.md)._

| Item                                                                                     | Type                          | Link                                                                                                                       |
| ---------------------------------------------------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Contract-as-payer swap through the real router (stage-1 proof, verification copy, 6 Sep) | Transaction                   | [`5389cdee…`](https://stellar.expert/explorer/testnet/tx/5389cdee87826b944f4fca397c0fadc8524cbb2429c2a657a306a06a4c5fc673) |
| Swapper WASM hash on testnet                                                             | Contract                      | `e9482ff07fcf4791aa3f8deebeda6159081a04f13e8ac63c28e91b7f80b23d1a`                                                         |
| Builder, panel, five edge-case errors, deploy review, live quote (local e2e run, 9 Sep)  | 7 screenshots + 3 API samples | held until the deploy-and-trigger run                                                                                      |

## Metrics

See [metrics](metrics.md) for the running totals and how each number is measured.

| Metric                        | Target | At end of week 1 | Change |
| ----------------------------- | ------ | ---------------- | ------ |
| Unique flows deployed         | ≥ 5    | 0 (9 Sep)        | —      |
| Contract executions / events  | ≥ 60   | 0 (9 Sep)        | —      |
| Unique swapper flows executed | ≥ 5    | 0 (9 Sep)        | —      |
| Distinct deploying wallets    | ≥ 6    | 0 (9 Sep)        | —      |
| Contract WASM uploaded        | ≥ 1    | 0 (9 Sep)        | —      |

All zero because nothing has yet been deployed from the public app; the swapper WASM was
uploaded from a development environment, which the counting rule excludes. Snapshot to be
retaken on 13 September.

## Decisions and blockers

- **Router not user-selectable; no new asset type; one output per swap.** Recorded as scope
  notes on the [D1 page](deliverables/d1.md) rather than by editing the approved SOW.
- **Action ordering.** The pipeline compiles the first contract action in canvas-insertion
  order, so a correctly drawn `receive → swap → pay` could silently drop the swap if the Pay
  block was added first. A fail-closed guard is merged (the flow is refused rather than
  mis-deployed); compiling in topological order is deferred to its own change.
- **Fresh-environment deploy bug.** `pnpm contracts:deploy:testnet` never deployed a factory on
  a machine with no prior state, so nothing could deploy. Reproduced against `develop`, fixed,
  and verified on 9 September (factory `CBYIUUKY…GZ726A`). This would have blocked the
  testnet evidence run; merged.
- **No blocker to the deliverable.** The remaining work is the deploy-and-trigger run itself,
  which depends on the public app being updated to `develop`.

## Next week

If the deploy-and-trigger run does not land by 13 September it is the first thing in week 2,
before any D2 work starts: deploy a swap flow from paiflow.xyz, fund it, capture the swap
transaction and the recording, publish the held screenshot set, and sync the public mirror so
every commit link resolves. D2 (developer API) starts once that evidence is public.
