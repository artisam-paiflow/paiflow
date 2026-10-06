# Storage lifetime maintenance

Stellar instance storage and WASM code have independent live-until ledgers. Rust
`instance().extend_ttl()` checks and extends both independently. External
`extendFootprintTtl` extends only the keys named in its footprint. Expired durable
state is archived, not deleted. Protocol 23 invocation simulations can include an
automatic restore list; preserving the simulated transaction data preserves that
list. See [Stellar archival documentation](https://developers.stellar.org/docs/learn/fundamentals/contract-development/storage/state-archival).

This change supports the SPEC §3 requirement that time conditions preserve their
release rules and that Subscription charges only when due and authorized. TTL
maintenance never changes a deadline, allowance, recipient, graph, or charge date.

## Execution maintenance

Standard Subscription **v7** and Webhook **v2** extend at construction and after
successful mutations when remaining TTL is at most **50,000 ledgers**, extending
to **500,000 ledgers**. These are the existing standard-contract thresholds.
Getters remain read-only. Transaction rollback also rolls back an extension.
Constructors check the same threshold and pay extension rent only when needed; this is a reliability policy, not a
claimed fee saving. Function signatures and storage layouts remain compatible.

Building or merging does not activate new WASM. Upload and synchronize these new
versions only through the existing release workflow, independently for each
network. Existing immutable instances continue using their deployed code.

## Background inventory and maintenance

`GET` or `POST /api/cron/maintain-ttl` uses `requireCronSecret` and a renewing cron
lease. No request body controls the network, target, fee, or rollout mode. Network
selection follows [CLAUDE.md §7.5](../CLAUDE.md#75-networks).

The default, `STELLAR_TTL_MAINTENANCE_ENABLED=false`, inventories and reports only.
It writes scan rotation to Postgres but never signs, simulates payment calls, or
submits a transaction. Reports show `healthy`, `due`, `missing`, `failed`, and
scan progress; a dry-run `due` entry is not an extension or a fee estimate.

After rollout review, `true` allows bounded rent operations using existing relayer
channels. The maximum fee per submission is `STELLAR_TTL_MAX_FEE_STROOPS`
(default **1,000,000 stroops**, 0.1 XLM). At most **12 attempts** run per tick,
so the configured worst-case submitted fee bound is 12 times that cap. Attempts
that fail simulation count toward the budget. Reports include declared envelope
fee bounds and hashes on confirmed success; `feeStroops` is not the charged fee
after refunds. Rent may be substantially less;
the cap is not an estimate.

Paid caps above 0.1 XLM require both `STELLAR_TTL_FEE_BUDGET_NAME` and
`STELLAR_TTL_FEE_BUDGET_STROOPS`. The additive
`20261004020000_transaction_fee_budget` migration stores a fixed, per-network
campaign limit and transaction reservations. Each guarded submission atomically
reserves its declared maximum fee and writes an audit record before sending.
Reservations survive restarts; refunds, rejection, expiry and unknown finality
never replenish this conservative allowance. A duplicate hash or changed limit
is rejected. When configured, this guard covers maintenance, the relayer builder's
explicit legacy restoration, and the #804 fixture tooling; unrelated automation
fees are outside the campaign. Missing persistence fails closed.

The fixture tooling also consumes a permanent campaign setup claim atomically
before Friendbot funding. `20261005000000_ttl_fixture_setup_claim` backfills that
claim from existing setup/deposit reservations, preserving previous authorization
consumption. A failed preparation does not release it. Recovery journals payment
and any separate legacy restoration immediately at finality, before fee metadata
or verification reads; uncertain attempts retain their hashes and report unknown
submission count. See [review fixes](ttl-release-rehearsal.md#independent-review-fixes).

Discovery uses:

- Current template and factory rows, freshly queried from the DB, with env
  fallback only when absent. Shared targets are sorted and deduplicated.
- Every confirmed deployment in the environment's network owned by a non-sandbox
  user. No inactivity, cancellation, graph, or schedule-end heuristic retires a
  pipeline: old holds, funded schedules, and dependencies remain covered.
- Exact instance keys from durable pipeline snapshots (the legacy root address
  only when no snapshot exists). Actual executable hashes from ledger entries
  identify historical WASM; current template hashes are never substituted.

A run selects up to **25 oldest inventory attempts**, reading up to **ten unique
instances per deployment** in a batch, then inspecting their actual code hashes.
Reads are pooled across these deployments in requests of at most 100 keys.
Shared factory/template targets rotate in batches of ten. Durable `ttlCheckedAt`
and `ttlScanOffset` advance through large pipelines even after a failed target;
failed batched reads split into smaller batches, down to individual failed keys,
within the remaining budget, with at most **50 inventory requests** per call.
The cap excludes the two setup reads and per-operation rechecks/post-reads; rent
attempts retain their separate limit. `inventoryReadLimitReached` reports exhaustion.
Deployment and shared cursors advance only through the contiguous prefix of
attempted targets, including attempted failures. If fallback reads stop at the
deadline or request cap, the first unattempted target remains eligible next tick.
A separate network cursor alternates whether shared or deployment work runs first.
Instance and code reads and decisions remain independent. Rent submissions stay
sequential and use the existing source/channel locks. The runner rechecks each
due target after acquiring its channel, so a renewal confirmed during the wait
does not trigger a redundant submission.

Reports distinguish `moreDeployments`, `partialPipelines`, and `budgetExhausted`;
`truncated` is true if any apply or shared inventory has more targets in its cycle.
`sharedScan` reports total shared targets and the next offset. `scans` contains
deployment ID, total unique instance targets, and the next offset. One shared
**20-second budget bounds RPC waits, channel acquisition and finality polling**.
A callback acquired after that deadline fails before signing. Fee reservations
and writes recording confirmed results finish normally, so this is not a strict
end-to-end HTTP timeout. An RPC wait timeout does not cancel an already submitted
transaction. Existing SDK transport timeouts still apply to outstanding requests.

Reports use `pending` for an attempted send without known finality and retain its
public hash and declared fee, with a `CONTRACT_STORAGE_RENT_PENDING` audit. The
source barrier remains until confirmation or verified expiry. A later healthy
inventory read can establish maintenance coverage; a pending audit alone cannot.
This does not add durable source reconciliation or increase submission concurrency
([#202](https://github.com/webnxt-2030/pinkraft/issues/202)).

Before enabling paid maintenance, schedule repeated inventory ticks and verify
coverage completes comfortably inside the extension threshold. With full batches,
an ideal scan takes approximately `ceil(deployments / 25) × ceil(largest pipeline
target count / 10) × cadence`; time-budget exhaustion, paid work, failures and DB
latency can increase it. See the [local before/after rehearsal](ttl-release-rehearsal.md#local-throughput-and-time-budget-improvement--5-october-2026).
The model is not a supported-capacity guarantee.

There is no automatic scheduler registration. Deploy the migration first, install
the authenticated recurring call, observe complete dry-run coverage and capped TESTNET paid-smoke fees, then
explicitly enable paid maintenance. Disabling the flag returns to inventory mode.
A future retirement signal is needed to stop paying rent for obsolete deployments.

## Restoration and unknown finality

A missing `getLedgerEntries` key is unknown, not proof of archival. Background
maintenance reports it and does not spend a fee on speculative restoration. If an
RPC returns an entry with an observed expired live-until ledger, maintenance can
simulate a restore for that exact key, confirm success, and reread it. It never
reconstructs state from a graph.

Relayer contract invocations retain the SDK's automatic restoration data. Where a
simulation returns a legacy `restorePreamble`, the builder sends at most one
separate restore transaction under the channel lock, capped by the same fee
setting. Only confirmed success permits rebuilding with a fresh source sequence,
fresh simulation, and fresh channel authorization. Due dates and release-side
conditions are checked again. A second restore request fails safely; no payment
submission is retried by this mechanism.

Rent submissions record their hash before sending. Unknown transport/finality
leaves the lane blocked until the hash is final or a verified closed-ledger time
passes the signed envelope's maximum time. The source-lane barrier also protects
other callers of the shared relayer lock. This tracking is process-local: restart
and multiple replicas still need durable signing coordination (#202). Keep the
existing single-process deployment constraint.

Instance/code inventory does not enumerate separate persistent or temporary
contract-data keys, including allowance state and mutable roster entries. Those
remain governed by the contracts/token and invocation restoration. Temporary data
cannot be restored.

## Validation and rollout limits

Rust tests cover every changed mutation at threshold minus one, threshold, and
threshold plus one, and confirm getters/failed calls leave TTL unchanged. Native
registration tests instance TTL; independent WASM expiry needs chain integration.
Node tests cover snapshot validation, actual historical code discovery, rotation,
fee limits, secret guard, explicit restore rebuilding, automatic restore-list
preservation through the real SDK, and unknown-finality barriers.

No shared hashes were changed and no paid cron was enabled by implementation.
The integration checks below verify downstream execution, real expired-state
restoration, and paid cron signing lanes. Public TESTNET archival
rehearsal and production rollout capacity/budget remain release checks; mocked
RPC tests do not prove them.

Isolated TESTNET fixtures completed 12 successful transactions for Subscription v7
and Webhook v2: upload, deployment, trigger execution/charge, and separate instance
and actual-code extensions to 600,000 ledgers. Public evidence is in
[ttl-maintenance-testnet.json](evidence/ttl-maintenance-testnet.json). The RPC
transaction-result `feeCharged` values (already net of resource-fee refunds) for
code extensions were 221,949,455 stroops
(Webhook) and 347,975,490 stroops (Subscription), substantially above the default
maintenance cap. Subscription's instance extension also exceeded that cap. These
are fixture/network observations, not production estimates; choose a measured
rollout budget explicitly. Fixtures did not run the new cron or have downstream
Pay/Hold contracts, and did not exercise expired restoration or funded channels.

The real inventory runner was also verified against isolated PostgreSQL and the
public TESTNET RPC: it discovered both fixtures and their exact historical WASM
hashes, deduplicated duplicate snapshot bindings, persisted scan rotation, and
submitted zero transactions. Fixture rows were removed and prior scan state
restored. See [ttl-inventory-testnet.json](evidence/ttl-inventory-testnet.json). The
HTTP secret/lease wrapper is unit-tested; paid background maintenance remains
unexercised by this read-only smoke.

### Complete forwarding rehearsal

Public TESTNET confirmed ten transactions through Webhook v2 → Pay v4 and
Subscription v7 → Split v4. Webhook escrow delivered exactly 10,000,000 stroops;
the subscription delivered exactly 6,000,000/4,000,000 stroops to its 60/40
recipients. All four pipeline contract balances ended at zero. The charge
consumed exactly 10,000,000 of a 20,000,000-stroop allowance and advanced the
schedule by one 3,600-second interval. Premature charging and forged downstream
parent addresses were rejected. Actual escrow, pay, charge, and payout events
matched the deployed addresses.

See [ttl-forwarding-testnet.json](evidence/ttl-forwarding-testnet.json). These
fixtures used the source-built release WASM and direct SDK simulation, assembly,
and relayer-source signing with disposable Friendbot-funded accounts. They
verify downstream Pay/Split execution; they do not exercise the factory, browser
wallet, Hold, funded channels, or archived state. No shared configuration or
template hashes changed.

### Expired-state recovery and paid maintenance

An isolated official Stellar Quickstart network ran real Core/RPC at protocol 26
with a 180-ledger minimum persistent TTL. Application thresholds, fee checks,
authorization, and transaction helpers were unchanged. Local HTTPS used a
disposable trusted certificate, preserving the application's HTTPS requirement.

A historical Webhook v1 → Pay v4 pipeline received 10,000,000 stroops in escrow.
Both contract instances and both actual WASM entries expired at ledgers 657–660.
At ledger 757 the RPC reported zero remaining live-until values, and real
invocation simulation declared four automatic restoration indexes. The actual
application `submitWebhookExecuteTx`/`buildRelayerTx` source lane confirmed one
payment at ledger 759. Its metadata contained restored entries for both contract
instances and both code hashes. Stored admin, asset, recipient, parent, next
steps, and version values matched the original configuration. The recipient
received exactly 10,000,000 stroops, both contracts ended at zero, and a later
empty-escrow invocation was rejected without submitting another payment. Actual
transfer/pay/escrow events matched these results.

The envelope declared 69,154,031 stroops; an explicit fee event refunded
9,013,350, giving a net charge of 60,140,681 stroops. Evidence is in
[ttl-expired-recovery-local.json](evidence/ttl-expired-recovery-local.json). This
verifies genuine ledger expiry and restoration. The first case did not query Core
physical archival state. RPC reads can return archived durable values too, so
response presence alone cannot distinguish live storage from the hot archive.
The separate legacy `restorePreamble` branch remains automated-test coverage.

The actual paid cron HTTP handler also ran against isolated PostgreSQL, Redis,
and that real local RPC. Missing/wrong secrets returned 403; an already-held
lease returned the zero-work lease response; successful ticks persisted shared
inventory rotation. Each of three signing configurations rejected a
100-stroop cap without submitting a transaction, then confirmed a genuine due
WASM extension with a sufficient cap: channels disabled, a funded channel, and
configured but unfunded channels falling back to the relayer. Transaction
metadata and account history verified the expected fee payer, refunds, and
absence of a rejected-cap submission. Net charges were 43,587,296 / 43,585,901 /
43,586,860 stroops respectively.

See [ttl-paid-cron-local.json](evidence/ttl-paid-cron-local.json). The route was
exposed through a localhost Node HTTP adapter calling the actual handler; this
check did not boot Next middleware or prove scheduler registration. The lease
check used a connected Redis client; the existing disconnected-Redis behavior
remains unguarded as documented. Unique fixture WASM custom sections prevented
older long-lived uploads from obscuring genuinely due entries. These local fees
are observations, not a production budget. Shared databases, deployed template
hashes, production configuration, and mainnet were untouched. Disposable signing
keys, private harness files, and local services were removed after verification.

The stronger recovery case redeposited a separate 10,000,000-stroop escrow
obligation into that historical pipeline and configured the official minimum
valid eviction scan level, **1**, through the local network's real settings
upgrade. Both the Webhook instance and its actual code expired at ledger 1,236.
Ledger-close metadata explicitly listed both keys in `evictedKeys` at ledger
1,237, proving physical eviction from live storage. Core's `getledgerentry`
query server then returned `state: "archived"` for both at ledger 1,260. The actual application then used a funded derived relayer
channel, signed the relayer authorization entries, preserved automatic
restoration through its authorized simulation, and confirmed a single payment
at ledger 1,286. Transaction metadata restored both entries; Core marked both
`live` afterwards. The original Webhook configuration survived, its recipient
received exactly the newly deposited 10,000,000 stroops, and Webhook/Pay ended
at zero. A subsequent empty escrow request was rejected.

[ttl-archived-recovery-local.json](evidence/ttl-archived-recovery-local.json)
records the actual ledger-close eviction keys, Core before/after states,
restoration metadata, original storage
assertions, actual channel transaction source, balances, and events. Its
296,538-stroop declared fee included an explicit 46,309-stroop refund, giving
a 250,229-stroop net fee. The much smaller fee than the first expiry case reflects
its already-live downstream Pay and Pay code; these are different footprints,
not a comparison of signing-lane efficiency. This completes physical hot-archive
recovery on the isolated chain, including the actual funded-channel invocation
path. Public TESTNET uses different ledger/network limits, so these fixtures
do not select a production budget.

## Deployed release measurements

The [#804 rehearsal report](ttl-release-rehearsal.md) records actual deployed
inventory coverage, public TESTNET instance restoration through funded channels
and unfunded-channel fallback, fee/refund reconciliation, held-Redis-lease blocking,
and verified disable-to-inventory rollback in `hackathon-testing`. It also lists
the remaining release checks and explains why the default fee cap cannot cover
all observed extensions. Paid maintenance remains disabled; the measured fees do
not establish a production budget.

The user subsequently approved a temporary 50-XLM maintenance transaction cap
for the TESTNET rehearsal. Only the cap changed in `hackathon-testing`; the same
application commit was redeployed and the actual HTTP route still returned
inventory-only behavior with zero submissions. The user also approved a 150-XLM
total rehearsal spending ceiling; enforcement remains outstanding before paid
runs. A fresh read found none of the 25 recorded code
entries due at the unchanged threshold. See
[cap-increase evidence](evidence/ttl-cap-increase-hackathon-testing.json) and the
rehearsal report for the observed lifetimes and outstanding release decisions.
