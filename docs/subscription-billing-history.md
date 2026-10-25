# Subscription billing metadata

`Deployment.lastChargedAt` is a projection of committed `charge` events emitted by
the Subscription or Dev Subscription in the durable `pipelineSnapshot`. It uses
the event's ledger-close time, not the cron completion time or the scheduled due
time. Catch-up charges may pay an older due period in a later ledger. An advanced
schedule, a tenant's success response, a timeout, or a missing hash alone does not
establish confirmed charge history.

The projection is independent of PLATFORM/USER/MANUAL mode and current
cancellation state. It advances only to a newer confirmed time; duplicate or
out-of-order delivery cannot regress it. Payroll is excluded even where its
pipeline contains a Subscription trigger: Payroll runs and settlement recovery
remain separate (#592).

Event ingestion retries the history checkpoint on both inserted and duplicate
rows before advancing the event cursor. A failed checkpoint therefore remains
retryable after an insert or crash. Each admitted event poll also examines at
most 100 latest matching stored charge events before making RPC calls, so an
already-advanced cursor or unavailable RPC does not prevent repair from retained
evidence. Emitter/topic filters apply before the limit; unrelated later payout,
deposit or status events cannot consume the batch. Existing indexes beginning
with deployment ID and event time support this latest-first query. Invalid or
ambiguous evidence is never promoted to charge history. Missing retained charge
evidence requires verified archival recovery; this process does not invent it.

Freshness follows successful event ingestion, rather than immediate cron return.
Normally a new charge becomes visible after the next successful admitted poll;
retained-history repair occurs at the next poll attempt even when RPC is down.
There is no fixed wall-clock guarantee during backlog, admission refusal,
database/provider failure or retention gaps. The event cron rotates attempts and
reports partial/failed scans; operators should monitor those outcomes and verify
the exact deployment's coverage. The owner relayer API reads stored metadata;
the relayer settings panel refreshes on mount/save, so reload it after a poll to
observe a change. Live acceptance must record poll success and ledger evidence,
not infer freshness from elapsed time alone.

`nextChargeAt` remains a current scheduling observation, separate from history.
Subscription cron refreshes use compare-and-set against a database-maintained
`chargeScheduleRevision` and require ACTIVE service. A narrow trigger advances
the revision for every schedule/configuration/lifecycle write, including
same-value and A→B→A writes from existing configuration, Dev, confirmation,
retirement and scheduler paths. Historical timestamp updates do not change the
revision. A stale revision-aware worker cannot restore a cleared next charge or overwrite a
newer observation; its missed compare-and-set leaves the newer state in place.
The revision fences metadata writes, not transaction authorization or the
financial submission lifecycle.

History reconciliation reuses event-poll admission. Ordinary polling excludes
retiring/retired deployments; retirement's admitted cutoff scan can reconcile
only retained events at or before its cutoff. No scheduling is revived and no
transaction is prepared, signed, submitted or replaced by history repair.
Original admitted hashes and unknown finality remain unchanged. Confirmed cron
iterations remain counted when a later catch-up attempt or schedule checkpoint
fails; that bookkeeping failure is still reported separately.

## Rollout and verification

Drain old charge workers and hold scheduler traffic, apply the migration before
starting new code, then resume with all workers on the revision-aware binary.
The trigger increments revisions for old writers but cannot make an old binary
without compare-and-set safe during mixed-version operation. No live rollout or
data repair is implied by merging this change.

Before release, apply all migrations to a disposable PostgreSQL database and run
the billing-history/cron/event regressions, including actual trigger behavior,
duplicate delivery, failed projection after insertion, stale/cancelled/retired
refreshes and cutoff handling. After authorized deployment, observe a natural
charge followed promptly by cancellation. Independently verify the exact hash,
ledger and balances; after a successful event poll, confirm the owner API's
historical charge time remains correct while MANUAL mode and cleared scheduling
stay intact. Do not trigger another charge to repair metadata.
