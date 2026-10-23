# Changelog

Noteworthy Paiflow app changes are recorded here. Version selection and release
steps are defined in [docs/releasing.md](docs/releasing.md).

## [Unreleased]

### Security

- Update the Rust contract workspace's transitive `serde_with` and `serde_with_macros` dependencies to 3.21.0 to fix the KeyValueMap serialization panic ([GHSA-7gcf-g7xr-8hxj](https://github.com/advisories/GHSA-7gcf-g7xr-8hxj)).

### Fixed

- Bound public Subscription allowance reads, approval preparation, submission eligibility and status recovery to shared interactive RPC deadlines; distinguish unavailable RPC services from absent accounts while preserving original approval hashes and uncertain finality (#1074).

- Bound guarded Schedule state, funding and control reads to one interactive RPC deadline; distinguish unavailable and malformed upstream responses while preserving controller checks and original-hash recovery.

- Reject execute amounts above the contract i128 maximum with a field-level validation error before RPC lookup or transaction preparation.

- Bound Subscription control submission checks, state reads and reconciliation to one interactive RPC deadline, and distinguish unavailable account/allowance reads from genuine missing accounts without changing transaction recovery.

- Give deployment preparation one shared 25-second network budget across funding, account lookup and simulation; distinguish unavailable RPC services from unfunded accounts and allow safe preparation retries before signing.

- Give Subscription cancellation and reactivation preparation one shared 25-second RPC budget; report source-account and simulation transport failures as upstream errors without reserving an intent when preparation fails.

- Keep deployment submissions with uncertain RPC outcomes pending under their original transaction hash, including relayer deployments; resume the original unsigned preparation after a reload when it was never accepted, and permit deliberate replacement only after proving expiry.

- Report payment source-account RPC failures as upstream errors instead of misleading unfunded-account errors; reserve funding guidance for a successful ledger read proving the account is absent.

- Give interactive payment preparation, submission and original-hash status recovery one shared 25-second RPC budget; keep background workers at their existing timeout and preserve confirmed outcomes when optional event catch-up runs out of time.

- Preserve uncertain payment submissions with original-hash recovery guidance, and catch up indexed events after successful status recovery without changing confirmed financial outcomes.

- Preserve optional parameter defaults and inline return fields in the generated SDK reference; align validation assertions with the current address guidance.

- Point SDK package repository metadata to the public source mirror for future releases.

- Preserve typed wallet destinations on Enter until contacts are deliberately navigated; make contact search reachable with Tab and return to the wallet with Shift+Tab or Escape.

### Added

- Add the October 20 Aklan hackathon primer and PDF with the event schedule, pitch deck requirements and linked Paiflow Guide; refresh the guide access code and SDK reference links.

- Complete the SDK onboarding README and generated Markdown method/type reference with CI drift checks; align OpenAPI/Postman guidance with the published beta and bounded testnet evidence (API specification correction 1.1.1).

- Reproducible local app/API/packed-SDK developer-token verification, including live selection edits and financial recovery boundaries (#1034).

- Document selected-deployment developer credentials, owner-session management and safe recovery; add a two-deployment server example with separate wallet consent and packed-consumer validation (#1033).

- Unreleased Node SDK support for developer credentials across selected deployments,
  with typed, bounded deployment discovery and credential isolation ([#1032](https://github.com/webnxt-2030/pinkraft/issues/1032)).

- Self-service Developer API panel for creating, selecting deployments, inspecting and revoking multi-deployment tokens, with one-time secret reveal and read/operate permissions ([#1031](https://github.com/webnxt-2030/pinkraft/issues/1031)).

- API v1 support for selected-deployment developer credentials, read/operate permissions, scoped deployment discovery, shared limits and durable caller attribution ([#1030](https://github.com/webnxt-2030/pinkraft/issues/1030)).

- Owner-managed developer token lifecycle APIs with explicit deployment grants, immutable read/operate permissions, expiry and revocation. API v1 credential acceptance follows separately ([#1029](https://github.com/webnxt-2030/pinkraft/issues/1029)).

### Changed

- Split Part 2 of the Paiflow Guide into the recommended starter video tutorial (2.a) and written instructions for a fresh repository (2.b), with highlighted guidance for choosing a path.

- Refresh the Paiflow Guide for the minimal SDK payment starter and regenerate the shared guide and event-primer template PDFs.

- Make the SDK the default Node integration path in hackathon resources and shared AI context, with the payment-only SDK starter as an optional example; retain Campus Snacks as a domain sample for its planned SDK migration.

- Shorten address validation messages to actionable instructions without repeating the entered address, and show builder errors in the regular UI font.

- Keep builder address fields within the settings panel while typing invalid addresses; wrap long validation messages.

- Make inline address-book saving discoverable with a labeled Save contact button, full-address review, keyboard controls, and saved-contact status; keep wallet input focus and prevent inline saves from replacing existing contact names.

- Adopt shared builder controls for Receive, Schedule, HTTP Webhook, Subscription, crypto Pay/Split, and amount/time conditions, preserving numeric clearing, precision, and validation behavior.

- Dock builder node settings over the right side, including the English preview, with a full-height scrolling form; clicking blank canvas closes settings, and AI chat shares the same space. Mobile keeps its bottom sheet.

- Align the builder's English preview to the far right of its desktop toolbar.

- Simplify deployment API access into Quickstart, Credentials and Reference tabs,
  with flow-specific examples, grouped operations and separate token history.
  Condense Developer API guidance into a server-storage reminder and expandable
  permission and access details.

- Make the Paiflow guide a two-part end-to-end walkthrough for the app and SDK,
  including Google signup, access codes, per-step videos, developer-token setup,
  SDK 0.2.0 installation, payout verification and original-transaction recovery.

- Consolidate participant PDFs into the event primer and Paiflow Guide; move the
  standalone HTTP checkout example into the API README and retire the API
  quickstart Markdown, PDF and dedicated renderer. Keep detailed SDK/API
  references on GitHub and document both supported API credential families.

- Limit developer and deployment API token last-used timestamp writes to once per
  five minutes per token, while retaining authentication checks on every request.

- Save analytics snapshots beside an explicitly selected environment file by
  default; retain `--dir` overrides and the existing fallback without `--env-file`.

- Add an optional total relayer transaction fee ceiling before envelope signing;
  configuring it also refuses automatic restoration in the invocation builder.

- Publish the first `@paiflow/sdk@0.1.0` beta under the separately approved release
  and annotated `sdk-js-v0.1.0` tag on 15 October 2026.

- Reconcile SDK installation/release status and API/hackathon verification guidance
  with the dated testnet evidence, retaining fee-blocked payout tests and environment limits.

- Record the successful bounded testnet Swap rehearsal, exact USDC receipt and
  measured storage-rent fees, closing the deferred execution evidence gap (#982).

- Document bounded SDK testnet verification and explicit Swap fee, demo-token,
  scheduler and release-readiness limits, with links to the live evidence (#964).

### Added

- A reusable hackathon event primer template and PDF, with embedded resource links
  and organiser notes for event decisions, schedule checks and documentation structure.

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
