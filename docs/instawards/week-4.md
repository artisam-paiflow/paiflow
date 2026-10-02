# Week 4 — 28 September – 4 October 2026

**Window:** 28 September – 4 October 2026 · **Focus:** Integration, demo and evidence handoff

**Deliverables:** [D1](deliverables/d1.md) · [D2](deliverables/d2.md) · [D3](deliverables/d3.md) · **Validation package:** [metrics](metrics.md) · [evidence index](evidence/README.md)

## Summary

The three deliverables were run end to end on the public app with a real wallet: a flow built in
the builder, deployed and triggered with Freighter, and then run again from a backend through the
developer API, all on one deployment, once on camera and once by a script that keeps every
transaction in full. The package a reviewer needs to check the sprint is now public: a 3:49
technical walkthrough video, an integration guide that takes a newcomer from the builder to the
API, a generated list of every swap the public app settled up to the 30 September snapshot, and a [handoff page](handoff.md) that maps each row of
the Statement of Work's checklist to its evidence. For a user, a payout to a wallet that does not
trust the right USDC now says so, naming the asset and its issuer, instead of failing as "error
#13".

## Changelog

Generated with:

```bash
pnpm instawards:changelog --since 2026-09-28 --until 2026-10-04 \
  --ref mirror/develop --repo https://github.com/artisam-paiflow/paiflow
```

Covers 28–30 September, the extent of the public mirror when this was generated on
30 September. Anything merged later is added when the mirror next syncs.

