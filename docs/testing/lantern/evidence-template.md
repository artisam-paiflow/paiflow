# Lantern public testnet QA evidence — blank template

Status: **not run**. Copy for each candidate; this file contains no acceptance evidence.
Run according to the [runbook](public-testnet-runbook.md).

## Candidate and prerequisites

- Run ID / UTC date / tester: unresolved
- Paiflow environment / confirmed canonical origin / entry URL: unresolved
- Actual deployed full commit / health version / deployment identifier: unresolved
- Health DB / Redis / RPC / channel status: not checked
- Source comparison baseline: `8c914b6df95221aa16d01d8574e0dff80595a535`; relevant differences: unresolved
- Inspected Lantern bridge source only: `ed512f6d3a478e4fc9eaab498627a6d0f8165d30` (0.6.3); this is not an installed-build claim
- Android installed version / build / device / OS / WebView: unresolved
- Extension installed version / build / ID / browser / OS: unresolved
- Directory registration / Android associations evidence: pending
- Deployment / fixture provision / testnet spending approval references: pending
- Fault harness revision and isolation, if used: unresolved
- Public rollout minimum supported builds: **not established**

## Fixture inventory

| Fixture | UUID / public URL | Network / template / contract / token | Customer / subscriber / controlled recipients | Amount units / chain amount / initial state or allowance | Provision approval / readiness |
| ------- | ----------------- | ------------------------------------- | --------------------------------------------- | -------------------------------------------------------- | ------------------------------ |
| T1      | unresolved        | unresolved                            | unresolved                                    | unresolved                                               | pending                        |
| T2      | unresolved        | unresolved                            | unresolved                                    | unresolved                                               | pending                        |
| T3      | unresolved        | unresolved                            | unresolved                                    | unresolved                                               | pending                        |
| T4      | unresolved        | unresolved                            | unresolved                                    | unresolved                                               | pending                        |
| A1      | unresolved        | unresolved                            | unresolved                                    | unresolved                                               | pending                        |
| A2      | unresolved        | unresolved                            | unresolved                                    | unresolved                                               | pending                        |
| A3      | unresolved        | unresolved                            | unresolved                                    | unresolved                                               | pending                        |
| P1      | unresolved        | unresolved                            | unresolved                                    | read-only refusal                                        | pending                        |
| M1      | unresolved        | mainnet; read-only                    | unresolved                                    | never sign                                               | pending                        |

## Header and entry checks

List each requested URL and redirect hop, status, sanitized Location, final origin,
all enforced frame-ancestors directives and XFO presence/absence. Include valid
trigger/Subscription, root, login, protected app, invalid/trailing-slash paths and
Payroll session boundary. No cookies, tokens or raw response dumps.

| Platform / URL | Hop / status / sanitized Location | Enforced CSP / XFO | Final anonymous HTML / actual parent / storage and locks | Result / evidence |
| -------------- | --------------------------------- | ------------------ | -------------------------------------------------------- | ----------------- |
| unresolved     | not checked                       | not checked        | not checked                                              | not run           |

## Test results

Allowed results: `not run`, `pass`, `fail`, `blocked`. Add precise evidence or
pending prerequisite to every executed row. Harness evidence goes in its own
column and cannot replace installed-device results. Tests and transactions must
have an execution timestamp; do not copy historical results as this candidate's.

| Case          | Android | Extension | Standalone regression / synthetic harness | Sanitized evidence / UTC / blocker |
| ------------- | ------- | --------- | ----------------------------------------- | ---------------------------------- |
| PRE-1         | not run | not run   | not run                                   |                                    |
| PRE-2         | not run | not run   | not run                                   |                                    |
| PRE-3         | not run | not run   | not run                                   |                                    |
| PAY-1 T1 / T2 | not run | not run   | not run                                   |                                    |
| PAY-2 T3 / T4 | not run | not run   | not run                                   |                                    |
| ALW-1         | not run | not run   | not run                                   |                                    |
| NEG-1         | not run | not run   | not run                                   |                                    |
| NEG-2         | not run | not run   | not run                                   |                                    |
| NEG-3         | not run | not run   | not run                                   |                                    |
| NEG-4         | not run | not run   | not run                                   |                                    |
| LIFE-1        | not run | not run   | not run                                   |                                    |
| LIFE-2        | not run | not run   | not run                                   |                                    |
| REC-1         | not run | not run   | not run                                   |                                    |
| REC-2         | not run | not run   | not run                                   |                                    |
| REC-3         | not run | not run   | not run                                   |                                    |
| REC-4         | not run | not run   | not run                                   |                                    |
| REG-1         | not run | not run   | not run                                   |                                    |
| REG-2         | not run | not run   | not run                                   |                                    |
| REG-3         | not run | not run   | not run                                   |                                    |

Split grouped fixture/case rows during execution; each action needs its own result.

## Payments and reconciliation

| Case / platform / UTC | Public transaction hash / explorer | Prepared hash unchanged / normal envelope / permitted source (observed, no XDR) | Submission count / ledger outcome | Expected versus observed payout, funding or allowance | Recovery evidence / unresolved scope  |
| --------------------- | ---------------------------------- | ------------------------------------------------------------------------------- | --------------------------------- | ----------------------------------------------------- | ------------------------------------- |
| not run               | none                               | not checked                                                                     | not checked                       | not checked                                           | none observed; not a proof of absence |

Record reload/status request counts and original-hash continuity, response-loss
mechanism, pending record presence (no value), and absence of new prepare/sign/send
while unknown. Preserve unknown scopes; never clear pending data for a rerun.
Do not paste intents, receipts, unsigned/signed XDR, raw HAR, wallet secrets,
credentials, cookies, API tokens, private graph data or private customer details.
Use public addresses only when necessary to explain source/subscriber/payout.

## Findings and acceptance decision

- New blockers / reproduction / affected scope / issue or PR: not assessed
- Nonblocking follow-ups / owner: not assessed
- Pending known directory/build/device/candidate prerequisites: unresolved
- Local checks actually executed on this candidate (command / count / date): none
- Device checks actually executed: none
- Android public support: not accepted
- Extension public support: not accepted
- #933 disposition: open; no acceptance evidence
- #932 authenticated support: separate; not accepted here
- Release/promotion authorization: absent
