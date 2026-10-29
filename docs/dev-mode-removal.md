# Dev-mode removal — #1138

The maintainer decided on 2026-10-29 to remove mutable dev-mode flows entirely.
This supersedes the [2026-06-24 design](design/2026-06-24-dev-mode-mutable-flows.md).
The broader Templates/Instances proposal in #848 remains separate work.

## Removed surfaces

There is no builder Dev mode toggle, Dev values panel, deferred API-filled configuration,
mutable contract family or feature flag. New flows must satisfy ordinary recipient, amount,
schedule and bank-detail validation before deployment. Draft autosave may retain incomplete
values; removal never supplies guessed financial values.

Dedicated `dev-*` mutation routes, machine dev-payroll creation, legacy `pkdev_` credentials,
their token tooling and v1 per-payment-recipient payouts are removed. The scoped `pfd_` and
`pfk_` credential families remain supported for their documented operations. Retained payroll
management requires an authenticated owner session, with its existing sandbox restrictions;
it has no legacy dev-token fallback. Standard payment execution still uses configured recipients.
Shared native treasury deposits and refunds remain financial operations independent of dev mode.

The maintainer explicitly discontinued existing-client support for these removed surfaces.
This is an intentional breaking removal; no compatibility adapters or client deprecation
period are required by this decision. Published older SDK packages do not change retroactively.
Ordinary API compatibility policy continues to apply to unrelated operations.

## Saved-flow cleanup and historical evidence

The migration deletes dev-mode flow drafts only when they have no deployment at all. For a
deployment-linked flow, it retains the Flow row and removes dev-only settings from the current
editable graph. It preserves other current edits and lets ordinary validation flag any missing
configuration. It does not restore an old graph, redeploy contracts or change immutable deployment
snapshots, financial records, idempotency evidence or on-chain contracts.

The implementation must stop rather than silently reinterpret actual dev-mode deployment
evidence. If the migration's preconditions no longer hold, inventory and resolve the affected
records before proceeding. Unknown finality cannot be cleared by age or timeout.
Historical migrations and dated verification artifacts remain as evidence of the previous system.

Legacy credential rows are revoked and retained in the ignored `RetiredDevApiToken` evidence
model, with no generated-client authentication surface. The recorded `dev-payroll-deploy`
work-kind string may still identify a historical submitted transaction during recovery; it cannot
create or mutate a dev-mode flow. These historical references do not retain the removed feature.

## Planning inventory and rollout

A SELECT-only inventory at 2026-10-29 02:16 UTC covered the live staging/TESTNET app at
`beta.app.paiflow.xyz` and `paiflow.xyz`, revision
`f95b74b53bf70fbea471fee1543135a603980265`, using its live Postgres database.
It found 431 deployment records (366 confirmed), with zero dev-mode deployment records by either
`graphSnapshot.devMode` or the four mutable contract kinds in `pipelineSnapshot`. There is no
latest dev-mode deployment date in that database.

Two saved graphs had dev mode enabled. One had never deployed; the other had two standard
confirmed deployments. Their latest saved edit was 2026-09-24 08:52:42.664 UTC. Those observations
do not cover the archived database or another production environment, and must be rechecked before
cutover. This document records a code/migration change, not a claim that cleanup has run on a
hosted service. Deployment, infrastructure changes and on-chain artifact activation are separate
operations.

Cutover must drain old application writers before the migration and replacement app start.
The migration's locks protect its transaction, but cannot prevent an old app replica from saving
another dev graph afterward. Recheck the inventory after rollout. The old app's legacy credential
table and enum expectations are incompatible with the migrated schema, so rollback is not merely
restarting an old image; preserve the database and prepare a reviewed recovery plan.
