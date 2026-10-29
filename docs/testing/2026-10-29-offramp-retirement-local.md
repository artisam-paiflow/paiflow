# #1141 targeted cleanup verification — 2026-10-29

Branch `chore/1141-retire-offramp` started at freshly fetched `origin/develop`
`6259b2697096d1ba3c4648c25a3ca28379d25487`. This records local implementation checks,
not a hosted rollout. The branch was then rebased onto `00e57cf3` to retain
the separate file-storage retirement in #1142. The maintainer explicitly approved targeted removal of the
verified blank bank fields while preserving shared crypto/transaction history.

## Live read-only inventory

At 10:34 UTC, the live staging app database contained 431 deployments and 438 flows,
with zero financial off-ramp deployments, jobs, Cash Out events, bank/KYC/provider
records or employee/payroll records. Only blank account-name/number/bank-code strings
remained in two Flow graphs and two deployment graph snapshots; two retired template
configuration rows remained. No personal field values, secrets or signed envelopes
were required for this inventory. The archived database was not checked.

The blank-field records share ordinary crypto history, including unresolved recorded
transaction outcomes. The cleanup preserves that history. See
[the migration boundary](../offramp-retirement.md) for the scoped snapshot exception.

## Local checks

Node 22.23.4, PostgreSQL 16 and Redis 7 were used. Database-writing tests ran only
against task-specific disposable local services.

- Full unit/component suite: 349 files / 5,628 tests pass; three integration files /
  19 tests retain existing skips. Skips are not acceptance.
- TypeScript, lint and `git diff --check` pass.
- The full 75-migration chain applies to a fresh local database.
- 131 actual PostgreSQL migration fixtures pass and verify refusal of unexpected feature-table
  rows (including completed payouts), typed Cash Out records, financial graph and
  compiled instructions, wrong/nonblank bank values, unsupported metadata locations
  and provider-specific work markers. Successful fixtures verify blank-only cleanup,
  per-record audits, Flow versioning, arbitrary UI node IDs and preservation of
  crypto history, original envelopes/hashes, idempotency and unknown finality.
- Three real PostgreSQL employee tests pass, including row-history/tenant
  isolation and both payout-insert/roster-cleanup lock orderings. The tests verify
  waiting through `pg_blocking_pids`, not only elapsed time.
- The independent review found a positions-subtree bypass; the fix inspects
  coordinate values and rejects malformed positions while preserving arbitrary
  node-ID keys. Runtime and SQL regressions cover the reported bypass.
- The durable migration check is `tests/integration/offramp-cleanup-migration.py`.
  It requires Python 3, `psql`, and a disposable loopback PostgreSQL database with
  the first 73 migrations applied (through dev-mode removal, before #1141). Pass
  its explicit database/port/user arguments and provide the local password through
  `PGPASSWORD` when required. All fixture work is rolled back. It is separate from
  the ordinary Vitest run and must never target a shared or hosted database.
- Rust workspace tests pass (202 tests), as do format, Clippy with warnings denied
  and release WASM compilation. Targeted data cleanup changes no additional Rust
  source beyond the already checked version-5 Payer/Splitter removal.
- SDK typecheck, all 194 SDK tests and generated documentation checks pass. OpenAPI
  is semantically unchanged. Lint and audit pass under existing policy; no dependency
  or advisory exception was added.
- The current synthetic offline Lantern factory-deploy fixture matches the crypto-only
  Splitter ABI. Dated live evidence is unchanged; offline fixtures are not wallet
  or chain acceptance.

## Production build

GitHub CI passed the host production build and deployment-image smoke on initial
PR revision `fceda7b1`; subsequent revision checks are visible on PR #1143. Earlier local
attempts received `SIGKILL` during optimized Next compilation at normal settings
and with 3072 MB / 1536 MB heap limits. The earlier #1138 logs show the same behavior;
that does not establish the precise cause or substitute for candidate validation.
Required CI checks must pass for the final PR head before merge/deployment.

## Hosted boundary

No hosted rows, infrastructure, provider access, keys, wallets or contracts were
modified. No financial transaction was signed/submitted. Applying the migration,
activating new WASM/hash configuration and hosted scheduler/credential cleanup are
separate operations; follow [the rollout notes](../offramp-retirement.md).
