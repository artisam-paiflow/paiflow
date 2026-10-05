# TTL release rehearsal — issue #804

Measured on 4 October 2026 in Railway **hackathon-testing**, using the deployed
application at commit `1b89b9f2d9565930b20268c9a8db76f3a36b081e` and public
TESTNET. The user's environment restriction takes precedence over #804's original
staging wording: staging was not accessed during this rehearsal.

**Inventory coverage, genuine instance recovery through funded channels and
unfunded-channel fallback, and held-lease blocking passed. Ongoing paid maintenance
is disabled. The default fee cap cannot cover all observed instance and code
extensions, and no production budget is established.**

Implementation and network policy remain in [storage lifetime](storage-lifetime.md)
and [CLAUDE.md §7.5](../CLAUDE.md#75-networks). This work changes no payment,
authorization, deadline, or block semantics; SPEC §3 requires those to survive
storage recovery.

## Approved rehearsal cap and due-entry availability

After the recovery and channel checks below, the user approved a temporary
**50-XLM per-transaction maintenance cap** in `hackathon-testing` on 4 October 2026. Only `STELLAR_TTL_MAX_FEE_STROOPS` changed, from `1000000` to `500000000`.
Paid maintenance remains disabled, channels remain unset, and this approval
does not select an ongoing or production budget. The cap is a maximum accepted
declared transaction fee, not a charge applied to every transaction or a
deployment fee. The user subsequently approved a **150-XLM total ceiling for
the entire TESTNET rehearsal**, including fixture setup, recovery, extensions,
and payment fees, on the same date. The cumulative guard described below reserves
declared maximum fees before submission, including transactions with unknown
finality, rather than relying on expected refunds to remain within the ceiling.
The initial recovery measurements below preceded this campaign's approval.

Redeployment `d99fcbb9-36bc-4f3d-8ba5-135a7567eccc` succeeded at the unchanged
application commit. An actual HTTP inventory call then returned `dryRun: true`
and zero submissions. The configuration comparison, HTTP outcome, and public
code-entry read are retained in
[cap-increase evidence](evidence/ttl-cap-increase-hackathon-testing.json).
Deployment aliases in that file are local to its inventory response.

A fresh public TESTNET read at ledger **5,018,428** returned all 25 recorded
code entries. None was due at the unchanged 50,000-ledger threshold. The earliest
entry had 97,727 ledgers remaining, placing it 47,727 ledgers outside that
threshold (approximately 2.8 days at an assumed five seconds per ledger).
This is a timing estimate, not a guaranteed test date: other invocations can
renew shared code before then. A genuinely due code-extension rehearsal must
wait for suitable network state; no threshold change is part of this approval.
The user accepted waiting for genuine due state; no recurring scheduler was
authorized or installed by that decision.

## Deployed inventory

The actual Next HTTP endpoint `/api/cron/maintain-ttl` returned 403 for missing and
incorrect secrets. The existing TTL migration is applied. A complete sequence of
22 authenticated, back-to-back inventory calls made **zero submissions**.

| Measurement                                    | Observed result                                     |
| ---------------------------------------------- | --------------------------------------------------- |
| Eligible confirmed, non-sandbox deployments    | 9                                                   |
| Unique deployed instances                      | 21; pipelines have 2 or 3 targets                   |
| Shared rotation                                | 22 targets, including the factory instance          |
| Distinct inspected entries                     | 22 instances and 25 current/historical code hashes  |
| All deployed instances first inspected         | Call 6                                              |
| Complete shared rotation                       | Call 22; cursor returned to zero                    |
| Endpoint latency                               | Median 4.739 s, maximum 5.626 s                     |
| Sum of endpoint durations                      | 103.044 s                                           |
| Failed deployment attempts / exhausted budgets | 0 / 0                                               |
| Initially observed expired instances           | 19; live-until zero, successful restore simulations |

Historical executable hashes were discovered from the actual instance entries,
including hashes absent from current template configuration. The factory instance
and its actual code were healthy. Successfully inspecting an expired entry is
inventory coverage, not evidence that it is live.

Raw public identifiers, per-call outcomes, rotation progress, simulations and
network archival settings are retained in
[the rehearsal evidence](evidence/ttl-release-hackathon-testing.json).
Deployment database IDs are replaced with stable local aliases; no credentials or
signed envelopes are included.

## Fee reconciliation

The read-only [fee tool](../scripts/measure-ttl-fees.ts) compares the initial
charge, negative refund events, and `TransactionResult.feeCharged` using integer
stroops. On these protocol-26 transactions, the result already equals the **net**
charge. Subtracting the refund from that result again would understate spending.
The tool also records rent separately from other resource/inclusion charges.
See [Stellar fee events](https://developers.stellar.org/docs/learn/fundamentals/stellar-data-structures/events)
and [CAP-67](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0067.md).

The earlier fixture extensions targeted 600,000 ledgers; these are actual
TESTNET observations, not an estimate of every future 500,000-ledger extension.

| Extension                | Declared maximum, XLM | Refund, XLM | Net charge, XLM |
| ------------------------ | --------------------- | ----------- | --------------- |
| Webhook v2 instance      | 0.0934346             | 0.0129913   | 0.0804433       |
| Webhook v2 code          | 25.5250597            | 3.3301142   | 22.1949455      |
| Subscription v7 instance | 0.1734232             | 0.0234244   | 0.1499988       |
| Subscription v7 code     | 40.0180234            | 5.2204744   | 34.7975490      |

Fresh simulations against the 47 inspected entries used a target of 500,000
ledgers. **Nine proposed extensions exceeded the default 0.1-XLM cap**: eight
code entries and one instance. Their current lifetimes are above the due
threshold, so the runner would not submit these operations yet. The largest
simulated declaration was **40.4847162 XLM** for the current Swapper code.
Already-long-lived entries simulated cheap no-op extensions; those values must
not be used as future rent estimates.

Reconciled extension and restoration transactions are recorded in
[fee evidence](evidence/ttl-fee-reconciliation-testnet.json).

## Actual capped recovery and rollback

In the first recovery run, only the TTL flag and fee cap were temporarily changed
in `hackathon-testing`.
The app was redeployed at each setting; application code and shared hashes stayed
at the same release. Other automation and relayer-channel configuration were
preserved.

1. With paid maintenance enabled and a **100-stroop** cap, the deployed endpoint
   rejected four due restoration attempts. No transaction hash was returned; the
   relayer's sequence and balance were unchanged. `submissions` counts attempts,
   including rejected simulations, rather than confirmed transactions.
2. With the existing **1,000,000-stroop** cap, one actual HTTP call restored four
   expired instances. Transaction metadata contains `ledgerEntryRestored` for
   each contract entry and its TTL. Before/after value hashes match for every
   inspected instance; existing configuration was preserved.
3. The call took **22.912 seconds**, processed four deployments, and reported
   `budgetExhausted: true`. The 20-second budget is checked between items and can
   be exceeded while one item completes finality.
4. The four declared fees totalled **0.1481618 XLM**, refunds **0.0217480 XLM**,
   and net fees **0.1264138 XLM**. The relayer balance fell by exactly that net
   amount and its sequence advanced by exactly four.
5. Paid maintenance was disabled and a subsequent deployed HTTP call verified
   `dryRun: true` and zero submissions. Final settings are explicitly
   `STELLAR_TTL_MAINTENANCE_ENABLED=false` and
   `STELLAR_TTL_MAX_FEE_STROOPS=1000000`; both were initially unset and resolved
   to those same effective defaults. Final successful deployment:
   `ffd52891-9c54-49b5-9ac3-740e46759edf`.

Net restoration charges were 0.0226962, 0.0226962, 0.0430257 and 0.0379957 XLM.
These are genuine public TESTNET instance restorations through the deployed
relayer-source lane. The executable code was already live. This does not claim
archived-code recovery, a payment after restoration, or a wallet/factory journey.

## Deployed channel and held-lease checks

The follow-up used the same deployed application commit, actual Next HTTP route,
Railway PostgreSQL/Redis and public TESTNET. Channel 0 did not exist initially.
The fallback case therefore ran first; Friendbot then funded that same derived
channel for the funded case. No account was drained to create the unfunded case.
The only temporary settings were `STELLAR_RELAYER_CHANNELS=1` and
`STELLAR_TTL_MAINTENANCE_ENABLED=true`; the existing **1,000,000-stroop** per-operation
cap was preserved. Temporary successful deployment:
`8f4a5b81-d3db-4f97-af2d-063107a30719`.

With paid maintenance enabled, a test owner acquired `cron:maintain-ttl` using
Redis `SET NX PX 120000`. Two concurrent authenticated HTTP calls returned
`leaseHeld: true`, `dryRun: false`, zero deployments/submissions, and empty details
in **149 and 150 ms**. Deployment scan timestamps/offsets, the shared cursor,
maintenance audit count, and both payer accounts stayed unchanged. The owner
remained present with a positive TTL throughout. Compare-and-delete released
only that owner's lease; the key was then absent. This verifies blocking by an
already-held lease, not renewal during a long-running job or Redis-outage behavior.

| Recovery case                                 | Confirmed restorations | Declared fees, XLM | Refunds, XLM | Net fees, XLM | Rent alone, XLM |
| --------------------------------------------- | ---------------------- | ------------------ | ------------ | ------------- | --------------- |
| Configured but unfunded channel; relayer pays | 4                      | 0.1549812          | 0.0226359    | 0.1323453     | 0.1294491       |
| Funded channel 0 pays                         | 4                      | 0.1078716          | 0.0165044    | 0.0913672     | 0.0885712       |

All eight transactions succeeded with one `restoreFootprint` operation each.
Metadata proves restored contract and TTL entries; every restored instance's
live-until moved from zero to beyond the observed ledger, and its before/after
contract value hash matched. Executable code was already live. Every declared
fee was below the unchanged per-operation cap; neither tick reported failed
targets or deployments.

The unfunded tick took **21.782 s**, with four exact relayer sequence increments
and a **1,323,453-stroop** balance reduction. Channel 0 remained absent. The
funded tick took **23.367 s**, with four exact channel sequence increments and a
**913,672-stroop** balance reduction. The relayer balance and sequence were
unchanged during that tick. Both processed four deployments and exhausted the
inter-item time budget. These are different instance sets and are not a
comparison of the signing lanes' cost or throughput.

Rollback restored **every application variable to its pre-check value**:
paid maintenance false, cap 1,000,000 stroops, and channels unset (effective zero).
Final successful deployment `39172609-350e-46c2-89f0-d4d0b32fc5b0` retained the same
commit. An actual HTTP inventory call returned `dryRun: true`, zero submissions,
and unchanged balances/sequences for both accounts. The Friendbot-funded TESTNET
channel still exists with **9,999.9086328 XLM**, but is no longer configured for
use. No recurring scheduler or shared WASM activation was added.

Public transaction hashes, rent/fee/refund events, payer snapshots, contract
value hashes, both lease responses and rollback evidence are retained in
[channel and lease evidence](evidence/ttl-channels-lease-hackathon-testing.json).
Database deployment aliases are local to that evidence file. Credentials,
private keys and signed envelopes are excluded.

## Operating recommendations and capacity limits

- **Cadence:** propose one-minute inventory calls for #460. The observed workload
  would cover deployments in about six minutes and shared targets in 22 minutes.
  The calls here were back-to-back; an installed scheduler has not been verified.
- **Coverage gate:** require a complete observed cycle within 24 hours, leaving
  substantial runway inside the 50,000-ledger threshold (about 2.9 days at
  five-second ledgers). Recheck this gate as deployment count and pipeline sizes
  grow, and include paid-operation latency and failed/deferred targets.
- **Scale projections:** at one-minute cadence, the conservative deployment
  estimate `ceil(deployments / 5) × largest pipeline size` gives 60 minutes for
  100 deployments with three targets, and seven hours for 700 such deployments.
  For 100 deployments with 840 targets it gives 11.7 days, exceeding the runway.
  These are projections with full five-deployment ticks, not load-test results;
  the paid recovery tick processed only four deployments.
- **Fee cap:** the earlier 0.1-XLM cap successfully bounded the recovery tests
  but is insufficient for comprehensive maintenance. The user subsequently
  approved a temporary **50-XLM TESTNET code-extension rehearsal cap**, with
  paid maintenance still disabled pending enforcement of the approved total
  rehearsal spending limit. This covers
  the observed declarations with headroom but is not an unattended setting or
  a mainnet cap. The 12-attempt bound alone would allow up to
  **600 XLM per tick** at that cap. The configured campaign further bounds
  guarded submissions to its remaining conservative allowance; it is a fixed
  rehearsal ceiling, not an ongoing daily spending policy.
- **Budget model:** count unique instance and historical-code keys, deduplicating
  shared WASM. At an assumed five-second ledger, renewal from 50,000 to 500,000
  adds roughly 26 days. Budget net rent per key over that interval, plus measured
  reads/resource fees, restoration backlog and contingency. Current no-op code
  simulations cannot price all historical WASM; a comprehensive numeric monthly
  budget is still unverified. Per-operation caps bound individual transactions,
  not daily/monthly spending.
- **Funding and alerts:** before enablement, require each payer's available
  balance above reserves to cover its declared operation plus the agreed buffer.
  Monitor actual net spending, cap rejections, cycle age, TTL runway, expired/
  missing entries, failures, deferred work and payer funding. Treat any cap
  rejection as unresolved coverage. Start with a six-hour cycle-age warning and
  a 24-hour action threshold for this small workload; reassess these as it grows.
  Disable the paid flag to return to inventory. Retain #202's single-process
  signing constraint.

## Proposed initial capacity target

On 4 October the user requested help choosing a workload because expected usage
is unknown. The following is a recommendation for testing, not an approved
product restriction or a measured capacity guarantee. The remote `hackathon`
head was reverified at this report's application commit before assessing it.

- Initial test target: **100 eligible deployed pipelines**, typically three
  contract instances each, with a largest pipeline of ten contract instances.
  Count every deployment the maintenance query retains, including old/cancelled
  non-sandbox pipelines; users and payment frequency do not bound this inventory.
- Include current/historical shared code, the factory, representative failed
  reads, cap rejections, and a bounded paid backlog. Healthy scan rotation alone
  is insufficient evidence of successful maintenance for failed/due targets.
- Proposed cadence remains one minute, to be installed only under #460's
  separate authorization. With all five deployment visits available per tick,
  the existing model projects **60 minutes** for 100 three-contract pipelines
  and **200 minutes** for 100 ten-contract pipelines. Both exclude paid/failure
  delays and are projections, not results.
- Proposed initial gate: complete inventory and successfully handle due targets
  inside **six hours**, counting factory and shared targets; no unresolved
  failed, missing, fee-rejected, or uncertain-finality target may be described as
  successfully maintained. Keep the 24-hour action threshold as an operational
  escalation, not permission to declare a failed six-hour test successful.
- Growth stress case: **700 pipelines with ten contracts each**, representing
  the earlier hypothetical 100 users deploying daily for a week. The same
  full-five-visit model projects **1,400 minutes (23 h 20 min)** before delays.
  This is too close to the 24-hour action threshold and fails the proposed
  six-hour gate. Resolve scan capacity in a focused follow-up before enabling
  that workload; do not infer support for it from the initial target.
- Funding: the approved 150-XLM ceiling covers this rehearsal only. Derive a
  recurring TESTNET budget from unique due instance/code keys and measured rent,
  with restoration backlog and contingency priced separately. Choose payer
  funding and alerts from that budget. MAINNET requires its own measurements
  and release approval; no monthly production budget is selected here.

These recommendations do not change app limits, scan policy, concurrency,
configuration, contract hashes, scheduler registration, or paid enablement.

## Durable campaign guard and disposable recovery fixture

The named campaign `ttl804-testnet-20261004` has a fixed **150-XLM** limit.
The guard reserves declared maximum fees atomically in PostgreSQL before
submission and records the reservation audit in the same transaction. It uses
integer string money and rejects changed limits, duplicate hashes, exhausted
budgets and unavailable persistence. Refunds, failure, expiry and uncertain
finality do not free reservations. This bounds guarded submissions across
restarts and competing ticks; it does not solve relayer source coordination
across processes (#202) or budget unrelated automation.

The additive migration is applied to `hackathon-testing`. A fresh preflight on
5 October HKT confirmed the approved settings, both completed TTL migrations,
and **zero committed fees** before fixture setup. The real isolated PostgreSQL
race admitted exactly three of twenty concurrent 50-XLM reservations, rejected
the other seventeen, and retained the ceiling after reconnect. Duplicate and
changed-limit attempts rolled back without increasing commitments; see
[budget evidence](evidence/ttl-fee-budget-local.json). Reconnect is not a literal
process-restart test.

The fixture tooling deploys one disposable **Webhook v2 → Pay v4** pipeline
through the existing compiler/factory using already uploaded WASM. It escrows
exactly **1 test XLM** by direct native-token transfer, preserving the fixture
instance lifetime. It does not register a DB maintenance deployment. The admin
is generated locally and its private key is never persisted or published;
the configured relayer can later release escrow. Setup reservations, public
transaction hashes, declared/net fees, instance hashes and payer accounting are
saved before further work. A permanent campaign setup claim is consumed atomically before Friendbot funding,
so concurrent preparation processes cannot create another fixture. Existing setup
reservations also block preparation; ambiguous outcomes require reconciliation
without blind resubmission.

`scripts/recover-ttl-rehearsal.ts` defaults to read-only inspection. An explicit
`--execute` later requires both instances to be genuinely expired, unchanged
configuration and the expected escrow balance before using the real relayer
builder. It checks exact recipient payment and zero residuals after confirmation.
Missing ledger entries fail closed and require further archival investigation.
Webhook construction conditionally requests extension to 500,000 ledgers, only
below the 50,000-ledger threshold. In this real deployment the network's initial
lifetime exceeded the threshold, so both instances retain the measured initial
seven-day lifetime. No accelerated shared code change or installed scheduler is
part of this preparation.

The reviewed commit `25a2037693ba0905f1e58477d2617a26a54f6ff6` was deployed
from a tracked-only git archive. Railway deployment
`3169b6b2-48bb-4e6a-865a-091ca45a6bd5` is **SUCCESS**. The actual HTTP health
check reported healthy PostgreSQL, Redis and RPC; missing/wrong cron secrets
returned 403 and authenticated inventory returned `dryRun: true`, zero submissions
and no failed targets/deployments. Health version is `dev` because CLI uploads
provide no `RAILWAY_GIT_COMMIT_SHA`; source provenance is the archived commit and
deployment message. This inventory call does not execute the paid guard path.

Fixture setup and direct deposit each succeeded with one Soroban invocation.
Their combined declared maximum is **1,313,198 stroops (0.1313198 XLM)**,
refund is **183,652 stroops**, and net charge is **1,129,546 stroops
(0.1129546 XLM)**. The disposable payer's balance fell by exactly that net charge
plus the **1-XLM** deposit; its sequence advanced exactly twice. The fixture
Webhook holds 1 XLM, Pay holds zero, and no recovery or downstream payment has
been invoked. Both instances have `liveUntilLedger: 5147491`; the read-only
waiting check at ledger 5,026,539 found unchanged configuration hashes and made
zero submissions. At five seconds per ledger, expiry is approximately seven
days away; ledger state, not this estimate, gates recovery.

The durable campaign has two reservations totalling **1,313,198 stroops**, with
**1,498,686,802 stroops (149.8686802 XLM)** of conservative allowance remaining.
All application variable values and the shared template/factory configuration
fingerprint match the pre-deployment snapshots. Paid maintenance remains false
and channels remain unset. Friendbot funded both disposable accounts; setup
did not draw from the relayer.

Public evidence: [guard deployment and reconciliation](evidence/ttl-guard-fixture-hackathon-testing.json),
[fixture manifest](evidence/ttl-recovery-fixture-testnet.json), and
[read-only waiting check](evidence/ttl-recovery-fixture-waiting-testnet.json).
This preparation does not establish recovery/payment, genuinely due deployed
code extension, browser/wallet coverage, expected-scale capacity or ongoing funding.

Local verification on 5 October HKT: **205 files / 3,074 tests passed** in one
complete run against disposable local PostgreSQL/Redis, plus typecheck, lint,
production build, formatting and diff checks. Earlier attempts failed on blocked
localhost access and the unavailable default database; the isolated-services run
resolved those failures. The focused fee/TTL/rehearsal tests include durable
reservation failure, cap/network rejection and exact string payer accounting.
Public files were scanned against the actual task credentials before publication.

## Independent review fixes

The follow-up review found two evidence/tooling issues: preparation checked for
an existing setup non-atomically, and recovery saved a confirmed payment only
after subsequent verification reads. Both are resolved.

`20261005000000_ttl_fixture_setup_claim` adds a permanent campaign claim and
backfills it from existing setup/deposit reservations. Claiming uses one atomic
update and writes its audit in the same transaction, before any Friendbot funding.
A failed preparation does not release the claim; reconcile it before further work.
The isolated PostgreSQL check admitted **one of twenty concurrent setup claims**,
rejected the other nineteen and rejected a claim after reconnect. It committed
zero fees. Applying the migration over an existing fixture preserved its original
claim timestamp and committed amount, and blocked another setup.

Recovery now saves each payment or separate legacy restoration hash before send,
then saves its terminal outcome immediately upon finality, before measuring fees
or reading balances/instances. A verification failure after payment retains the
confirmed transaction and explicitly marks verification failed. Any reserved
attempt without known finality yields `networkSubmissions: null`, with confirmed
transactions counted separately. Neither a read failure nor an uncertain attempt
is reported as zero submissions or permission to retry.

The full local suite, typecheck, lint and production build passed. The 112 focused
tests cover claim/audit failures, terminal payment persistence despite later read
failures, separate legacy restorations and observer persistence failures. An
independent reviewer found both original findings resolved with no actionable
regressions. These checks made no chain submissions; see
[local fixes evidence](evidence/ttl-review-fixes-local.json).

The reviewed fixes at `97261d161396800edfac6aa63ee017451df96799` deployed from a
tracked-only archive to `hackathon-testing` in successful deployment
`e4a14507-5fdf-4866-a5e6-29c383d66108`. The new migration backfilled the campaign
claim from the original setup reservation. Both existing reservations and the
**1,313,198-stroop** commitment are unchanged. All app variable values and shared
configuration are unchanged; paid maintenance remains disabled and channels unset.
Actual HTTP health reported DB/Redis/RPC healthy, missing/wrong cron secrets
returned 403, and authenticated inventory returned dry-run with zero submissions
and no failed targets/deployments. The fixed recovery controller's read-only run
still reports awaiting natural expiry, with no transactions. These fixes made
**zero chain submissions**. See
[deployed fixes evidence](evidence/ttl-review-fixes-hackathon-testing.json).

## Local capacity rehearsal — 5 October 2026

The baseline opt-in [rehearsal](../tests/rehearsal/ttl-capacity.test.ts) executed the
original maintenance runner, including its actual PostgreSQL selection/order,
durable cursors, audits and Redis lease. All RPC methods and channel acquisition
are replaced with synthetic adapters. No public RPC, Railway service, shared
configuration or blockchain transaction is involved. Evidence and runtime-source
SHA-256 values are in [local capacity evidence](evidence/ttl-capacity-local.json).
This is additional #804 evidence, not deployed capacity certification.

Each workload includes one factory instance, **28 unique code hashes** (21
current template hashes, six historical hashes, and factory code), plus its
pipeline instances. Three additional rows exercise exclusion of sandbox,
failed and other-network deployments. Old ended schedules remain eligible.
Snapshots and code bytes are synthetic; these fixtures do not prove graph,
constructor, wallet or factory compatibility.

Calls start one minute apart in virtual time. Normal read/account/simulation/send
methods cost an assumed **350 ms** each; the slow-read case assumes **3 seconds**.
Finality costs an assumed five or thirty seconds in one synthetic response.
Paid request counts omit repeated finality polling and provider retries.
Ledger progression is five seconds. Actual local database/Redis wall time and
query counts are recorded separately and **excluded** from modeled cycle time;
the cycle results therefore need additional deployed latency/headroom validation.
The first tick starts immediately, so 60 calls finish just after minute 59.

| Workload / condition                                      | First complete coverage or maintenance | Six-hour coverage gate                 |
| --------------------------------------------------------- | -------------------------------------: | -------------------------------------- |
| 100 × 3, healthy                                          |                              59.08 min | Pass in model                          |
| 100 × 10, healthy                                         |                             199.08 min | Pass in model                          |
| 99 × 3 plus one × 10, healthy                             |                             180.08 min | Pass in model                          |
| 700 × 10, healthy                                         |             1,399.08 min (23 h 19 min) | Fail                                   |
| 100 × 10, three-second reads                              |                397.35 min (6 h 37 min) | Fail                                   |
| 100 × 3, first-read failures on 15 instances              |                             117.08 min | Pass after recovery                    |
| 100 × 3, all targets initially due, five-second finality  |                             109.29 min | Pass in model                          |
| 100 × 10, all targets initially due, five-second finality |                342.37 min (5 h 42 min) | Little margin                          |
| 100 × 3, all targets due, thirty-second finality          |                             348.55 min | Coverage passes; response target fails |
| 100 × 10, all targets due, thirty-second finality         |             1,048.55 min (17 h 28 min) | Fail                                   |

The matrix also covers two consecutive healthy cycles, a paid cycle followed by
a healthy cycle, synthetic restoration, persistent read failures, missing
entries, fee-cap rejection/recovery and unknown finality. Persistent read/missing
and fee-rejected cases retain **15 unresolved instances** at six hours despite
cursor rotation. The unknown-finality case makes exactly one synthetic send,
then blocks its synthetic source; all 329 targets remain unresolved. This source
adapter deliberately does not model eventual reconciliation/expiry, channel-pool
availability, cross-process locking or process restarts. It does not re-prove
the real channel implementation's pending handling.

Normal healthy calls made at most **14 synthetic RPC method calls** and used
at most 4.9 seconds of modeled RPC time. The slow-read case reached 24 seconds.
Five-second-finality paid calls reached 22.7 seconds; thirty-second-finality
calls reached **33.5 seconds**, exceeding the repository's existing 30-second
cron caller target. These are separate coverage/response checks: a six-hour
coverage pass cannot make an overlong HTTP response acceptable. The TTL
scheduler is still unregistered, and no external timeout was exercised here.

### Capacity and funding recommendation

Keep **100 pipelines, typically three contracts with occasional larger
pipelines**, as the initial validation workload, not an enforced product limit.
The 100 × 10 due case leaves only about 18 minutes of the six-hour allowance,
before database latency, competing relayer work or provider throttling. Do not
claim comfortable coverage for that workload. The 700 × 10 workload needs a
focused capacity follow-up before enablement; slower finality also requires
resolving the cron response budget/topology under #460. No runner limits or
submission concurrency were changed by this rehearsal.

The one-minute cadence and six-hour gate remain candidate settings. A deployed
check must calibrate RPC/DB latency and competing traffic before adopting them.
Use unresolved-target count, oldest successful inspection/maintenance age,
partial/time-exhausted ticks, per-call duration, fee rejection and pending
finality as operating signals. Cursor completion alone is not successful
maintenance. Start the clock for never-successful targets at workload entry.

The harness's 40,000-stroop resource fee is deliberately synthetic and **must
not be used to set a recurring budget**. Existing reconciled TESTNET extensions
in the fee table above show why code rent must be priced separately from
instance rent. Those samples target 600,000 ledgers; genuinely due deployed
500,000-ledger code measurements remain outstanding. A budget worksheet needs:

- Counts and sizes of unique instance/code keys, including historical code.
- Actual declared fees, refunds and net rent for due extensions; restoration
  backlog priced separately. Mutation-time renewals can reduce background work.
- Expected renewals over the selected horizon, contingency, per-operation and
  per-tick ceilings, a durable daily/monthly ceiling, and each payer's available
  balance above account reserves.

The approved **50-XLM operation / 150-XLM campaign** bounds remain rehearsal
settings. This local test incurs zero chain fees and does not consume that
campaign. No unattended monthly budget or production funding decision is made.

### Reproduce the local rehearsal

Use fresh disposable containers; the harness refuses any nonempty application
table or Redis database, requires the fixed loopback ports below, scrubs inherited
application configuration, and serializes rehearsal instances. The normal unit
suite does not run this integration config. The password below is a deliberately
public local fixture value, not an application credential.

```bash
podman run -d --name paiflow-ttl-capacity-postgres --pull=never \
  -p 127.0.0.1:55484:5432 \
  -e POSTGRES_USER=capacity -e POSTGRES_PASSWORD=capacity-local-only \
  -e POSTGRES_DB=ttl_capacity docker.io/library/postgres:18-alpine
podman run -d --name paiflow-ttl-capacity-redis --pull=never \
  -p 127.0.0.1:56384:6379 docker.io/library/redis:7-alpine

export NODE_ENV=test STELLAR_NETWORK=testnet
export AUTH_SECRET=local-capacity-test-auth-secret-32-chars
export DATABASE_URL=postgresql://capacity:capacity-local-only@127.0.0.1:55484/ttl_capacity
export REDIS_URL=redis://127.0.0.1:56384/0

# Once PostgreSQL is ready, apply existing migrations to this disposable DB.
pnpm exec prisma migrate deploy
pnpm exec vitest run --config scripts/ttl-capacity.config.ts
pnpm exec prettier --write docs/evidence/ttl-capacity-optimized-local.json

# After the run, remove these rehearsal-owned services and their disposable data.
podman rm -f paiflow-ttl-capacity-postgres paiflow-ttl-capacity-redis
```

Current runs write `ttl-capacity-optimized-local.json`; the original baseline
`ttl-capacity-local.json` is retained for comparison. Fixture rows and lease keys
are removed during teardown; the containers should still be removed explicitly.
Do not reuse these exports for ordinary unit tests that may touch the database.

Validation passed: **19 integration checks across 18 scenarios**, **75 focused
unit tests**, typecheck, lint and formatting. Evidence totals and runtime-source
hashes were independently recomputed. A deliberate occupied-database run was
rejected before fixture creation; its sentinel row was preserved and its Redis
lock released. Both rehearsal containers were removed after verification.

## Local throughput and time-budget improvement — 5 October 2026

The authorized local optimization changes the runner, without changing contracts,
fees, activation settings, dependencies or schema. It selects up to 25 oldest
non-sandbox deployments and ten instances per deployment, pooling reads across
flows in RPC requests of at most 100 keys. Shared targets rotate in batches of ten.
Actual executable hashes remain authoritative and deduplicated. Failed reads
split into smaller batches to isolate bad keys; at most 50 inventory requests run
per call, excluding setup and rent rechecks/post-reads. Targets deferred before
an attempt retain their durable cursor and timestamp. An exhausted fallback read
cannot permanently starve later rows or shared targets: both cursors advance
only through the contiguous attempted prefix, including failed attempts, and
resume at the first unattempted target. Complete snapshots still validate before
any target from that deployment is used.

One 20-second deadline now bounds inventory/account/simulation/send/finality waits
and channel acquisition. A late queued callback fails before signing. Reservation
and confirmed-result writes finish normally, so this is not a guaranteed HTTP
response deadline. The runner rechecks lifetime under the acquired channel lock
to avoid a redundant renewal after a previous pending transaction confirms.
Unknown send/finality reports `pending`, a public hash and declared fee, and writes
`CONTRACT_STORAGE_RENT_PENDING`. Source barriers, fee caps, durable campaign
reservations and the 12-attempt limit remain in force; submissions stay sequential.
Restart/multiple-process source coordination remains #202.

The [optimized evidence](evidence/ttl-capacity-optimized-local.json) retains source
hashes and all 18 scenarios. The [baseline evidence](evidence/ttl-capacity-local.json)
is preserved. Both use real local PostgreSQL/Redis, synthetic RPC and one-minute
virtual cadence. These are modeled maintenance times, not provider measurements
or payment/user throughput. The updated adapter models the new finality timeout:
confirmation changes synthetic ledger state independently of source acquisition,
and a later acquisition reconciles that synthetic pending hash. Lost-response
sends remain blocked indefinitely. Real source-barrier reconciliation is covered
by the existing unit/isolated-chain evidence, not re-proven by this adapter.
Ordinary synthetic read costs still advance Date in one step, conservatively
allowing modeled overshoot up to one read. Real timer tests separately verify
that hung waits stop at the remaining deadline.

| Workload / condition                          | Baseline complete maintenance | Optimized complete maintenance |
| --------------------------------------------- | ----------------------------: | -----------------------------: |
| 100 × 3, healthy                              |                     59.08 min |                   **3.03 min** |
| 100 × 10, healthy                             |                    199.08 min |                   **3.04 min** |
| 99 × 3 plus one × 10, healthy                 |                    180.08 min |                   **3.03 min** |
| 700 × 10, healthy                             |                  1,399.08 min |                  **27.04 min** |
| 100 × 10, three-second reads                  |                    397.35 min |                   **3.35 min** |
| 100 × 3, transient read failures              |                    117.08 min |                   **3.06 min** |
| 100 × 3, all due, five-second confirmation    |                    109.29 min |                 **110.03 min** |
| 100 × 10, all due, five-second confirmation   |                    342.37 min |                 **343.15 min** |
| 100 × 3, all due, thirty-second confirmation  |                    348.55 min |                 **329.04 min** |
| 100 × 10, all due, thirty-second confirmation |                  1,048.55 min |               **1,029.04 min** |

Healthy 100 × 3 uses **20 RPC requests** per complete cycle versus 775 before;
100 × 10 uses **28 versus 2,589**. Growth uses **200 versus 18,114**. Maximum
normal healthy requests per tick fall from 14 to **6–8**. Normal healthy RPC time
per tick falls from 4.9 seconds to **2.1–2.8 seconds**. Faster scanning therefore
uses fewer requests for the complete workload and a smaller healthy burst.
Persistent failures require additional isolation reads: the six-hour scenario
uses **15,946 versus 4,567** requests, peaking at 48 per tick. The hard inventory
cap and shared deadline bound that work; these failure costs remain a deployed
calibration/operating concern.

Paid calls in the slow-confirmation scenarios reach **20 modeled seconds**
versus 33.5 before. All scenarios pass the separate modeled 30-second response
check, including three-second inventory reads peaking at 21 seconds. Actual DB
writes, lock/barrier background completion and outstanding SDK sockets remain
outside a hard end-to-end guarantee. Existing per-request SDK transport timeouts
still apply; timing out a wait does not cancel an accepted transaction.

Paid throughput is broadly unchanged: the 100 × 10 five-second case has only
about **17 minutes** of modeled six-hour headroom, and the thirty-second case
still fails six hours. Faster healthy inventory does not remove the sequential
source/finality constraint. Shorter waits increase pending records: 109 of 329
synthetic sends in the typical paid case, and all sends in the thirty-second
cases, return before confirmation. Later healthy inventory establishes coverage;
these pending audits alone never count as confirmed maintenance or charged-fee
reconciliation. No target is sent twice in the matrix.

Two healthy cycles finish at **3.03 / 7.03 minutes**; paid then healthy cycles
finish at **110.03 / 114.03 minutes**. Persistent read failure, missing entries and
fee rejection leave exactly **15 deliberately affected instances** unresolved,
with healthy neighbours and all code inspected. Fee recovery finishes at
115.03 minutes. The lost-response scenario makes exactly one synthetic send and
keeps its source blocked, leaving all 329 targets unresolved. Held Redis leases
still prevent any DB/RPC work; ownership-aware teardown releases the lease and
removes rehearsal fixtures.

Initial optimization validation: **19 integration checks across 18 scenarios**, **3,129 Node/DOM tests
in 208 files**,
typecheck, lint, formatting and production build. Focused tests exercise the
100-key boundary, partial cursors, fallback starvation, instant provider failure,
hung finality, late channel acquisition, fresh reads after acquisition and
reservation expiry before signing. Both evidence totals and source hashes were
independently checked. No Rust changes require a new WASM upload.

Independent review then found that the shared cursor advanced by its entire
batch when recursive fallback stopped early. The fix retains the first
unattempted shared position. New regressions run four deadline-limited ticks
through ten shared targets, including a failed singleton, and verify that
deployment-first request-cap exhaustion leaves shared targets eligible on the
next tick. Follow-up checks passed **87 focused tests across five files**,
typecheck, lint, formatting and diff checks. The guarded local capacity rehearsal
also passed all **19 integration checks across 18 scenarios** after the fix,
regenerating optimized evidence with verified current runtime-source hashes.
Modeled coverage, timing and RPC results are unchanged; database query counts
and wall times vary between runs. The original baseline evidence is preserved.

These measurements and implementation checks ran locally, with zero public RPC requests,
zero chain submissions and zero campaign spending. No live service, scheduler,
shared template configuration or paid-maintenance activation changed. The next
release gate is small bounded `hackathon-testing` latency/headroom calibration;
due-code fee measurements, recurring funding, #805 activation and #460 scheduling
remain separately scoped. Disposable test services are removed after validation.

## Remaining #804 release evidence

This report advances #804; it does not close the issue. Remaining checks are:

- A due **extension** through the deployed cron, including expensive code and
  actual refunds; the paid run here restored instances only.
- Public TESTNET archived-code recovery and invocation/payment after recovery,
  or an explicit release decision accepting the isolated-chain evidence and
  its limits.
- Browser/factory/wallet coverage coordinated with #805 without implicitly
  activating its new shared artifacts.
- Deployed expected-scale/headroom validation against the local capacity matrix
  above, with measured RPC/DB latency and competing work, followed by numeric
  ongoing budget/funding selection. The baseline identified growth/latency limits; the local optimization improves healthy scanning, while slow paid growth still fails;
  it does not install scheduling or prove public-provider capacity. Mainnet cost
  measurements and a production release decision remain outstanding.

## Reproduce the read-only fee measurements

With the existing local environment configuration and transaction history still
inside the RPC retention window:

```bash
pnpm exec tsx --conditions=react-server scripts/measure-ttl-fees.ts \
  docs/evidence/ttl-maintenance-testnet.json /tmp/ttl-extension-fees.json
```

The tool accepts a top-level `transactions` array. To remeasure restorations from
the combined fee evidence, first extract its `restorations` object into its own
input file and pass that file to the same command.
It refuses non-TESTNET configuration and non-rent operations, and never signs or
submits. No dependencies were added. The cumulative guard adds the
`20261004020000_transaction_fee_budget` migration. Verification: typecheck and
focused fee/TTL/cron tests, plus the real deployed checks recorded above.
