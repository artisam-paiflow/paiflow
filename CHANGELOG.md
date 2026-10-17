# Changelog

Noteworthy Paiflow app changes are recorded here. Version selection and release
steps are defined in [docs/releasing.md](docs/releasing.md).

## [Unreleased]

### Added

- Reproducible local app/API/packed-SDK developer-token verification, including live selection edits and financial recovery boundaries (#1034).

- Document selected-deployment developer credentials, owner-session management and safe recovery; add a two-deployment server example with separate wallet consent and packed-consumer validation (#1033).

- Unreleased Node SDK support for developer credentials across selected deployments,
  with typed, bounded deployment discovery and credential isolation ([#1032](https://github.com/webnxt-2030/pinkraft/issues/1032)).

- Self-service Developer API panel for creating, selecting deployments, inspecting and revoking multi-deployment tokens, with one-time secret reveal and read/operate permissions ([#1031](https://github.com/webnxt-2030/pinkraft/issues/1031)).

- API v1 support for selected-deployment developer credentials, read/operate permissions, scoped deployment discovery, shared limits and durable caller attribution ([#1030](https://github.com/webnxt-2030/pinkraft/issues/1030)).

- Owner-managed developer token lifecycle APIs with explicit deployment grants, immutable read/operate permissions, expiry and revocation. API v1 credential acceptance follows separately ([#1029](https://github.com/webnxt-2030/pinkraft/issues/1029)).

### Changed

- Record Lantern’s reported desktop API/build readiness, artifact and executable-fixture
  gates, error/recovery acceptance, and completed scanner-fixture handoff; keep the
  provisional adapter disabled until the real module and extension are verified (#1001).

- Permit app framing only by Lantern's exact Android and Chrome-extension origins,
  with consistent CSP protection on middleware and static responses; embedded
  authentication and signing remain unverified (#1021).

- Recover wallet deployments after an RPC timeout through authenticated owner status checks; retain pending recovery until the matching deployment is confirmed in the app. (#1000, #1003)

- Isolate shared wallet signing from deprecated payroll recovery names while retaining
  legacy deployment-request reservations; exclude payroll/off-ramp from Lantern acceptance
  and document the existing flags that block new use without stopping settlement.

- Record five expired real unsigned Testnet scan samples: factory deployment,
  deposit, Streamer top-up, one-stroop token approval, and a read-only actual-builder
  distribution simulation. Preserve public metadata and explicit remaining Lantern
  acceptance and capture-provenance limits;
  retain the five synthetic examples (#1003).

- Align alpha testing guides and PDFs with the shared wallet picker, keeping
  Freighter as the wallet for this test plan and Lantern explicitly unavailable.

- Reject a contract action's mismatched server network before asking a desktop
  wallet to sign, while retaining signed-envelope validation before submission.

- Keep new-flow controls natively disabled until hydration can handle a click,
  preventing an enabled server-rendered button from silently losing the first tap
  on a slow connection (#1003).

- Preserve unresolved payroll update requests and every returned transaction hash
  across navigation and reloads. Block replacement actions, cancel stale roster
  approvals and validate all wallet responses before dispatch.

- Report browser wallet-deployment acceptance as explicitly pending rather than
  passing after a timeout; retain active draft-builder and deployment-review
  assertions (#1003).

- Validate every deployment wallet response and persist its public deployment ID
  and transaction hash before submission. Preserve unresolved submissions across
  navigation and reloads, with status-only recovery and browser admission locks.

- Bind payment-trigger and allowance signatures to the exact approved wallet
  session and unchanged transaction. Cancel stale approvals before dispatch;
  preserve submitted hashes across view changes and reloads, and share transaction
  admission with contract controls while retaining allowance-specific reconciliation
  (#1003). Legacy unbound mobile wallet returns require reconnecting.

- Centralize mobile wallet names, icons and handoff links while preserving existing
  Freighter, LOBSTR and xBull behavior; keep Lantern gated on official metadata.

- Keep contract-action signing bound to the selected wallet connection, cancelling
  stale approvals when the deployment, network or action arguments change. Preserve
  submitted hashes across view changes and reloads until finality is known; require
  browser transaction locks and recovery storage before sending (#1003).

- Share wallet initialization between payment triggers and contract calls, preserving
  mobile pairing, wallet return and pending-transaction recovery (#397).

- Use the shared wallet picker for deployment and payroll employee updates, record
  the chosen wallet, and sign with the server-provided transaction network. Bind
  WalletConnect signing to the approved session and cancel stale view attempts.
- Align the builder's English preview to the far right of its desktop toolbar.

- Simplify deployment API access into Quickstart, Credentials and Reference tabs,
  with flow-specific examples, grouped operations and separate token history.
  Condense Developer API guidance into a server-storage reminder and expandable
  permission and access details.

- Limit developer and deployment API token last-used timestamp writes to once per
  five minutes per token, while retaining authentication checks on every request.

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

- Prepare an experimental Lantern desktop adapter with fake-provider tests and
  an explicitly unavailable picker entry pending upstream provider verification
  and real-extension acceptance (#1001).

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

- Handle static deployment-discovery route contexts and restore readable Developer API primary-button contrast, found by integrated browser/API verification (#1034).

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
