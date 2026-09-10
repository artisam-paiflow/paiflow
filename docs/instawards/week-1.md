# Week 1 — 7–13 September 2026

**Window:** 7–13 September 2026 · **Focus:** D1 — the swapper executes a real swap through the Soroswap testnet router

_Interim report, written on Thursday 10 September. Final figures on 13 September._

## Summary

The Swap block now exists end to end in the code: the contract calls the Soroswap router, the
pipeline compiles a swap block into it, and the builder shows the block and its settings. On
9 September it was exercised in a browser for the first time and behaved as specified, and the
live price preview that shows what a swap will return before deployment was merged the same day.
On 10 September the app was promoted to the staging environment and a swap flow was deployed
and triggered there; that run found an empty event feed after the trigger and a slippage setting
the pool fee would always defeat, and both fixes are merged. The login page now offers
"try the sandbox", so a reviewer reaches the Swap block with no account. What is still missing
is the proof the Statement of Work asks for — a swap flow deployed and triggered from the public
app, with its transaction on the explorer.

## Changelog

Generated with:

```bash
pnpm instawards:changelog --since 2026-09-07 --until 2026-09-13 \
  --ref mirror/develop --repo https://github.com/artisam-paiflow/paiflow
```

| Date       | Change                                                                                   | Issues | Commit                                                                                                  |
| ---------- | ---------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------- |
| 2026-09-10 | feat(auth): public sandbox session replaces the judge credentials panel                  | #423   | [`728d4c9`](https://github.com/artisam-paiflow/paiflow/commit/728d4c9f0642445b31e6e91e10d8abe6331928db) |
| 2026-09-10 | fix(swap): ingest events on trigger confirm, refuse sub-fee slippage, cover swapper auth | #422   | [`8b39daa`](https://github.com/artisam-paiflow/paiflow/commit/8b39daad26f55c3fe0c09a9bb7ec4b555891fdda) |
| 2026-09-10 | ci: run the workflow on develop, staging and main only                                   | #421   | [`7782295`](https://github.com/artisam-paiflow/paiflow/commit/77822959be30ec780deec7eec87a1902b6bdd525) |
| 2026-09-09 | fix(scval): serialize the yield constructor with the four args it declares               | #392   | [`8de1e20`](https://github.com/artisam-paiflow/paiflow/commit/8de1e2038cc9ee0ed2efccc18cea6b504c0f14c4) |
| 2026-09-09 | fix(flows): compile the action the trigger reaches first, not the one drawn first        | #405   | [`55494be`](https://github.com/artisam-paiflow/paiflow/commit/55494bea6fe240d18d9cb0ac6da88a769c1df553) |
| 2026-09-09 | fix(tests): isolate the unit suite from the developer's shell environment                | #406   | [`8ee010b`](https://github.com/artisam-paiflow/paiflow/commit/8ee010b8c0de1187decf67389db7531e31c1edd7) |
| 2026-09-09 | docs(instawards): D3 "before" evidence from paiflow.xyz, and public commit links         | #411   | [`4302aa6`](https://github.com/artisam-paiflow/paiflow/commit/4302aa66b1eb427db9197f24cf845dd972bcdbfd) |
| 2026-09-09 | test(d1): soroswap check script and the testnet deploy-and-trigger spec                  | #410   | [`c5c50af`](https://github.com/artisam-paiflow/paiflow/commit/c5c50afed0c2976f5a573da7a5d1ae87accf6560) |
| 2026-09-09 | docs(instawards): D1 status and week-1 interim report as of 9 September                  | #409   | [`3da0c2e`](https://github.com/artisam-paiflow/paiflow/commit/3da0c2edb98a750c256f9fb801cf365424a85824) |
| 2026-09-09 | fix(tooling): deploy the factory when the hash is unchanged but none exists              | #394   | [`861bc5b`](https://github.com/artisam-paiflow/paiflow/commit/861bc5bfdd37afc94e268ef20cdf9a9b43ba5d4a) |
| 2026-09-09 | feat(builder): live Soroswap quote in the swap panel and the deploy review               | #403   | [`51b3f6f`](https://github.com/artisam-paiflow/paiflow/commit/51b3f6f5fb92e2d3d8fe063fef3987fb1fd07056) |
| 2026-09-09 | feat(builder): show the Swap block, name the router's network, surface its errors        | #402   | [`74a91e6`](https://github.com/artisam-paiflow/paiflow/commit/74a91e61a6f84f1e983d9d84bdbb20541b200540) |
| 2026-09-07 | feat(pipeline): route the swap block through the Soroswap-backed swapper                 | #388   | [`3a76e93`](https://github.com/artisam-paiflow/paiflow/commit/3a76e93)                                  |
| 2026-09-07 | feat(swapper): swap through the Soroswap router with a spot-price slippage bound         | #387   | [`3315ea3`](https://github.com/artisam-paiflow/paiflow/commit/3315ea3)                                  |

Every code change planned for D1 is merged. The one item still open is #390, the testnet
deploy-and-trigger run from the public app that produces the SOW evidence.

## Statement of Work progress

Rows that moved this week. The full tables live on the deliverable pages.

