# Permanent deployment retirement

Issue [#864](https://github.com/webnxt-2030/pinkraft/issues/864).

SPEC §1.2 describes a live Soroban contract and a live event feed. Retirement
permanently ends Paiflow-managed service; contract and block semantics remain
unchanged. It does not delete contracts, recover on-chain balances, revoke
permissions, or stop external use. Remaining funds can require direct contract
interaction. There is no restore, cancellation, reactivation, or contract-recovery
feature.

## Owner actions

The dashboard can permanently delete a flow only if it has **no deployment at
all**, including retired deployments. `DELETE /api/flows/:id` requires
`{"confirmation":"Permanently delete flow"}`. The existing database foreign-key
restriction is the final guard against concurrent deployment creation.

The dashboard's default **Current flows** view keeps drafts and flows with any
ACTIVE or RETIRING deployment visible. A flow with at least one deployment, all
of them RETIRED, appears only in **Retired flows**. Both views paginate retained
definitions; opening a definition does not restore deployment access or service.
This classification is computed from deployment state, with no archive mutation
or history deletion.

The deployment page offers **Permanently retire deployment**. The owner must
acknowledge irreversibility and their continuing on-chain responsibility.
`POST /api/deployments/:id/retirement` requires:

```json
{
  "confirmation": "Permanently retire deployment",
  "irreversible": true,
  "onChainResponsibility": true
}
```

Owner-scoped `GET /api/deployments/:id/retirement` reports settlement progress.
Sandbox owners may use these actions on their own flows/deployments; the existing
sandbox template restrictions remain in force. Partner and dev tokens cannot
request retirement or read retirement progress.

## Lifecycle and coordination

`Deployment.serviceState` is independent of deployment transaction status:
`ACTIVE → RETIRING → RETIRED`. A database trigger forbids reversing either
transition. Deployment rows, contract references, payment/audit history and
idempotency records are retained. This is the narrow exception to CLAUDE §9's
no-soft-delete convention.

Admission and retirement lock the same deployment row in short PostgreSQL
transactions. Each admitted operation gets an OPEN `DeploymentWork` record.
RPC/Horizon submissions persist their hash in `ServiceTransaction` **before**
sending bytes, under that same lock. Submission rechecks the lifecycle and work
record, including for already-loaded batches. Settlement submissions are the
only allowed submissions during RETIRING. Completed transaction-bearing work is
retained; completed work with no transaction or opaque external intent is
removed. A crashed OPEN record is never automatically treated as settled.

Off-ramp settlement admissions are bound to a payout job. Retries cannot overlap
an unresolved admission, pending transaction, or successful transfer whose job
checkpoint was not persisted. Other jobs can still drain independently. Legacy
RUNNING jobs without job-bound admission history also require verified recovery;
the absence of a transaction record does not prove no transfer was submitted.

Requesting retirement immediately closes new service work, revokes deployment
API tokens, disables future charges, and cancels unclaimed streaming milestones.
Claimed operations, submitted hashes, and obligated fiat payouts/refunds must
finish or be reconciled. The normal event/charge/release/claim/TTL selectors
exclude retiring/retired deployments before taking a batch. Obligated off-ramp
jobs can drain during RETIRING. Shared factory/template TTL maintenance continues.
Existing SSE subscriptions close on the retirement signal and also check the
stored lifecycle before delivery and at heartbeat, so lost Redis signals cannot
preserve access indefinitely.

The ledger cutoff is fixed once pre-admitted work finishes and its known hashes
reach finality. Retirement then reconciles all pipeline events through that fixed
ledger. Cash-out job creation is awaited and deduplicated by originating event;
coverage cannot advance past an obligation that failed to persist. Replayed
legacy events with an ambiguous, unlinked payout block for verified linkage
instead of creating a second payout. A bounded stored-event pass also recovers
pre-cutoff payroll cash-outs, linking exact payroll transaction matches to
existing jobs before creating missing obligations. Missing recovery data or
ambiguous linkage blocks completion. Post-cutoff
external activity does not extend the drain. Future schedules and nonzero
contract balances alone do not block retirement.

`cron/reconcile-transactions` projects PENDING `ServiceTransaction` finality for
ACTIVE deployments on the configured network independently of browser polling
and signed-transaction analytics. The separate queue includes DONE submission
work and can replay a retained signed SUCCESS/ONCHAIN_FAILED outcome with a
positive ledger. Otherwise it reads the original exact hash through its recorded
RPC or Horizon transport. Each read has a cancellable deadline of at most three
seconds within a four-second pass, with at most 50 due rows selected before
processing. Durable admission rechecks lifecycle after selection; a shared hash
only updates admitted deployment participants. No new submission, deployment
setup, completion of original work, event-cutoff change or service reactivation happens in
this projection. RETIRING finality stays with the settlement path below.

Existing pending rows become due when the migration applies. A claim reserves
its retry before reading, so unknown old hashes rotate behind other due work.
For the first 15 minutes retries wait 30 seconds, then at most 60 seconds; older
unknown hashes back off exponentially to at most 15 minutes. Provider absence,
NOT_FOUND, read timeout, age and queue rejection never become terminal proof.
Records remain PENDING and retryable without an age-based terminal cutoff.

The scoped healthy-provider acceptance target is projection within two ordinary
eligible reconciliation ticks after ledger finality, without owner status
polling. This is a test target, not a production SLA: batches, provider outages,
backoff, scheduler availability and the cron's other stages affect eligibility
and observed timing. This pass adds at most four seconds of provider work to the
existing multi-stage cron; it does not establish a whole-route latency bound.

`cron/reconcile-transactions` also runs bounded, oldest-checked-first retirement
reconciliation. Unknown finality, running claims, failed refunds, unresolved
provider deposits, cash-out dead letters and archival event gaps stay visible as
specific blockers. Neither an elapsed timeout nor FAILED/CANCELLED business
status proves a payment settled. A confirmed full refund stamps a separate
`settlementResolvedAt` field. RETIRED is written under the admission lock only
when coverage and all settlement obligations are verified.

## Verified operator reconciliation

`POST /api/admin/deployments/:id/settlement` requires an ADMIN session and is
rate-limited and audited. It accepts a specific record and meaningful recovery
evidence, **not** a force-retirement instruction. Never enter credentials, raw
provider responses, signed XDR, or other secrets as evidence; use an internal
incident/recovery reference and the public transaction hashes where applicable.

Before verifying **transaction**, fence active workers and independently obtain
its exact SUCCESS/FAILED result and ledger from trusted ledger/archive evidence.
Use `kind: "transaction"`, `txHash`, `outcome`, `ledger`, and the same
confirmation/evidence fields. NOT_FOUND, timeout, or absence is insufficient.
A successful deployment must already have its verified contract reference.
This resolves finality only; outstanding payouts/refunds remain blockers.

When a crashed worker has both OPEN work and PENDING transactions, first stop
its process and attest `kind: "fence-work"`, its work UUID, meaningful evidence,
and `confirmation: "Verified worker stopped"`. This changes OPEN to BLOCKED and
prevents any later submission by that admission. It does not mark work completed,
resolve transactions, or release payout obligations. Next verify each exact
transaction outcome, then verify **work** completion, and finally reconcile any
remaining payout/refund. Fencing is recorded in the audit log and remains in place
even if a stale callback exits. A fencing attestation is insufficient evidence
that any money movement settled.

Before verifying **work**, establish that its worker/process cannot continue and
that no external payment or submitted transaction remains unresolved. A pending
transaction record cannot be cleared by this route. The work is fenced once
verified so a stale continuation cannot submit. Example:

```json
{
  "kind": "work",
  "id": "<work UUID>",
  "confirmation": "Verified no remaining obligation",
  "evidence": "Incident reference: worker fenced; external payment reconciled"
}
```

Before verifying **streamer**, fence the worker and verify that its submitted
claim finalized, or that no claim/payment was submitted. Supply `kind: "streamer"`,
the running claim UUID, `outcome: "CLAIMED"` or `"SKIPPED"`, and the same
confirmation/evidence. OPEN workers and pending transactions prevent this action.
It never schedules another milestone.

Before verifying **offramp**, reconcile the provider deposit/trade/withdrawal and
verify that the full obligated payout or refund completed. FAILED or CANCELLED
alone is insufficient. Supply `kind: "offramp"`, the job UUID and the same
confirmation/evidence fields. A crashed RUNNING job may be resolved only after
its worker/process is fenced,
all OPEN/BLOCKED admissions are verified, and transaction finality is known.
The attestation records the fully completed payout/refund and changes RUNNING
to CANCELLED so the cron cannot restart it. An expired lease alone is not proof.

Before verifying an **events** retention gap, read archived events through the
exact stored cutoff and persist every missing committed payout/job/dead-letter
obligation. Supply `kind: "events"`, `cutoffLedger` matching the stored boundary,
and the same confirmation/evidence fields. This is an operator attestation of
completed archival reconciliation, not permission to abandon missed payments.

After verification, the next reconciliation pass independently checks all other
blockers. It does not revive service. Transaction hashes absent from the available
RPC history remain blocked until finality can be verified; NOT_FOUND is never
converted to settlement.

## Verification and metrics

Use the existing cron response counts, event-scan outcomes, TTL summaries and SSE
subscription counts to compare before/after retirement. Retired deployments must
consume no deployment-specific batch slots or recurring RPC work. Reductions in
requests are observable; monetary savings depend on provider billing. Deployment
requires the retirement migration before the new application code starts. The
migration does not retire existing deployments automatically.

Gap tracking preserves gaps detected by lifecycle-aware code. It cannot recover
gaps forgotten by earlier versions after their cursors advanced. Before retiring
a deployment with a known historical gap, operators must reconcile archived
evidence and persist its committed obligations; an already advanced cursor alone
does not establish coverage of that lost history.

Rollout must drain old-version requests/workers with traffic and schedulers held,
apply the migration, and start all replicas with lifecycle-aware code before
retirement becomes available. Do not mix workers that ignore the lifecycle with
retirement-capable replicas. After the first request, any rollback must preserve
these lifecycle guards; use a forward fix rather than restarting an older service
version that could resume retired automation.

Relayer factory submissions checkpoint the exact transaction hash and complete
prepared pipeline in the same admission transaction that records submission,
before network I/O. Recovery also checks durable deployment admissions when a
legacy worker lost the deployment-row checkpoint. A successful factory result
must recover every child reference from its returned address vector matched to
the durable parameter order, or a complete stored pipeline; a root address alone
is insufficient. Unknown finality, missing metadata, mismatched references and
multiple tracked deployment hashes block retirement. Operators must reconcile
ambiguous submissions and restore verified durable references before continuing;
never recreate addresses from the current flow graph. Fence OPEN workers before
manual transaction attestation; success attestation requires those full references.
