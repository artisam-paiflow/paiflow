# Metrics

The success metrics from the [Statement of Work](../instawards-phase-1-sow.md), section 6.3,
with the running totals and how each one is counted.

**Counting rules.** Only activity produced from the public application at
[paiflow.xyz](https://paiflow.xyz) on Stellar testnet counts. Deployments made from a local
development environment, and everything from the pre-sprint validation trial described in
[week 0](week-0.md), are excluded.

| Metric                                   | Target | Current | Source                                  |
| ---------------------------------------- | ------ | ------- | --------------------------------------- |
| Unique flows deployed                    | ≥ 5    | 0       | Distinct confirmed deployments          |
| Contract executions / events published   | ≥ 60   | 0       | Recorded contract events                |
| Unique swapper flows executed on testnet | ≥ 5    | 0       | Confirmed swap events, counted per flow |
| Distinct wallets deploying               | ≥ 6    | 0       | Distinct wallet addresses on record     |
| Contract WASM uploaded                   | ≥ 1    | 0       | Uploaded contract binaries              |
| Public testnet URL live and accessible   | Yes    | Yes     | [paiflow.xyz](https://paiflow.xyz)      |
| Demo video published                     | Yes    | No      | Week 4                                  |

_Last updated: not yet — first snapshot at the end of week 1._

## How the numbers are produced

The application has an internal submission-proof view that reports user, deployment and wallet
counts together with the most recent wallet connections and on-chain interactions. Each week's
snapshot is taken from it and the figures are copied into the table above and into that week's
report.

Two figures it does not yet produce directly, and how they are handled in the meantime:

**Swapper executions** are counted from the swap events in the deployment's event feed. Until
the proof view reports per-event-kind counts, this figure is taken from the
[evidence index](evidence/README.md), where every swap transaction is listed individually.

**Distinct deploying wallets** is not the same as distinct connected wallets — connecting a
wallet is not deploying a flow. Until the two are reported separately, this figure is counted
from the deployments themselves and the connection count is not used as a substitute.

Both are worth improving in the application, but the counting method for the sprint does not
depend on that happening.
