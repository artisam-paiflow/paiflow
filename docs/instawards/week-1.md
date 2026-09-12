# Week 1 — 7–13 September 2026

**Window:** 7–13 September 2026 · **Focus:** D1 — the swapper executes a real swap through the Soroswap testnet router

**Deliverable:** [D1 — Real-DEX swapper](deliverables/d1.md) · **Evidence:** [recording and captures](evidence/README.md#screenshots-and-recordings) · [transactions](evidence/README.md#transactions) · [executed swap flows](evidence/README.md#swapper-flows-executed-on-testnet)

_Interim report, updated Friday 11 September with a metrics snapshot of the same day._

## Summary

The Swap block is live on [paiflow.xyz](https://paiflow.xyz). The contract calls the Soroswap
router, the pipeline compiles a swap block into it, and the builder shows the block, its
settings and a live price preview of what a swap will return before deployment. All of it was
deployed to the public app on 9 September and verified there, not on a development machine: the
builder spec passes 9/9 against paiflow.xyz and the eleven screenshots and API samples in the
evidence index are its output.

A swap flow was then deployed from the public app and triggered on 9 September: 10 XLM swapped
to 1.0564010 USDC through the Soroswap router and paid on to the recipient, [`2ceacb95…`](https://stellar.expert/explorer/testnet/tx/2ceacb95695c5def25ee8c4b84ac44e596d3b936099e3239ef0a9af47164db1b).
On 10 September a written QA pass against the public app found an empty event feed after a
trigger and a slippage setting the pool fee would always defeat; both fixes are merged and
deployed. The login page now offers "try the sandbox", so a reviewer reaches the Swap block with
no account. On 11 September the journey was screen-recorded from the public app through that
sandbox — build, deploy with a browser wallet, fund, swap
([`94be52e8…`](https://stellar.expert/explorer/testnet/tx/94be52e8a937b6ddcb85da7cd917f97d412753e5e3ca47ea48b252a264b2278d)) — which
completes the four evidence items the Statement of Work asks for. Eleven distinct swap flows
deployed from paiflow.xyz have executed through the router so far.

## Changelog

Generated with:

```bash
pnpm instawards:changelog --since 2026-09-07 --until 2026-09-13 \
  --ref mirror/develop --repo https://github.com/artisam-paiflow/paiflow
```

| Date       | Change                                                                                   | Issues | Commit                                                                                                  |
| ---------- | ---------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------- |
| 2026-09-10 | fix(docs): put SUMMARY.md at the GitBook root so its pages import                        | #431   | [`688b54d`](https://github.com/artisam-paiflow/paiflow/commit/688b54dfe1a622581ebd1065386f91892986bd36) |
| 2026-09-10 | docs(instawards): week-1 interim report as of 10 September                               | #430   | [`535c855`](https://github.com/artisam-paiflow/paiflow/commit/535c85506f107142a86de78a56f3589a14966f6e) |
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
| 2026-09-07 | feat(pipeline): route the swap block through the Soroswap-backed swapper                 | #388   | [`3a76e93`](https://github.com/artisam-paiflow/paiflow/commit/3a76e93695b4b6cd78ab39adf3b0f451ddf8f2a3) |
| 2026-09-07 | feat(swapper): swap through the Soroswap router with a spot-price slippage bound         | #387   | [`3315ea3`](https://github.com/artisam-paiflow/paiflow/commit/3315ea35023471bb75cd281fa9aa488ee9e820d5) |

Every code change planned for D1 is merged; #390, the testnet deploy-and-trigger run that
produces the SOW evidence, ran on 9 September and was screen-recorded on 11 September. D1 is
complete.

## Statement of Work progress

Rows that moved this week. The full tables live on the deliverable pages.

| SOW clause                                                                                                                              | Deliverable | Status    | Evidence                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------- | ----------- | --------- | ------------------------------------------------------------ |
| Call `swap_exact_tokens_for_tokens` on the Soroswap router; `execute_step`; `amount_out_min` from `slippage_bps`; constructor arguments | D1          | Evidenced | contract + unit tests; swap tx `2ceacb95…` from paiflow.xyz  |
| Swap flows no longer map to the splitter kind; constructor serialization; swap validation rules; swap event parsing                     | D1          | Evidenced | unit tests; paiflow.xyz captures 03–06                       |
| Swap block visible in the palette; configuration panel; edge-case errors display clearly                                                | D1          | Evidenced | paiflow.xyz captures 01–06                                   |
| Swapper simulation preview                                                                                                              | D1          | Evidenced | paiflow.xyz captures 07–10; live quote from the public app   |
| Deploy and trigger a swapper flow on testnet                                                                                            | D1          | Evidenced | deploy `775af303…`; swaps `3bded301…` and `2ceacb95…`, 9 Sep |

Status values: Not started · In progress · Done · **Evidenced** (done _and_ proven by a public
link).

The three builder rows became **Evidenced** on 9 September, when D1 was deployed to
[paiflow.xyz](https://paiflow.xyz) and the capture set was retaken there. The contract row and the
last row cleared the same day, when a flow deployed from the public app swapped through the
Soroswap router: the 6 September transaction from the verification copy, which the counting rule
excludes, is no longer what the deliverable rests on. That the router is Soroswap's own deployment
rather than a contract of ours is verified in the [evidence index](evidence/README.md#how-to-verify-the-router).

## Evidence added

_Screenshots, recordings, transaction hashes and API samples added this week, linked from the_
_[evidence index](evidence/README.md)._

| Item                                                                                                  | Type                            | Link                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Swap flow deployed from paiflow.xyz and triggered twice: 50 XLM and 10 XLM through the router (9 Sep) | 3 transactions                  | deploy [`775af303…`](https://stellar.expert/explorer/testnet/tx/775af303e24ebd7f59923544df3963cc17fa05e1db66174f38f4c3ae10670943), swaps [`3bded301…`](https://stellar.expert/explorer/testnet/tx/3bded301fff23b2f34d9ffcfefcb6528de7d594928cdc39a5d261c9dfbf8e927) and [`2ceacb95…`](https://stellar.expert/explorer/testnet/tx/2ceacb95695c5def25ee8c4b84ac44e596d3b936099e3239ef0a9af47164db1b) |
| Contract-as-payer swap through the real router (stage-1 proof, verification copy, 6 Sep)              | Transaction                     | [`5389cdee…`](https://stellar.expert/explorer/testnet/tx/5389cdee87826b944f4fca397c0fadc8524cbb2429c2a657a306a06a4c5fc673)                                                                                                                                                                                                                                                                         |
| Swapper WASM hash on testnet                                                                          | Contract                        | [`e9482ff0…b23d1a`](https://api.stellar.expert/explorer/testnet/wasm/e9482ff07fcf4791aa3f8deebeda6159081a04f13e8ac63c28e91b7f80b23d1a) — 25,371 bytes                                                                                                                                                                                                                                              |
| Swapper panel, builder and palette **before** D1, from paiflow.xyz (9 Sep)                            | 3 screenshots                   | `d3/00`–`02` — the D3 "before" evidence, capturable only while the public app still ran pre-D1 code                                                                                                                                                                                                                                                                                                |
| Screen recording of deploy and trigger from paiflow.xyz through the sandbox (11 Sep)                  | Recording                       | [Google Drive](https://drive.google.com/file/d/1hcaNcojXrLmEYmTEHrNavQ_Wu9xgqaHL/view?usp=sharing); deploy [`c0460040…`](https://stellar.expert/explorer/testnet/tx/c04600408d910f55639a09b54725f65b38881820bbd468358be6546ce3416f18), swap [`94be52e8…`](https://stellar.expert/explorer/testnet/tx/94be52e8a937b6ddcb85da7cd917f97d412753e5e3ca47ea48b252a264b2278d)                             |
| Eleven swapper flows executed from paiflow.xyz, 9–11 Sep (QA account and sandbox visitors)            | 11 deployments, 14 transactions | listed in the [evidence index](evidence/README.md#swapper-flows-executed-on-testnet); raw list `d1/14-swapper-flows.json`                                                                                                                                                                                                                                                                          |
| Metrics snapshot from the public app's database (11 Sep)                                              | JSON                            | `evidence/metrics-2026-09-11.json`                                                                                                                                                                                                                                                                                                                                                                 |
| Builder, panel, five edge-case errors, deploy review, live quote, from paiflow.xyz (9 Sep)            | 7 screenshots + 3 API samples   | `d1/01`–`10` — retaken against the public app after the D1 deploy; published in the [evidence index](evidence/README.md#screenshots-and-recordings)                                                                                                                                                                                                                                                |

## Metrics

See [metrics](metrics.md) for the running totals and how each number is measured.

| Metric                        | Target | At end of week 1 | Change |
| ----------------------------- | ------ | ---------------- | ------ |
| Unique flows deployed         | ≥ 5    | 21 (11 Sep)      | +21    |
| Contract executions / events  | ≥ 60   | 43 (11 Sep)      | +43    |
| Unique swapper flows executed | ≥ 5    | 11 (11 Sep)      | +11    |
| Distinct deploying wallets    | ≥ 6    | 7 (11 Sep)       | +7     |
| Contract WASM uploaded        | ≥ 1    | 1 (11 Sep)       | +1     |

Snapshot of 11 September from the public app's database, definitions in
[metrics](metrics.md) and the raw figures in `evidence/metrics-2026-09-11.json`. Four of the
five targets are met; executions stand at 43 of 60. The figures include the QA pass and the
sandbox visitors since 10 September (17 sandbox sessions, 6 distinct wallets connected). The
9 September interim figure for executions counted on-chain events; this snapshot counts the
events the application recorded, which is the smaller and stricter number.

## Decisions

**No blockers to the deliverable.** D1 is complete — the public app runs it, the swap transaction
and the recording exist, and every SOW §6.1 item for the deliverable is public.

- **Where the evidence comes from.** [paiflow.xyz](https://paiflow.xyz) is the project's
  staging service, pinned to Stellar testnet, and it is the public app — there is no separate
  private environment. Everything deployed or triggered there counts under the counting rule;
  local runs and the 6 September verification copy do not.
- **Two narrowings of the SOW's wording: the router is not user-selectable, and a swap block
  forwards to one next step.** Recorded as scope notes on the
  [D1 page](deliverables/d1.md#scope-notes) rather than by editing the approved SOW. The asset
  range and the sandbox are on the same page under implementation choices: the SOW prescribes
  neither, so neither is a deviation.
- **Public access without an account.** The login page used to display a shared username and
  password. That panel is gone; "try the sandbox" now creates a disposable sandbox identity
  for the visitor, signed in without a password, that can reach only the builder, the deploy
  screen and the read-only deployment views, and opens on a ready-made XLM → USDC swap flow.
  A sandbox session can deploy only pipelines where every on-chain move is signed by the
  visitor's own wallet; payroll, subscription, cash-out, streaming and webhook pipelines, which
  Paiflow's own signer later acts on, are refused. The feature is off by default and refuses to
  start on mainnet. Nothing custodial changes — the visitor still signs every deployment.
- **WASM uploaded counts as 1.** The 9 September interim report kept it at zero because the
  binary was uploaded from a development machine. The counting rule excludes _activity_ from
  development environments, not the artefact: the hash is on testnet, the public app's
  contract-template row points at it, and every public-app swap flow instantiates it.

## Issues found and fixed

Each was found and fixed inside the week, and each is merged and deployed to the public app.

- **QA pass, 10 September.** A written test-case run against the public app deployed and
  triggered a swap flow. Two things went wrong and are fixed: the deployment page showed an
  empty event feed until the background poller ran (events are now read the moment the trigger
  confirms, and the page reads once on open), and a slippage setting below the pool's 0.3 % fee
  could be deployed and then fail on every trigger (refused at validation; the panel floors the
  input at 0.3 %).
- **Action ordering.** The pipeline compiled the first contract action in canvas-insertion
  order, so a correctly drawn `receive → swap → pay` could silently drop the swap if the Pay
  block was added first. Fixed on 9 September: the action the trigger reaches first is the one
  compiled.
- **Fresh-environment deploy bug.** `pnpm contracts:deploy:testnet` never deployed a factory on
  a machine with no prior state, so nothing could deploy. Reproduced against `develop`, fixed,
  and verified on 9 September (factory `CBYIUUKY…GZ726A`). This would have blocked the
  testnet evidence run; merged.

## Planned maintenance

- **Extend the swapper WASM entry before the D2 swaps.** Its time-to-live on testnet runs out
  around 16 September (ledger 4698557); at ledger 4,622,566 on 11 September that is about four
  days of runway. The contract extends its own instance when invoked, not the code entry, so the
  entry has to be extended before then or new swap deploys will fail until it is restored.

## Next week

D2 (developer API) starts: deployment-scoped tokens, `POST /api/v1/deployments/[id]/execute`
for the Swapper action, `GET /api/v1/deployments/[id]/events`, tests, OpenAPI spec and Postman
collection. The first operational task is extending the swapper WASM entry's time-to-live on
testnet. The public mirror
is synced — every commit link in this report resolves.
