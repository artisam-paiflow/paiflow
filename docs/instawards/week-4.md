# Week 4 — 28 September – 4 October 2026

**Window:** 28 September – 4 October 2026 · **Focus:** Integration, demo and evidence handoff

**Deliverables:** [D1](deliverables/d1.md) · [D2](deliverables/d2.md) · [D3](deliverables/d3.md) · **Validation package:** [metrics](metrics.md) · [evidence index](evidence/README.md)

## Summary

The three deliverables were run end to end on the public app with a real wallet: a flow built in
the builder, deployed and triggered with Freighter, and then run again from a backend through the
developer API, all on one deployment, once on camera and once by a script that keeps every
transaction in full. The package a reviewer needs to check the sprint is now public: a 3:49
technical walkthrough video, an integration guide that takes a newcomer from the builder to the
API, a generated list of every swap the public app settled up to the 26 September snapshot
(refreshed from the final one on 3 October), and a [handoff page](handoff.md) that maps each row of
the Statement of Work's checklist to its evidence. For a user, a payout to a wallet that does not
trust the right USDC now says so, naming the asset and its issuer, instead of failing as "error
#13".

## Changelog

Generated with:

```bash
pnpm instawards:changelog --since 2026-09-28 --until 2026-10-04 \
  --ref mirror/develop --repo https://github.com/artisam-paiflow/paiflow
```

_Added on 3 October, once the week's last change has merged._

## Statement of Work progress

Rows that moved this week. The full table lives on the [validation package page](deliverables/d4.md#traceability).

| SOW clause (§5.1 week 4)                                     | Deliverable              | Status      | Evidence                                                                                                                                                                       |
| ------------------------------------------------------------ | ------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| End-to-end integration test with external wallet             | [D4](deliverables/d4.md) | Evidenced   | [Freighter recording](https://drive.google.com/file/d/1DofVikDrm_Vq5Lm40Dt_PZUlyx8Euait/view?usp=sharing); [scripted run](evidence/d4/README.md#the-scripted-run-28-september) |
| Record and publish 3–5 min technical demo video              | [D4](deliverables/d4.md) | Evidenced   | [Video, 3:49](https://drive.google.com/file/d/1_Yg08RncK7eNUM4p4pVVfIGujGrRdV6A/view?usp=sharing)                                                                              |
| Integration guide with curl examples and sample XDR payloads | [D4](deliverables/d4.md) | Evidenced   | [Integration guide](../guide/README.md)                                                                                                                                        |
| Compile all on-chain receipt tx hashes                       | [D4](deliverables/d4.md) | Evidenced   | [Transaction list](evidence/transactions.md)                                                                                                                                   |
| Final CI/typecheck pass                                      | [D4](deliverables/d4.md) | In progress | 3 October                                                                                                                                                                      |
| Prepare evidence handoff for the Ambassador Chapter Lead     | [D4](deliverables/d4.md) | In progress | [Handoff page](handoff.md)                                                                                                                                                     |

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

Filled in from the 3 October snapshot. Until then, [metrics](metrics.md) holds the 26 September figures,
with every target met.

| Metric                        | Target | At end of week 4 | Change |
| ----------------------------- | ------ | ---------------- | ------ |
| Unique flows deployed         | ≥ 5    |                  |        |
| Contract executions / events  | ≥ 60   |                  |        |
| Unique swapper flows executed | ≥ 5    |                  |        |
| Distinct deploying wallets    | ≥ 6    |                  |        |
| Contract WASM uploaded        | ≥ 1    |                  |        |

## Decisions

Nothing blocked the week. There were no scope changes; three decisions, made on 27 September, set
how the SOW's week-4 items are met:

- **"External wallet" is proven twice.** A recorded Freighter run shows a real wallet signing; a
  scripted run leaves the machine-readable record. Neither alone would do: a script cannot prove a
  wallet works, and a recording keeps no transaction envelopes.
- **Code only where the video or the guide would hit it.** The missing-trustline message and the
  low-severity follow-ups from D2's QA run were fixed. Other findings stay open and are listed as
  [known limitations](handoff.md#known-limitations) rather than fixed in a hurry at the end.
- **The metrics keep their three bases.** The final snapshot on 3 October reports archive, live and
  alpha-tester figures side by side, never summed, as in every earlier week.

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

The sprint ends with this week. On 3 October the final metrics snapshot and CI report are added, and
on 4 October the package is promoted to the public app, published to the public repository and
sent to the Ambassador Chapter Lead.
