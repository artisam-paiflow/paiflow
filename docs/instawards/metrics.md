# Metrics

The success metrics from the [Statement of Work](../instawards-phase-1-sow.md), section 6.3,
with the running totals and how each one is counted.

## Counting rules

Only activity on Stellar testnet, produced from the public application during the sprint, counts.
Anything deployed or triggered from a development environment is excluded.

Since 16 September the public application is served on **two hostnames by one Railway service** —
[paiflow.xyz](https://paiflow.xyz) and [beta.app.paiflow.xyz](https://beta.app.paiflow.xyz), the
same build reading the same database, with the alpha round running on the latter. Both count.
(`beta.paiflow.xyz` is the static marketing site and has no app on it.) The layout is recorded once,
in the [alpha tracking plan](../analytics/alpha-tracking-plan.md), and not restated here.

Figures are reported on **two bases**, because they answer different questions:

- **All public activity** — every confirmed deployment the application recorded, whoever produced
  it. This is the basis the SOW targets were written against, and the one the earlier snapshots
  used.
- **Alpha testers** — the people in the official alpha round, from **16 September 2026**, counted
  individually. A narrower number, and a more meaningful one: identified humans working through a
  structured session, rather than anonymous visitors trying the sandbox once. The round targets
  **five** testers; **three** accounts have been issued and **one** has run a session so far, so
  every figure in that column is one tester's work and will grow as the round proceeds.

Neither basis is a correction of the other. The first measures reach, the second measures depth.

## Results

| Metric                                   | Target | All public activity | Alpha testers (1 active / 3 issued / 5 planned) |
| ---------------------------------------- | ------ | ------------------- | ----------------------------------------------- |
| Unique flows deployed                    | ≥ 5    | 26 ✓                | 11 ✓                                            |
| Contract executions / events published   | ≥ 60   | 61 ✓                | — (needs a database run)                        |
| Unique swapper flows executed on testnet | ≥ 5    | 16 ✓                | 2                                               |
| Distinct wallets deploying               | ≥ 6    | 7 ✓                 | 3                                               |
| Contract WASM uploaded                   | ≥ 1    | 1 ✓                 | 1 ✓ (the same binary)                           |
| Public testnet URL live and accessible   | Yes    | Yes ✓               | Yes ✓                                           |
| Demo video published                     | Yes    | No                  | Week 4                                          |

Every metric except the week-4 demo video is met on the all-activity basis. Executions cleared the
target on 12 September; the 11 September snapshot had them at 43.

**The alpha-tester column is one tester's work so far**, and should be read that way. The three
counts in its heading are different things: the round **plans** five testers, three have been
**issued** an account, and one has so far been **active** — run a session. Only that one contributes
figures. That single tester deployed 11 flows, signed 19
transactions and used 3 distinct wallets — testers sign with more than one wallet each, which is why
the ≥ 6 wallets target stays reachable for a five-person round rather than being capped by headcount.
The two targets not yet met on this basis are not failures of the round; they are the round being one
session old. Figures come from
[`evidence/alpha-metrics-2026-09-17.json`](evidence/alpha-metrics-2026-09-17.json).

**That one active tester is a member of the project.** Of the three accounts issued, one belongs to
someone working on Paiflow, who ran the first session as a pilot of the protocol before spending an
external tester on it; the other two are external and have not yet run a session. So every figure in
the alpha-tester column so far is the project's own work, and the column does not yet show
independent outside use — the thing it exists to measure. It will once the external testers run.
The same person also tests internally under a separate account, and one wallet appears under both,
so their wallet count is three addresses belonging to one human rather than three people. This is
recorded for the same reason the all-activity column names `admin` and `judge` below: a figure
produced by the project should say so.

### What the all-activity column contains

It is almost entirely disposable sandbox sessions and the project's own two accounts. The
12 September snapshot reports 19 users of whom 17 are `SANDBOX` rows, leaving `admin` and `judge`
— **no other registered user existed in that database**. The committed swapper-flow list bears the
same shape: of its 16 executed flows, 13 were run by sandbox visitors, 2 by `judge` and 1 by
`admin` ([`d1/14-swapper-flows.json`](evidence/d1/14-swapper-flows.json)).

That is a real demonstration of a public, working application — anyone could open it and deploy a
flow without an account, and 17 people did. It is not a demonstration that identified users came
back and used it. The alpha-tester column is there to answer the second question, which is why the
basis is being reported alongside rather than instead.

_Last updated: 17 September. All-activity figures are the 12 September snapshot
([`evidence/metrics-2026-09-12.json`](evidence/metrics-2026-09-12.json)); earlier snapshot:
[11 September](evidence/metrics-2026-09-11.json). Alpha-tester figures are the 17 September cohort
snapshot ([`evidence/alpha-metrics-2026-09-17.json`](evidence/alpha-metrics-2026-09-17.json))._

## How the numbers are produced

### All public activity — the database

Each snapshot is a read-only query against the application's own database, run from the repository
with the same definitions every time and saved in the evidence index with the figures.
`pnpm instawards:metrics` is the generator, and every snapshot file carries each metric's target and
whether it is met. `--source` names the database the run read: the generator will not assert which
system that was on its own, since `DATABASE_URL` decides it.

Since 16 September 2026 there are **two** databases, so the service has to be named explicitly. The
beta moved onto the staging service, which was repointed at a new Postgres holding a copy of the
beta's data. Every snapshot in the evidence index was taken against what is now the separate
**`postgres-staging-archive`** service. The service called `Postgres` is the live beta database and
yields different figures — the command below used to say `-s Postgres`, which would now read the
wrong system while `--source` still claimed otherwise.

The archive has no public endpoint by design; it holds KYC data, bank details and password hashes.
Since the public TCP proxies were removed, one has to be created for the run and removed straight
after, and the run has to happen from a machine with Railway access:

```bash
railway tcp-proxy create --project <id> -e staging -s postgres-staging-archive --port 5432

railway run -p <project> -s postgres-staging-archive -e staging -- \
  bash -c 'DATABASE_URL="$DATABASE_PUBLIC_URL" pnpm -s tsx scripts/instawards-metrics.ts \
    --source="Read-only SQL against the archived paiflow.xyz application database (Railway project paiflow, environment staging, service postgres-staging-archive)."' \
  > docs/instawards/evidence/metrics-$(date +%F).json

railway tcp-proxy delete --project <id> -e staging -s postgres-staging-archive -y <proxy-id>
```

### Alpha testers — PostHog

The tester column is counted from PostHog rather than the database, for two reasons: the database
cannot tell one user from another without a cohort filter it does not have, and the live beta
database has no public endpoint to query. PostHog identifies per person, so the cohort can be named
exactly.

`pnpm instawards:alpha-metrics` is the generator. It reads
[`evidence/alpha-testers.json`](evidence/alpha-testers.json) — the committed, pseudonymous list of
each tester's `User.id` and the wallets they sign with — and filters every query to those ids. An
entry appears when an account is issued, not when its session runs, so the file records three issued
accounts against a planned five, and `testersActive` reports how many have actually been used. The
generator refuses to emit a snapshot while any id is missing, so a file of zeroes cannot be mistaken
for a measured result.

The list is deliberate, and a role filter would not do. PostHog's own cohort named "Alpha testers"
is `role = USER`, which since the 16 September cutover matches ordinary `paiflow.xyz` visitors as
well. Nor would excluding sandbox sessions be enough on the beta alone: of the five accounts that
signed a transaction there since 16 September, two were `SANDBOX` — sandbox pipelines are signed by
the visitor's own wallet end to end, so they deploy and sign exactly like a tester does. Only an
explicit list of ids separates the round from everything else. No real name, username or email
appears in the file or on these pages.

```bash
POSTHOG_PERSONAL_API_KEY=phx_… pnpm instawards:alpha-metrics --per-tester \
  > docs/instawards/evidence/alpha-metrics-$(date +%F).json
```

Two limits worth stating plainly. PostHog **undercounts** relative to the database: a browser event
lost to an ad blocker or a closed tab is never captured, so `deploy_confirmed` and
`trigger_confirmed` figures are floors. `transaction_signed` does not have that exposure — it is
captured server-side, once per transaction hash, from the same code path that writes the signing
record — which is why the wallet and transaction counts are taken from it. And
**contract executions have no PostHog equivalent** at all: a published contract event is a database
row with no server-side analytics counterpart, so that row has to come from a database run.

## The definitions

- **Unique flows deployed** — confirmed deployments created since the window opened. A flow deployed
  twice counts twice, which is what the SOW's "deployed" measures; the 12 September snapshot also
  records 19 distinct flow definitions behind the 26. On the tester basis, distinct
  `deployment_id`s on `deploy_confirmed`.
- **Contract executions / events published** — contract events the application decoded and published
  to a deployment's live feed, for deployments in the window. This is a subset of what the chain
  emits: at twelve contract events per swap transaction, the twenty swap transactions alone put the
  on-chain count near 240. The application-recorded figure is the one reported, so the number is the
  conservative one. It reached 61 on 12 September.
- **Unique swapper flows executed** — distinct deployments with at least one `swap` event, each
  listed with its transactions in the [evidence index](evidence/README.md#swapper-flows-executed-on-testnet).
  On the tester basis, distinct deployments whose trigger confirmed with a swap in it.
- **Distinct wallets deploying** — distinct signing accounts across confirmed deployments.
  Connecting a wallet is not deploying a flow, so wallet-connection counts are not used as a
  substitute; for reference, 6 distinct wallets connected in the same window. On the tester basis,
  distinct signer addresses on deploy-kind signing records — addresses across the cohort, not one
  per tester.
- **Contract WASM uploaded** — the swapper binary is on testnet, the application's contract-template
  row points at it, and every public-app swap flow instantiates it. The counting rule excludes
  _activity_ from development environments, not the artefact itself, so it counts as 1 on both
  bases: it is one binary, not one per cohort.

The application's internal submission-proof view reports the same user, deployment and wallet
totals as the all-activity basis and is used to cross-check each database snapshot.
