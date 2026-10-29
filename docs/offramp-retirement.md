# Off-ramp retirement and targeted cleanup — #1141

The maintainer discontinued fiat off-ramping and approved targeted data cleanup
on 2026-10-29, following [dev-mode removal](dev-mode-removal.md). Removed fiat
surfaces have no existing-client compatibility support. Ordinary crypto payments,
splits, subscriptions, payroll and their transaction history remain supported.

## Removed implementation

There is no fiat selector, bank/KYC editor, provider or mock integration, processing
cron, provider webhook, provider credential screen, treasury forwarding/refund helper,
retry/reset tool, off-ramp feature flag or provider setting. Cash Out source and
its deployment/hash registration are removed. The old amount-cap settings and
unused limits helper were fiat-only; crypto payments acquire no new bounds.

The remaining archival provider models, status/event readers, Cash Out decoding,
retirement blockers and special retained-fiat views are removed as well. Small
validation guards reject retired graph/compiled instructions before unknown fields
can be stripped into a different payment. Historical migrations and dated evidence
remain history, not dormant runtime support.

Payer's cash-out constructor flag and Splitter's cash-out recipient field and
forwarding branches are removed together with their TypeScript ScVal encoding.
Their version-5 artifacts have changed ABIs. The factory stays kind-agnostic.
Existing deployed instances keep their original code; local builds do not upload
or activate replacement artifacts.

## Verified live database scope

A read-only inventory on 2026-10-29 at 10:34 UTC checked the live staging database
used by `beta.app.paiflow.xyz` / `paiflow.xyz`, app revision
`f95b74b53bf70fbea471fee1543135a603980265`, pinned to TESTNET. It found:

- 431 deployment rows and 438 flows; zero financial off-ramp deployments.
- Zero off-ramp jobs, dead letters, Cash Out events, bank records, sender profiles
  or provider credentials; zero employee/payroll rows.
- Only blank `accountName`, `accountNumber` and `bankCode` strings in two saved
  flow graphs and two deployment graph snapshots. No populated bank/KYC values
  were returned or needed for the inventory.
- Two legacy template configuration rows: Cash Out and its dev variant. The
  earlier dev-mode migration already removes the dev variant before #1141 runs.

The blank-field matches include ordinary crypto history: three stored events and
two signed-transaction records with unknown recorded outcomes. Their parent flow
also has another unaffected deployment. Deleting whole flows/deployments would
unnecessarily erase or disconnect that evidence.

This inventory covers the live staging database only. The separate archived
Postgres service, other environments, provider systems and on-chain state were
not inventoried. Recheck each intended target before applying the migration.

## Targeted migration boundary

The user explicitly authorized removing obsolete blank bank fields from current
flow graphs and the corresponding deployment graph snapshots. This narrow cleanup
is an exception to snapshot preservation for those empty, nonfinancial fields only;
it is not permission to change recipients, amounts, asset identity, schedules,
pipeline addresses, constructor parameters, envelopes, hashes or finality.

The migration checks its preconditions under database locks and must fail rather
than guess when it encounters actual fiat configuration, populated or unexpected
bank/KYC metadata, Cash Out event/template use, FIAT employees, or rows in feature
storage that this inventory found empty. Completed provider records are not silently
deleted either. Empty feature tables/relations, obsolete columns/enums and the unused
Cash Out template registration can then be removed.

Blank-key cleanup is limited to the supported Pay configuration and Split recipient
positions. Matching words in labels or unrelated JSON are not a deletion selector.
Changes are audited; current Flow versions advance when their graphs change. No
flow or deployment is deleted, no fiat destination is converted to crypto, and no
transaction, event, cursor, idempotency record or unknown outcome is cleared.

If a target fails the guards, stop and inventory that target. Its financial or
personal records require a separately reviewed disposition; do not manufacture a
terminal status or blank a populated field merely to get past the migration.

## Rollout

1. Record the target revision, environment/network and a fresh SELECT-only
   inventory. Do not publish credentials, bank/KYC values or signed envelopes.
2. Hold traffic/schedulers and drain old writers before migration. Database locks
   protect its transaction, not an old replica restarted afterward. Preserve the
   database using the existing controlled backup procedure.
3. Apply the migration and start the matching new application. Verify the same
   flows/deployments, transaction/finality evidence and ordinary events remain;
   only authorized blank metadata and obsolete storage/configuration are removed.
4. Coordinate new Payer/Splitter WASM and server encoders. Upload and sync database
   hashes separately for each authorized network, checking `STELLAR_NETWORK` before
   `contracts:update-hashes`. Never activate an old hash with the new encoder.
5. Remove obsolete hosted off-ramp schedules, callback registration, settings and
   provider access after verifying they have no required use. Preserve shared cron
   secrets, relayer keys and unrelated jobs. Database cleanup does not revoke
   external provider access or disable externally callable contracts.
6. Verify retired-input/API refusal, healthy crypto behavior and revision/schema/hash
   agreement. Record outcomes and reconcile overlapping tracking under #985.

If another target has actual off-ramp obligations or deployed Cash Out pipelines,
this cleanup must not be applied until a separate plan establishes verified
settlement and how further on-chain obligations stop. Source/data deletion cannot
erase contracts or recover their balances.

## Release and rollback

Record the intentional removal and migration exception under Unreleased and follow
[the release policy](releasing.md). Retained crypto API/SDK contracts keep their
compatibility requirements; published old packages do not change retroactively.

Schema removal and changed constructor ABIs make restarting the old app an unsafe
routine rollback. Use a reviewed forward fix or recovery plan that preserves all
financial evidence. Old writers must remain fenced.

Local implementation and PR creation do not apply a hosted migration, move funds,
revoke credentials, shut down infrastructure or activate WASM. Those are separate
operations with their own target-specific verification.
