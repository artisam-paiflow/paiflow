# Dashboard balance pacing (#816)

The owner dashboard now runs one browser read at a time, with one coalesced follow-up.
Ordinary visible polling waits for completion, then waits 30–33 seconds. Relevant events and
confirmed actions refresh promptly when idle. Hidden pages stop timers, retaining any active
read; returning to the page joins that read. Deployment/network changes and unmount abort the
browser request and discard obsolete responses. A browser abort does not cancel server RPC work.

Transient failures and partial responses back off from five seconds to two minutes, with up to
one second of jitter. HTTP `Retry-After` is a minimum delay, including an HTTP date. Events and
visibility changes cannot shorten this deadline. A successful response resets backoff. Periodic
fallback still detects external transfers without app events.

## Server policy

The existing #566 display cache remains the sole dashboard cache: ten-second TTL, 256 identities,
five-minute history/idle retention, owner/network/provider/deployment/snapshot isolation, and shared
in-flight reads. Authentication, ownership and both existing rate limits still run before access.
Fresh payout eligibility keeps calling the uncached token reader.

Two process-local dashboard batches may run, each with two target workers: **at most four active
dashboard RPC calls**, including account lookup. Sixteen further batches may wait FIFO for at most
five seconds. Excess/expired work returns `RATE_LIMITED` with `Retry-After: 5`, or explicitly stale
history when available. The UI displays refreshing while waiting and reports overload errors.
Settled/failed/aborted queue entries are removed. These bounds cover the current single replica;
distributed admission is separate work. They do not impose a global provider limit on transaction,
event or automation work, and they do not change relayer serialization.

Each shared refresh has a 25-second waiter deadline. Its signal removes queued work and stops
launching additional targets, but currently active transport calls retain their admission slot
until both workers settle. Late completion cannot publish cache results. One invalidation follow-up
can extend the caller's total wait to two refresh deadlines. The existing RPC transport timeout
remains ten seconds per call.

Newly persisted balance-changing events invalidate before Redis publish. Replayed events do not
invalidate. Confirmed tracked transactions invalidate after the outcome transaction commits;
legacy bound tx-status confirmations, partner deposit/payout confirmations, early/automatic
releases and confirmed dev payer/splitter edits use the same invalidator. Transaction hashes
coalesce multiple events and confirmations across viewers; per-entry deduplication retains up to
256 transaction identities for five minutes. An invalidated read cannot populate the newer cache
generation. Viewers join one shared follow-up instead of bypassing the cache.

The browser and event ingester share the balance-event predicate (including retrieve and cash-out).
Release-now now triggers the browser refresh after its confirmed action. Request/response shapes
remain compatible; existing additive per-target metadata supplies underlying successful read times.
Totals from partial responses include successful targets only. Failed targets display their own
last-known values and timestamps separately, marked stale; unavailable values never become zeros.
HTTP failures keep previously displayed totals visibly stale. Successful zero/no-target responses
alone can show the empty-balance message. SPEC §3.4 remains applicable: “Amounts are stroops as
decimal strings end to end.”

## Reproducible local workload

Run `pnpm exec vitest run --config scripts/dashboard-balance-workload.config.ts`.
The [evidence](evidence/dashboard-balance-workload.json) compares two/four admitted batches, 350 ms/
three-second synthetic RPC latency, ten distinct deployments/ten viewers of one deployment, and a
one-minute provider outage during ten minutes of traffic. It uses the production browser scheduler,
cache, admission, account-reusing balance reader and integrated #486 pipeline event reader.
One event signal every six seconds targets one dashboard, with five duplicate refresh signals;
shared viewers all receive that signal. There are 100 ten-contract pipelines, eight balance targets
per dashboard, a six-worker event sweep each minute, five modeled user transactions/minute and two
modeled automation jobs/minute. External HTTP calls are forbidden.

With two batches at 350 ms, ten distinct dashboards made 316 eligible read attempts and 1,729
balance RPC calls; four attempts were overloaded. Peak dashboard RPC work was four and the queue
peaked at eight. Successful-response latency p95 was 1.75 seconds. Ten shared viewers made 1,778
eligible read attempts but only 805 balance RPC calls, with 880 cache hits and 815 joins; no
admission overload occurred. Endpoint attempts include event-triggered cache hits, so endpoint/auth
costs do not vanish when RPC demand falls.

Four batches eliminated the distinct-viewer cold overloads but doubled peak dashboard RPC work to
eight. At three-second latency, two batches produced 27 failed cold attempts and 95 partial/stale
responses; four produced 11 and 82 respectively. Shared viewers under sustained six-second
invalidations and fifteen-second balance batches never obtained a current complete generation;
all 80 answers were stale. Increasing batch admission did not fix that single-identity condition.
This supports the conservative two-batch default and explicit backpressure/staleness, **not a hard
freshness SLA**. The sixteen-entry queue bounds larger waves; the admission regressions separately
exercise queue overflow, abandonment and recovery. A five-second queue deadline trades cold-wave
retries for bounded wait and retained work.

All eight profiles drained active/queued work to zero. The modeled transaction and automation jobs
completed 45 and 18 times respectively, with five/two jobs lost to the injected outage. Event scans
reported 900 complete/100 failed at 350 ms, and 934 complete/66 failed at three seconds (including
drain); maximum cursor age at the ten-minute boundary was 60 seconds. Dashboard balance-age p95
includes preserved historical targets: 42.01 seconds for distinct dashboards at 350 ms, rising to
133.96 seconds with slow reads. These figures describe this synthetic workload only.

The eligible balance attempts model already-authorized callers; HTTP/auth/DB cost and actual 429
responses are covered by route regressions, not measured here. Prisma and RPC are mocked; event
pages are empty, so event cursor coverage is not payment delivery. User/automation jobs model three
RPC stages rather than executing financial operations or full crons. There is no provider compute
allocation, real transport, wallet, real DB, SSE, live-chain or deployed-capacity proof. Injected
outages/latency are assumptions. Live mixed-workload/rollout gates under #486/#804 remain separate.

## Validation

245 focused regressions across 19 files passed, including browser lifecycle/freshness, event replay,
committed-confirmation invalidation, cache/admission races, auth-before-cache, existing event cron
bounds and fresh payout eligibility/submission. Redis-backed payout tests used a disposable,
nonpersistent loopback service; auto-release tests used a disposable Postgres database. Both were
removed afterward. Typecheck, lint, formatting and diff
checks passed; the opt-in workload adds nine passing scenarios/artifact checks. No migration,
dependency, contract ABI, deployed configuration or live-chain action changed.
