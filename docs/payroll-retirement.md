# Payroll retirement — #1144

Payroll creation, management, signing preparation, automation and API/SDK capability
are discontinued. Ordinary subscriptions, scheduled payments, Pay and Split remain
supported. See the compatibility exception in [the release policy](releasing.md).
Runtime retirement preserves historical payroll storage, including deployed flows,
rosters, financial records and audits. It does not authorize destructive cleanup.

## Corrective migration disposition — #1146

The original `20261029150000_retire_payroll` migration assumed that payroll had no
deployed or financial evidence. Before staging promotion, acceptance testing created
a real TESTNET payroll pipeline compiled to Subscription plus Splitter. Cancelling
that pipeline and revoking its allowance did not remove its deployment or roster.
The original migration would reject it, and dropping `TemplateKind.PAYROLL` would
also prevent preserving its current flow type.

The maintainer requested a preservation fix before promotion. This is a narrow,
reviewed exception to the normal rule against editing merged migrations: the
retirement file is corrected for targets where it has **not run**, and a separate
forward migration supports targets that completed the original empty cleanup.
Earlier migrations remain unchanged. Do not rewrite migration checksums, mark a
failed migration applied, or rerun an applied migration to bypass its guards.

| Retirement SQL version | SHA-256                                                            |
| ---------------------- | ------------------------------------------------------------------ |
| Original empty cleanup | `241106af4be5cb6e787610ae8c2672c435a714fecb84b3dbd977227a4be1a949` |
| Corrected preservation | `5bd9e33ae0805489bae9b6fdb3ef6e8db878a1eae63529379016b8741daa19b1` |

A read-only check of staging at **2026-10-29 16:16 UTC** found no retirement
migration entry, successful or failed. The preceding dev-mode, off-ramp and stored-file
migrations were complete. This establishes applicability for that target and time;
it is not an inventory of other environments or permission to change an archive.
Recheck each intended target immediately before cutover.

### Targets where retirement has not run

The corrected migration locks affected tables and preserves their rows. It performs
no deletion, enum cast, snapshot rewrite or fabricated lifecycle transition. The
previously reviewed undeployed draft is also retained; its cleanup is deferred.

One deployed TESTNET fixture has an explicitly reviewed disposition. Its flow and
deployment fingerprints, two roster rows, three payroll audit records, and the
original deployment/allowance/cancellation transaction hashes and ledgers are bound
in the migration. All three signed and service transactions must remain successful
and their work complete. Independent official TESTNET reads at ledger **5453405**
confirmed cancellation, zero source allowance and zero native balances in both
pipeline contracts. The deployment remains `ACTIVE` and `MANUAL`; it is not
reclassified as an ordinary subscription or marked retired to make migration pass.

These findings apply to the exact reviewed intent and native asset, not arbitrary
payroll obligations or independent future contract use. Repeat the chain checks
and compare the locked fingerprints during rollout. New or changed payroll
records, missing reviewed history, pending/null/unknown transaction outcomes,
open/blocked work, unresolved wallet intents, and release or claim obligations
stop the migration. Expiry and elapsed time never prove financial finality.

### Targets that completed the original cleanup

`20261030000000_preserve_payroll_history` retains the recorded original checksum.
It restores the historical enum and empty table definitions, including their
indexes and foreign keys; it does not manufacture or repopulate history. The
corrected path keeps existing rows and schema intact. Prisma describes the retained
`Employee`, `PayrollRun` and `PayrollPayout` tables with `@@ignore`, preserving the
schema without generating active payroll CRUD delegates.

A recorded retirement entry must have a recognized checksum and a completed,
non-rolled-back outcome. A failed, partial or unknown entry requires a reviewed
recovery plan before proceeding. The forward migration cannot rescue an earlier
retirement abort. Never use `migrate resolve` or edit `_prisma_migrations` as an
implicit repair.

Prisma shadow-schema replay may omit migration-journal metadata. The forward SQL
permits that replay only when the three historical tables and `PAYROLL` enum are
already present, then applies idempotent schema DDL without changing their data.
That presence check is not a general schema-integrity attestation. Real Prisma
replay and schema-diff tests cover convergence with the declared historical schema;
metadata-free partial layouts are not a supported deployment path. Deploy through
the normal migration runner and inspect real target history first.

## Runtime refusal and historical access

Schema, validation and compilation reject retired payroll instructions before
stripping unknown fields. Preparation, submission, recovery and API execution also
inspect recorded flow type and graph/parameter/pipeline snapshots. Retaining a
historical enum does not register a deployable template or expose its WASM hash.

Ordinary subscription scheduling excludes historical payroll flow identities before
its bounded selection and rechecks recorded instructions before admission. TTL
maintenance excludes payroll templates and deployments without disabling shared
Subscription or Splitter artifacts used by ordinary flows. Historical owner detail
and event access remain available; payroll recovery is blocked rather than offering
a resumable unsigned transaction. These read paths do not authorize new signing or
payment work. The browser request-recovery storage-key spelling remains unchanged
so an unresolved local request is not hidden by a rename.

## Rollout

1. Verify candidate checks and the intended database/network. Hold traffic and relevant
   schedulers, drain incompatible writers, preserve a controlled backup, and capture
   a fresh inventory and individual financial-history baseline. Do not apply current
   migrations to the retained archive.
2. Inspect migration history and follow the applicable path above. Recheck the exact
   fixture disposition, cancellation, allowance, balances and durable obligations.
   An unexpected target needs separate review; do not expand fingerprints, delete
   evidence, reclassify graphs or manufacture terminal statuses during deployment.
3. Apply the guarded migrations and start the matching application on every replica.
   Verify the exact revision, migration result, service health and old-instance
   removal. On any guard or migration failure, stop and inspect without clearing it.
4. Remove obsolete externally hosted payroll scheduling and payroll-only settings/hash
   variables through the approved operational scope. Preserve shared relayer/channel
   credentials, cron secrets and ordinary subscription scheduling. Missing observed
   requests alone do not prove that an external registration was removed.
5. Verify retired-input and route refusal, blocked recovery, historical reads and
   preserved financial identities, outcomes, ledgers, events, audit and idempotency
   evidence. Run the scoped ordinary Subscription/Pay/Split regression on the actual
   promoted revision, retaining original identities and any uncertainty.

Source removal does not cancel on-chain contracts, revoke authorities or recover
balances. No replacement WASM or shared-contract ABI change is required. Keep old
payroll-capable writers fenced and use a reviewed forward fix if rollout fails;
restored historical storage does not authorize restarting retired payroll work.
Source changes and local checks do not themselves deploy, migrate a hosted database,
remove external scheduling or complete post-promotion acceptance.
