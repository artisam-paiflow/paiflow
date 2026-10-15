# Changelog

Noteworthy Paiflow app changes are recorded here. Version selection and release
steps are defined in [docs/releasing.md](docs/releasing.md).

## [Unreleased]

### Changed

- Centralize mobile wallet names, icons and handoff links while preserving existing
  Freighter, LOBSTR and xBull behavior; keep Lantern gated on official metadata.

- Share wallet initialization between payment triggers and contract calls, preserving
  mobile pairing, wallet return and pending-transaction recovery (#397).

- Use the shared wallet picker for deployment and payroll employee updates, record
  the chosen wallet, and sign with the server-provided transaction network. Bind
  WalletConnect signing to the approved session and cancel stale view attempts.

- Save analytics snapshots beside an explicitly selected environment file by
  default; retain `--dir` overrides and the existing fallback without `--env-file`.

- Add an optional total relayer transaction fee ceiling before envelope signing;
  configuring it also refuses automatic restoration in the invocation builder.

- Prepare the first `@paiflow/sdk@0.1.0` beta release metadata and documentation;
  publication and the release tag remain pending separate approval.

- Record the successful bounded testnet Swap rehearsal, exact USDC receipt and
  measured storage-rent fees, closing the deferred execution evidence gap (#982).

- Document bounded SDK testnet verification and explicit Swap fee, demo-token,
  scheduler and release-readiness limits, with links to the live evidence (#964).

### Added

- Deterministic unsigned TESTNET envelope samples for Lantern scan-fixture
  preparation, with synthetic-state limits and builder/decoder verification (#1003).

- Include API request totals, endpoint/method counts and deltas in analytics
  snapshots by default, with compatible API baselines and `--no-api` opt-out.

- Optional host-scoped PostHog event/account aggregates in analytics snapshots,
  retaining separate compatible baselines and publishing history atomically.

- Default snapshots to staging/testnet, EXTERNAL and PostHog enabled; add
  `--env-file` for an explicit private credential source and `--no-posthog` opt-out.

- A daily API report batch command and separate Railway cron configuration, saving
  dated report revisions with bounded refresh for late-arriving telemetry.

- Durable daily API request aggregates and a `--daily` report mode, preserving
  endpoint counts and mergeable latency statistics beyond 30-day raw retention.

- Save compatible cumulative analytics snapshots with exact integer deltas between
  runs using `pnpm analytics:snapshot` (#995).

- SDK quickstart, API migration/coverage guide and packed-package examples for
  browser-wallet payments, controls, funding, allowance, Webhooks and event recovery (#963).

- Typed SDK keyed and explicitly unkeyed webhook callbacks with isolated secrets,
  signed-authorization error redaction and token-authorized early release (#962).

- Typed SDK Subscription state, cancellation/reactivation wallet controls and
  public additive allowance consent, preserving distinct intent/status protocols (#961).

- Typed SDK Schedule state and explicit pause/resume/retrieve wallet controls,
  retaining server reconciliation and replacement evidence (#960).

- Typed SDK funding discovery, preparation, explicit signing/submission and intent
  reconciliation for Schedule and Webhook nodes, preserving wallet consent and
  uncertain transaction recovery (#959).

- Explicit SDK execute/public payment preparation, submission and legacy status,
  with optional caller signing, cancellation and preparation metadata retention (#958).

- Typed Node SDK deployment reads, bounded event pagination, public utilities,
  hosted URL helpers and public embed snapshot SSE (#957).

- Add the unreleased SDK HTTP foundation: isolated authentication, response metadata,
  typed errors and cancellation/timeouts (#956).

- Unreleased standalone Node SDK package scaffold with ESM declarations and clean-consumer artifact validation ([#955](https://github.com/webnxt-2030/pinkraft/issues/955)).

- Proposed Node SDK contract and existing-deployment API coverage ([#954](https://github.com/webnxt-2030/pinkraft/issues/954)); no package published yet.

- App, API, and future SDK release policy, with contributor and agent guidance.

### Fixed

- Reconcile the staging-only Railway configuration with the distinct live/archive
  database volumes and guard its target; infrastructure applies remain separately
  controlled (#529).

- Improve builder interval labels and field errors, and show asset restrictions and
  recipient allocations without requiring hover (#988).

- Allow anonymous Schedule state reads through middleware while retaining sandbox,
  deployment lifecycle and mutation authentication guards (#977).

- Harden SDK cancellation cleanup and JSON bounds, retain contract-address validation
  diagnostics, and remove stale build outputs before packing; record beta coverage
  and outstanding live verification (#964).

- Run the existing Node and Rust CI checks for pushes and pull requests to `testing`.

Historical releases have not been reconstructed. The existing `0.1.0` package
version does not establish a release date or deployment history.
