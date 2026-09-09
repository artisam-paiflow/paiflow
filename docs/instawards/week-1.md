# Week 1 — 7–13 September 2026

**Window:** 7–13 September 2026 · **Focus:** D1 — the swapper executes a real swap through the Soroswap testnet router

_Interim report, written on Wednesday 9 September. Final figures on 13 September._

## Summary

The Swap block is live on [paiflow.xyz](https://paiflow.xyz). The contract calls the Soroswap
router, the pipeline compiles a swap block into it, and the builder shows the block, its
settings and a live price preview of what a swap will return before deployment. All of it was
deployed to the public app on 9 September and verified there, not on a development machine: the
builder spec passes 9/9 against paiflow.xyz and the eleven screenshots and API samples in the
evidence index are its output.

What is still missing is the last piece the Statement of Work asks for — a swap flow deployed
and triggered from the public app, with its transaction on the explorer.

## Changelog

Generated with:

```bash
pnpm instawards:changelog --since 2026-09-07 --until 2026-09-13 \
  --ref mirror/develop --repo https://github.com/artisam-paiflow/paiflow
```

| Date       | Change                                                                            | Issues | Commit                                                                                                  |
| ---------- | --------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------- |
| 2026-09-09 | docs(instawards): D1 status and week-1 interim report as of 9 September           | #409   | [`3da0c2e`](https://github.com/artisam-paiflow/paiflow/commit/3da0c2edb98a750c256f9fb801cf365424a85824) |
| 2026-09-09 | fix(tooling): deploy the factory when the hash is unchanged but none exists       | #394   | [`861bc5b`](https://github.com/artisam-paiflow/paiflow/commit/861bc5bfdd37afc94e268ef20cdf9a9b43ba5d4a) |
| 2026-09-09 | feat(builder): live Soroswap quote in the swap panel and the deploy review        | #391   | [`51b3f6f`](https://github.com/artisam-paiflow/paiflow/commit/51b3f6f5fb92e2d3d8fe063fef3987fb1fd07056) |
| 2026-09-09 | feat(builder): show the Swap block, name the router's network, surface its errors | #402   | [`74a91e6`](https://github.com/artisam-paiflow/paiflow/commit/74a91e61a6f84f1e983d9d84bdbb20541b200540) |
| 2026-09-07 | feat(pipeline): route the swap block through the Soroswap-backed swapper          | #388   | [`3a76e93`](https://github.com/artisam-paiflow/paiflow/commit/3a76e93)                                  |
| 2026-09-07 | feat(swapper): swap through the Soroswap router with a spot-price slippage bound  | #387   | [`3315ea3`](https://github.com/artisam-paiflow/paiflow/commit/3315ea3)                                  |

Every code change planned for D1 is merged. The one item still open is #390, the testnet
deploy-and-trigger run that produces the SOW evidence.

## Statement of Work progress

Rows that moved this week. The full tables live on the deliverable pages.

| SOW clause                                                                                                                              | Deliverable | Status      | Evidence                                                          |
| --------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ----------- | ----------------------------------------------------------------- |
| Call `swap_exact_tokens_for_tokens` on the Soroswap router; `execute_step`; `amount_out_min` from `slippage_bps`; constructor arguments | D1          | Done        | contract + unit tests; stage-1 tx `5389cdee…` (verification copy) |
| Swap flows no longer map to the splitter kind; constructor serialization; swap validation rules; swap event parsing                     | D1          | Evidenced   | unit tests; paiflow.xyz captures 03–06                            |
| Swap block visible in the palette; configuration panel; edge-case errors display clearly                                                | D1          | Evidenced   | paiflow.xyz captures 01–06                                        |
| Swapper simulation preview                                                                                                              | D1          | Evidenced   | paiflow.xyz captures 07–10; live quote from the public app        |
| Deploy and trigger a swapper flow on testnet                                                                                            | D1          | In progress | stage 1 proven 6 Sep; stage 2 not started                         |

Status values: Not started · In progress · Done · **Evidenced** (done _and_ proven by a public
link).

The three builder rows became **Evidenced** on 9 September, when D1 was deployed to
[paiflow.xyz](https://paiflow.xyz) and the capture set was retaken there. The contract row stays
**Done** rather than Evidenced: its only on-chain proof is still the 6 September transaction from
the verification copy, which the counting rule excludes. Both it and the last row clear once the
deploy-and-trigger run produces a swap transaction from the public app.

## Evidence added

_Screenshots, recordings, transaction hashes and API samples added this week, linked from the_
_[evidence index](evidence/README.md)._

| Item                                                                                     | Type                          | Link                                                                                                                                                  |
| ---------------------------------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contract-as-payer swap through the real router (stage-1 proof, verification copy, 6 Sep) | Transaction                   | [`5389cdee…`](https://stellar.expert/explorer/testnet/tx/5389cdee87826b944f4fca397c0fadc8524cbb2429c2a657a306a06a4c5fc673)                            |
| Swapper WASM hash on testnet                                                             | Contract                      | [`e9482ff0…b23d1a`](https://api.stellar.expert/explorer/testnet/wasm/e9482ff07fcf4791aa3f8deebeda6159081a04f13e8ac63c28e91b7f80b23d1a) — 25,371 bytes |
| Swapper panel, builder and palette **before** D1, from paiflow.xyz (9 Sep)               | 3 screenshots                 | `d3/00`–`02` — the D3 "before" evidence, capturable only while the public app still ran pre-D1 code                                                   |
| Builder, panel, five edge-case errors, deploy review, live quote (local e2e run, 9 Sep)  | 7 screenshots + 3 API samples | held until the deploy-and-trigger run                                                                                                                 |

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
- **Two things the deploy needed beyond merging the branch.** Found while shipping D1 to the
  public app on 9 September, both worth recording because neither is obvious from the code.
  First, the Soroswap router address is read from the environment with no database fallback, so
  it has to be set on the service or every swap deployment is refused. Second, the app's
  `SWAPPER` contract-template row still pointed at the June binary, and the app reads that row
  _before_ falling back to the environment — left stale, the factory would have instantiated the
  old swapper against the new constructor and every swap deploy would have failed on-chain.
- **Merging into the deploy branch does not deploy on its own.** The deploy trigger waits for
  GitHub check suites, and every pull request targeting that branch currently fails to start its
  Actions run, so the platform recorded the merge and skipped the build. Pull requests into
  `develop` are unaffected, and the same commits pass there. The deploy was made explicitly
  instead. The Actions failure is not new to this work and is being tracked separately.
- **No blocker to the deliverable.** The public app now runs D1. The remaining work is the
  deploy-and-trigger run itself.

## Next week

If the deploy-and-trigger run does not land by 13 September it is the first thing in week 2,
before any D2 work starts: deploy a swap flow from paiflow.xyz with a browser wallet, fund it,
and capture the swap transaction and the recording. The public app is already updated and the
capture set already published, so that run is all that is left. The public mirror is synced —
every commit link in this report resolves. D2 (developer API) starts once the swap evidence is
public.