| Date       | Change                                                                                                                                     | Issues | Commit                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------- |
| 2026-09-30 | docs(instawards): list the D3 and D4 alpha testers, drop the two who withdrew                                                              | #738   | [`0c77f54`](https://github.com/artisam-paiflow/paiflow/commit/0c77f546abea00ccd4a047148108cfe2cc84f0c8) |
| 2026-09-29 | docs(instawards): evidence handoff page, validation package page, week-4 report (#697)                                                     | #715   | [`dc9939c`](https://github.com/artisam-paiflow/paiflow/commit/dc9939cdf6bcb655164416b15f74b0e0ce02424e) |
| 2026-09-29 | fix(deploy): warn before signing when a payout recipient lacks the asset's trustline (#574)                                                | #574   | [`d8f889e`](https://github.com/artisam-paiflow/paiflow/commit/d8f889e49eb8372f70de325d4d96cbc80008a3cd) |
| 2026-09-29 | docs(instawards): the D4 Freighter run and the walkthrough video (#693)                                                                    | #693   | [`605fd79`](https://github.com/artisam-paiflow/paiflow/commit/605fd797af05e1f78b553bfb8f534edab8a9679e) |
| 2026-09-29 | docs(alpha): bring both tester guides up to D3                                                                                             | #709   | [`eb87f2b`](https://github.com/artisam-paiflow/paiflow/commit/eb87f2bfa6377eb609c8df8db6a77ebdb20e12f2) |
| 2026-09-29 | docs(instawards): split the week-4 video into a walkthrough script and an end-to-end wallet checklist (#693)                               | #712   | [`b274392`](https://github.com/artisam-paiflow/paiflow/commit/b2743927776e2dbd5acbca25b0c3a6254879b98a) |
| 2026-09-28 | docs(instawards): link the D4 evidence pack, point D2's unrun spec row at the D4 API run, and call 08-openapi "as served" (#697, #548)     | #711   | [`aafbe51`](https://github.com/artisam-paiflow/paiflow/commit/aafbe51908d7de9298b7074e8a22a57855b993cc) |
| 2026-09-28 | docs(instawards): the D4 end-to-end run on paiflow.xyz at d850197: deploy, trigger and /api/v1 execute on one deployment (#692)            | #692   | [`ca0e688`](https://github.com/artisam-paiflow/paiflow/commit/ca0e68866f6da8bcf485d61fb5512fb8d0d12702) |
| 2026-09-28 | test(e2e): record the build the D4 run exercised, from /api/health (#692)                                                                  | #708   | [`7d2ef46`](https://github.com/artisam-paiflow/paiflow/commit/7d2ef464f5938fbe07d8cdc923eec408ba961595) |
| 2026-09-28 | docs(guide): an integration guide from the builder to the API, with the sample XDR decoded (#694)                                          | #706   | [`b07b884`](https://github.com/artisam-paiflow/paiflow/commit/b07b884958a959c05564d3c28f8efced5432542f) |
| 2026-09-28 | docs(instawards): D3 is complete on the book's home page, and week 4 has its own row (#697)                                                | #705   | [`ee0ee47`](https://github.com/artisam-paiflow/paiflow/commit/ee0ee475bb5cc5f0796630c1bbd73a96ae3b9b5a) |
| 2026-09-28 | docs(instawards): the transaction list, every settlement and deployment on stellar.expert, generated from the snapshots (#695)             | #704   | [`1d1f6ab`](https://github.com/artisam-paiflow/paiflow/commit/1d1f6ab9eed6b57414fdc768ad564bf99f86088d) |
| 2026-09-28 | docs(instawards): the week-4 demo video's script, shot list and test data (#693)                                                           | #703   | [`f01fc83`](https://github.com/artisam-paiflow/paiflow/commit/f01fc83349e551901dc1541b870617cd6f21c670) |
| 2026-09-28 | test(e2e): the three deliverables end to end on one deployment of the public app (#692)                                                    | #702   | [`314023d`](https://github.com/artisam-paiflow/paiflow/commit/314023da5d377b95ff1d984a9f2bf62c9c13b614) |
| 2026-09-28 | fix(api): classify a /api/v1 simulation revert by its class, not its details; report the build on /api/health (#553)                       | #701   | [`67f4c04`](https://github.com/artisam-paiflow/paiflow/commit/67f4c04c8f8950d1097539ffa111352177893fdf) |
| 2026-09-28 | docs(api): working links on the published guide, accurate audit wording, the canonical host, and docs links on the API access panel (#553) | #700   | [`311fff4`](https://github.com/artisam-paiflow/paiflow/commit/311fff45e7790a57e63b4b0f46e8521b036cb8a7) |
| 2026-09-28 | fix(stellar): name the asset and issuer when a payout fails on a missing trustline (#574)                                                  | #699   | [`fd6d095`](https://github.com/artisam-paiflow/paiflow/commit/fd6d095d699f5b5d2b2828e37b15b42312997c50) |

## Statement of Work progress

Rows that moved this week. The full table lives on the [validation package page](deliverables/d4.md#traceability).

| SOW clause (§5.1 week 4)                                     | Deliverable              | Status    | Evidence                                                                                                                                                                       |
| ------------------------------------------------------------ | ------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| End-to-end integration test with external wallet             | [D4](deliverables/d4.md) | Evidenced | [Freighter recording](https://drive.google.com/file/d/1DofVikDrm_Vq5Lm40Dt_PZUlyx8Euait/view?usp=sharing); [scripted run](evidence/d4/README.md#the-scripted-run-28-september) |
| Record and publish 3–5 min technical demo video              | [D4](deliverables/d4.md) | Evidenced | [Video, 3:49](https://drive.google.com/file/d/1_Yg08RncK7eNUM4p4pVVfIGujGrRdV6A/view?usp=sharing)                                                                              |
| Integration guide with curl examples and sample XDR payloads | [D4](deliverables/d4.md) | Evidenced | [Integration guide](../guide/README.md)                                                                                                                                        |
| Compile all on-chain receipt tx hashes                       | [D4](deliverables/d4.md) | Evidenced | [Transaction list](evidence/transactions.md)                                                                                                                                   |
| Final CI/typecheck pass                                      | [D4](deliverables/d4.md) | Evidenced | [CI run 36688511995](https://github.com/artisam-paiflow/paiflow/actions/runs/36688511995)                                                                                      |
| Prepare evidence handoff for the Ambassador Chapter Lead     | [D4](deliverables/d4.md) | Done      | [Handoff page](handoff.md)                                                                                                                                                     |

Status values: Not started · In progress · Done · **Evidenced** (done _and_ proven by a public
link).

## Evidence added

_Screenshots, recordings, transaction hashes and API samples added this week, linked from the_
_[evidence index](evidence/README.md#transactions)._

| Item                                                                                                              | Type         | Link                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Technical walkthrough video** (3:49, published 29 Sep)                                                          | Recording    | [Google Drive](https://drive.google.com/file/d/1_Yg08RncK7eNUM4p4pVVfIGujGrRdV6A/view?usp=sharing); script [`d4/walkthrough-script.md`](evidence/d4/walkthrough-script.md)   |
| **End-to-end run with Freighter** (28 Sep, 9:44): deploy, trigger, and `/api/v1` execute on deployment `964e252f` | Recording    | [Google Drive](https://drive.google.com/file/d/1DofVikDrm_Vq5Lm40Dt_PZUlyx8Euait/view?usp=sharing); record [`d4/04-e2e-wallet-run.json`](evidence/d4/04-e2e-wallet-run.json) |
| The scripted end-to-end run on deployment `516255e1`, full XDR                                                    | API samples  | [`d4/01`–`03`](evidence/d4/README.md#the-scripted-run-28-september)                                                                                                          |
| Four Freighter-run transactions: deploy `5bc90ab0…`, trigger `00acc386…`, API `a759da4a…` and `cf1f70f5…`         | Transactions | [D4 evidence pack](evidence/d4/README.md#the-freighter-run-28-september)                                                                                                     |

## Metrics

See [metrics](metrics.md) for the running totals and how each number is measured.

| Metric                        | Target | Archive (to 16 Sep) | Live (since 15 Sep) | Alpha testers (9 active / 9 issued / 9 planned) |
| ----------------------------- | ------ | ------------------- | ------------------- | ----------------------------------------------- |
| Unique flows deployed         | ≥ 5    | 26                  | 86 (was 64)         | 42                                              |
| Contract executions / events  | ≥ 60   | 61                  | 177 (was 128)       | — (not cohort-filterable)                       |
| Unique swapper flows executed | ≥ 5    | 16                  | 23 (was 17)         | 7                                               |
| Distinct deploying wallets    | ≥ 6    | 7                   | 28 (was 20)         | 15                                              |
| Contract WASM uploaded        | ≥ 1    | 1                   | 1                   | 1 (the same binary)                             |

The figures are the 30 September snapshots, taken once every tester had run a session. "Was" is the
26 September snapshot, the last one in week 3. The archive column is frozen at the 16 September
cutover and does not move. The alpha column has no "was": its cohort changed on 30 September, when
D3's two group A testers were added, D4's four were added and two D2 testers who withdrew were
removed, so the 26 September figures count different people
([metrics](metrics.md#results) explains).

All 23 live swapper flows belong to registered accounts: 33 swap transactions from 14 distinct
signers ([`evidence/swapper-flows-live-2026-09-30.json`](evidence/swapper-flows-live-2026-09-30.json)).
Six are new since 26 September; alpha testers signed four of them and the project's own internal
account the other two.

## Decisions

Nothing blocked the week. There were no scope changes; three decisions, made on 27 September, set
how the SOW's week-4 items are met:

- **"External wallet" is proven twice.** A recorded Freighter run shows a real wallet signing; a
  scripted run leaves the machine-readable record. Neither alone would do: a script cannot prove a
  wallet works, and a recording keeps no transaction envelopes.
- **Code only where the video or the guide would hit it.** The missing-trustline message and the
  low-severity follow-ups from D2's QA run were fixed. Other findings stay open and are listed as
  [known limitations](handoff.md#known-limitations) rather than fixed in a hurry at the end.
- **The metrics keep their three bases.** The final snapshot, taken on 30 September once every tester
  had run a session, reports archive, live and alpha-tester figures side by side, never summed, as in every earlier week.

## Issues found and fixed

Defects caught and closed inside the week, and what each would have done if it had shipped.

- **A payout to a wallet without the right USDC trustline failed as "error #13"** (#574). The swap
  succeeded, but the transfer to the recipient reverted in the USDC contract, and the app had no
  table for that contract's errors. The message now names the asset and the issuer to trust, and
  analytics counts it as a missing trustline. If shipped as it was, a reviewer following the video
  or the guide with a fresh recipient would have hit an error that gave no hint of the fix.
- **Gaps in the developer API's documentation and error handling, from D2's QA run** (#553). The published guide
  linked to files GitBook does not serve, overstated who can read the audit log, and never said
  which host the OpenAPI document names; the API access panel linked to no documentation; and a
  simulation revert was classified by matching its message text, so rewording that message would
  have turned every one into a server error. `/api/health` now also reports the build.

## Planned maintenance

Unchanged from [week 3](week-3.md#planned-maintenance). The contract code entries, the factory and
the swapper among them, stay live to about 11 March 2027. The public factory instance runs to
ledger 7756749 and has to be extended before then, since it has no `extend_ttl` call of its own.

## Next week

The sprint ends with this week. On 4 October the package is promoted to the public app, published to the public repository and
sent to the Ambassador Chapter Lead.
