# Metrics

The success metrics from the [Statement of Work](../instawards-phase-1-sow.md), section 6.3,
with the running totals and how each one is counted.

**Counting rules.** Only activity produced from the public application at
[paiflow.xyz](https://paiflow.xyz) on Stellar testnet, during the sprint, counts. Anything
deployed or triggered from a development environment is excluded.

| Metric                                   | Target | Current | Source                                  |
| ---------------------------------------- | ------ | ------- | --------------------------------------- |
| Unique flows deployed                    | ≥ 5    | 1       | Distinct confirmed deployments          |
| Contract executions / events published   | ≥ 60   | 24      | Recorded contract events                |
| Unique swapper flows executed on testnet | ≥ 5    | 1       | Confirmed swap events, counted per flow |
| Distinct wallets deploying               | ≥ 6    | 1       | Distinct wallet addresses on record     |
| Contract WASM uploaded                   | ≥ 1    | 0       | Uploaded contract binaries              |
| Public testnet URL live and accessible   | Yes    | Yes     | [paiflow.xyz](https://paiflow.xyz)      |
| Demo video published                     | Yes    | No      | Week 4                                  |

_Last updated: 10 September, from the 9 September swapper run. Full week-1 snapshot on
13 September._

## How the numbers are produced

The application has an internal submission-proof view that reports user, deployment and wallet
counts together with the most recent wallet connections and on-chain interactions. Each week's
snapshot is taken from it and the figures are copied into the table above and into that week's
report.

Two figures it does not yet produce directly, and how they are handled in the meantime:

**Swapper executions** are counted from the swap events in the deployment's event feed. Until
the proof view reports per-event-kind counts, this figure is taken from the
[evidence index](evidence/README.md), where every swap transaction is listed individually.

The executions figure currently on the table is the on-chain count — the contract events the two
9 September trigger transactions emitted, twelve each — because the proof view's recorded count
has not been read since the run. The two numbers are not the same thing: the application records
decoded events, which is a subset. The 13 September snapshot replaces this with the proof view's
figure and says so.

**Distinct deploying wallets** is not the same as distinct connected wallets — connecting a
wallet is not deploying a flow. Until the two are reported separately, this figure is counted
from the deployments themselves and the connection count is not used as a substitute.

Both are worth improving in the application, but the counting method for the sprint does not
depend on that happening.
