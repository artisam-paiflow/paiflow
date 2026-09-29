# Week 4 — 28 September – 4 October 2026

**Window:** 28 September – 4 October 2026 · **Focus:** Integration, demo and evidence handoff

**Deliverables:** [D1](deliverables/d1.md) · [D2](deliverables/d2.md) · [D3](deliverables/d3.md) · **Validation package:** [metrics](metrics.md) · [evidence index](evidence/README.md)

## Summary

_Three sentences, plain English, written for a reader who is not an engineer._

End-to-end run with an external wallet, the technical demo video, the integration guide, and the compiled evidence package.

> Fill this in at the end of the week: what shipped, what it means for a user of the app, and
> anything that changed about the plan.

## Changelog

Generated with:

```bash
pnpm instawards:changelog --since 2026-09-28 --until 2026-10-04 \
  --ref mirror/develop --repo https://github.com/artisam-paiflow/paiflow
```

_Paste the table here._

## Statement of Work progress

Rows that moved this week. The full tables live on the deliverable pages.

| SOW clause | Deliverable | Status | Evidence |
| ---------- | ----------- | ------ | -------- |
|            |             |        |          |

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

| Metric                        | Target | At end of week 4 | Change |
| ----------------------------- | ------ | ---------------- | ------ |
| Unique flows deployed         | ≥ 5    |                  |        |
| Contract executions / events  | ≥ 60   |                  |        |
| Unique swapper flows executed | ≥ 5    |                  |        |
| Distinct deploying wallets    | ≥ 6    |                  |        |
| Contract WASM uploaded        | ≥ 1    |                  |        |

## Decisions

_Anything that changed the scope or the approach, and why. If nothing changed, say so —_
_"no scope changes this week" is a useful sentence for a reviewer. Lead with whether anything_
_blocked the deliverable._

## Issues found and fixed

_Defects caught and closed inside the week, and what each one would have done if it had shipped._

## Planned maintenance

_Scheduled operational work with a deadline — a contract entry to extend, a key to rotate._

## Next week

_One short paragraph._