| SOW clause                                                                                                                              | Deliverable | Status      | Evidence                                                          |
| --------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ----------- | ----------------------------------------------------------------- |
| Call `swap_exact_tokens_for_tokens` on the Soroswap router; `execute_step`; `amount_out_min` from `slippage_bps`; constructor arguments | D1          | Done        | contract + unit tests; stage-1 tx `5389cdee…` (verification copy) |
| Swap flows no longer map to the splitter kind; constructor serialization; swap validation rules; swap event parsing                     | D1          | Done        | unit tests; local e2e stills 03–06                                |
| Swap block visible in the palette; configuration panel; edge-case errors display clearly                                                | D1          | Done        | local e2e stills 01–06                                            |
| Swapper simulation preview                                                                                                              | D1          | Done        | local e2e stills 07–10; live testnet quote                        |
| Deploy and trigger a swapper flow on testnet                                                                                            | D1          | In progress | stage 1 proven 6 Sep; staging run 10 Sep; public run not started  |

Status values: Not started · In progress · Done · **Evidenced** (done _and_ proven by a public
link).

Nothing is **Evidenced** yet: every artefact so far was produced on a local, verification or
staging environment, and the counting rule is activity from [paiflow.xyz](https://paiflow.xyz).

## Evidence added

_Screenshots, recordings, transaction hashes and API samples added this week, linked from the_
_[evidence index](evidence/README.md)._

| Item                                                                                     | Type                          | Link                                                                                                                                                  |
| ---------------------------------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contract-as-payer swap through the real router (stage-1 proof, verification copy, 6 Sep) | Transaction                   | [`5389cdee…`](https://stellar.expert/explorer/testnet/tx/5389cdee87826b944f4fca397c0fadc8524cbb2429c2a657a306a06a4c5fc673)                            |
| Swapper WASM hash on testnet                                                             | Contract                      | [`e9482ff0…b23d1a`](https://api.stellar.expert/explorer/testnet/wasm/e9482ff07fcf4791aa3f8deebeda6159081a04f13e8ac63c28e91b7f80b23d1a) — 25,371 bytes |
| Swapper panel, builder and palette **before** D1, from paiflow.xyz (9 Sep)               | 3 screenshots                 | `d3/00`–`02` — the D3 "before" evidence, capturable only while the public app still ran pre-D1 code                                                   |
| Builder, panel, five edge-case errors, deploy review, live quote (local e2e run, 9 Sep)  | 7 screenshots + 3 API samples | held until the deploy-and-trigger run                                                                                                                 |

The staging run on 10 September is not listed: staging is a private environment, and its
transactions do not count under the counting rule.

## Metrics

See [metrics](metrics.md) for the running totals and how each number is measured.

| Metric                        | Target | At end of week 1 | Change |
| ----------------------------- | ------ | ---------------- | ------ |
| Unique flows deployed         | ≥ 5    | 0 (10 Sep)       | —      |
| Contract executions / events  | ≥ 60   | 0 (10 Sep)       | —      |
| Unique swapper flows executed | ≥ 5    | 0 (10 Sep)       | —      |
| Distinct deploying wallets    | ≥ 6    | 0 (10 Sep)       | —      |
| Contract WASM uploaded        | ≥ 1    | 0 (10 Sep)       | —      |

All zero because nothing has yet been deployed from the public app; the swapper WASM was
uploaded from a development environment, which the counting rule excludes. Snapshot to be
retaken on 13 September.

## Decisions and blockers

- **Router not user-selectable; no new asset type; one output per swap.** Recorded as scope
  notes on the [D1 page](deliverables/d1.md) rather than by editing the approved SOW.
- **Public access without an account.** The login page used to display a shared username and
  password. That panel is gone; "try the sandbox" now creates a disposable sandbox identity
  for the visitor, signed in without a password, that can reach only the builder, the deploy
  screen and the read-only deployment views, and opens on a ready-made XLM → USDC swap flow.
  A sandbox session can deploy only pipelines where every on-chain move is signed by the
  visitor's own wallet; payroll, subscription, cash-out, streaming and webhook pipelines, which
  Paiflow's own signer later acts on, are refused. The feature is off by default and refuses to
  start on mainnet. Nothing custodial changes — the visitor still signs every deployment.
- **Staging run, 10 September.** A swap flow was deployed and triggered on the staging
  environment. Two things went wrong and are fixed: the deployment page showed an empty event
  feed until the background poller ran (events are now read the moment the trigger confirms,
  and the page reads once on open), and a slippage setting below the pool's 0.3 % fee could be
  deployed and then fail on every trigger (refused at validation; the panel floors the input
  at 0.3 %).
- **Action ordering.** The pipeline compiled the first contract action in canvas-insertion
  order, so a correctly drawn `receive → swap → pay` could silently drop the swap if the Pay
  block was added first. Fixed on 9 September: the action the trigger reaches first is the one
  compiled.
- **Fresh-environment deploy bug.** `pnpm contracts:deploy:testnet` never deployed a factory on
  a machine with no prior state, so nothing could deploy. Reproduced against `develop`, fixed,
  and verified on 9 September (factory `CBYIUUKY…GZ726A`). This would have blocked the
  testnet evidence run; merged.
- **No blocker to the deliverable.** The remaining work is the deploy-and-trigger run itself,
  which depends on promoting the staging build to the public app with the sandbox enabled.

## Next week

If the deploy-and-trigger run does not land by 13 September it is the first thing in week 2,
before any D2 work starts: promote the staging build to paiflow.xyz, deploy a swap flow from
the public app, fund it, capture the swap transaction and the recording, and publish the held
screenshot set. The public mirror is already synced — every commit link in this report resolves.
D2 (developer API) starts once the swap evidence is public.
