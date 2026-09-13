# Paiflow — Instawards Phase 1

Weekly milestone reports for the Stellar Development Foundation Instawards program
(Philippines chapter). Each week records what shipped, links every Statement of Work item to
the commits and on-chain transactions that prove it, and updates the success metrics.

|          |                                                                                                                       |
| -------- | --------------------------------------------------------------------------------------------------------------------- |
| Project  | Paiflow — a visual, non-custodial payment-flow builder on Stellar / Soroban                                           |
| Builder  | Mychal Andres B. Pejana                                                                                               |
| Chapter  | Philippines — Chapter Lead Nelson Lumbres                                                                             |
| Sprint   | 7 September – 4 October 2026                                                                                          |
| Live app | [paiflow.xyz](https://paiflow.xyz) (Stellar **testnet**) — no account needed: use _Try the sandbox_ on the login page |
| Source   | [github.com/artisam-paiflow/paiflow](https://github.com/artisam-paiflow/paiflow)                                      |
| Network  | Testnet only. Mainnet is out of scope for this Instaward.                                                             |

## How to read this book

**Start with the current week.** Each weekly report opens with a plain-English summary, then
gives the changelog, the Statement of Work items that moved, the evidence added, and the
metrics.

**To check one deliverable end to end**, open its page under _Deliverables_. Each has a
traceability table with one row per SOW clause: the clause, the change that implemented it,
and the evidence that proves it.

**To verify anything yourself**, every commit link opens on GitHub and every transaction link
opens on [stellar.expert](https://stellar.expert/explorer/testnet). No account is needed for
either. The [evidence index](evidence/README.md) is the single list of every contract
address, WASM hash and transaction hash produced during the sprint.

## The three deliverables

|                          | Deliverable                                                                | Week | Status      |
| ------------------------ | -------------------------------------------------------------------------- | ---- | ----------- |
| [D1](deliverables/d1.md) | The swapper block executes a real swap through the Soroswap testnet router | 1    | Complete    |
| [D2](deliverables/d2.md) | A developer API with deployment-scoped tokens and execute/events endpoints | 2    | Not started |
| [D3](deliverables/d3.md) | Reusable builder input components, adopted in the Swapper panel            | 3    | Not started |

Week 4 is integration, the demo video, and the evidence handoff.

The [Statement of Work](../instawards-phase-1-sow.md) is reproduced here verbatim as
approved on 24 July 2026. It is never edited — where the engineering work turned out to need
something the SOW did not describe, that is recorded in the weekly report, not by changing
the SOW.

## A note on issue numbers

Issue and pull-request numbers (`#387`, `#390`) appear throughout as plain text. They refer to
the private development repository and are included so the builder can trace any line back to
its ticket. Everything a reviewer needs to verify is linked publicly: commits, the live app,
and on-chain transactions.
