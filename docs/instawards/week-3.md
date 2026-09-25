# Week 3 — 21–27 September 2026

**Window:** 21–27 September 2026 · **Focus:** D3 — reusable builder input components

**Deliverable:** [D3 — Shared builder inputs](deliverables/d3.md) · **Evidence:** [before-and-after captures](evidence/README.md#screenshots-and-recordings)

## Summary

_Three sentences, plain English, written for a reader who is not an engineer._

The Swapper configuration panel is rebuilt on shared input components with unified validation, plus an accessibility and mobile pass.

> Fill this in at the end of the week: what shipped, what it means for a user of the app, and
> anything that changed about the plan.

## Changelog

Generated with:

```bash
pnpm instawards:changelog --since 2026-09-21 --until 2026-09-27 \
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

| Item                                                                                   | Type       | Link                                                                      |
| -------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------- |
| PostHog swap validation errors before and after the D3 promotion                       | API sample | [`d3/22-posthog-validation.json`](evidence/d3/22-posthog-validation.json) |
| Real-phone check: slippage field with the keyboard up, no zoom (vivo Y22s, Android 14) | Screenshot | [`d3/13-phone-keyboard-up.jpg`](evidence/d3/13-phone-keyboard-up.jpg)     |

## Metrics

See [metrics](metrics.md) for the running totals and how each number is measured.

| Metric                        | Target | At end of week 3 | Change |
| ----------------------------- | ------ | ---------------- | ------ |
| Unique flows deployed         | ≥ 5    |                  |        |
| Contract executions / events  | ≥ 60   |                  |        |
| Unique swapper flows executed | ≥ 5    |                  |        |
| Distinct deploying wallets    | ≥ 6    |                  |        |
| Contract WASM uploaded        | ≥ 1    |                  |        |

**Swap validation errors in PostHog: too little traffic to compare.** Before the D3 panel went live
(7 days to 23 September, 00:53 UTC) 26 swap errors came from 4 people. In the 2.6 days after, 20
came from 3 people. All of them were on beta.app.paiflow.xyz, and `swap.config.slippageBps` did not
appear in either window. That is too few people to read a change from, so there is no chart
([`d3/22-posthog-validation.json`](evidence/d3/22-posthog-validation.json)).

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
