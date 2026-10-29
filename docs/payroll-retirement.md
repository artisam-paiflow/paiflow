# Payroll retirement — #1144

Payroll is discontinued throughout the application. This intentionally removes its
builder trigger, management screens and APIs, automation cron, employee/run/payout
storage, template registration, contract build target, configuration and published
capability/SDK trigger value. No replacement payroll API or compatibility runtime
is retained. Ordinary subscriptions, scheduled payments, Pay and Split continue.
See the explicit exception in [the release policy](releasing.md).

## Guarded cleanup

The migration locks current application storage and rechecks its assumptions before
removing anything. It permits no payroll deployments in any transaction or service
state, including legacy PAYROLL contracts and Subscription pipelines whose saved
graph represents payroll. It refuses payroll employee, run or payout records and
payroll financial/work evidence. Unknown transaction finality is never treated as
settled merely because a feature is retired.

Only the reviewed undeployed draft is eligible for deletion: its opaque identity,
version and exact graph/parameter fingerprints must match. The migration aborts on
an unexpected or changed payroll draft or any deployment referencing that draft.
Targets with no payroll draft may proceed. Existing audit records remain; deletion
adds a minimal audit entry. No ordinary flow, deployed snapshot, event, transaction,
cursor, idempotency record or financial history is deleted. Names and recipient
labels containing the word “payroll” are not deletion selectors.

The retained archive is preserved. Its older schema is not a target for current
application migrations. A prior inventory is evidence for its particular target
and time, not proof about every environment or chain activity outside stored records.

## Runtime refusal

Schema, validation and compilation reject retired payroll graph and compiled
instructions before stripping unknown fields. Preparation and submission also
check pipeline and parameter snapshots. Generic deployment routes and subscription
automation refuse recorded payroll instructions; a former payroll Subscription
pipeline must never become an ordinary scheduled subscription by fallback.

The generic browser request-recovery gate retains its old storage-key spelling.
It prevents an unresolved signed transaction from being hidden by a name change;
it does not provide payroll runtime support.

## Rollout

1. Hold traffic and relevant schedulers, drain old writers, and preserve the database
   through the existing controlled backup process. Recheck the exact target and
   payroll inventory. Do not apply this migration to the retained archive.
2. Apply the guarded migration and start the matching application on every replica.
   If a guard fails, stop and inspect that target; do not erase evidence, reclassify
   a payroll graph, manufacture terminal statuses or modify the guard to bypass it.
3. Remove the obsolete externally hosted payroll cron registration and payroll-only
   settings/hash variables. Preserve shared relayer credentials/channels, cron
   secrets and the ordinary subscription scheduler. Repository removal does not
   establish that an external scheduler has stopped.
4. Verify removed routes are unavailable, retired inputs are refused, ordinary
   subscriptions and payments still work, and unrelated history/audits remain.

Source removal does not cancel deployed contracts, revoke allowances or authorities,
recover balances, or stop external contract use. If a target contains deployed
payroll or payment evidence, it needs a separately reviewed settlement/disposition
plan before cleanup. The existing [deployment retirement framework](deployment-retirement.md)
can stop managed service while preserving financial evidence; it does not perform
on-chain cancellation. No replacement WASM or shared-contract ABI change is needed
for this source retirement.

Schema removal makes restarting an older payroll-capable application unsafe. Keep
old writers fenced and use a reviewed forward fix. Local changes and validation do
not deploy, migrate a hosted database, disable a hosted schedule or change chain state.
