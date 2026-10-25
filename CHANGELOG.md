# Changelog

Noteworthy Paiflow app changes are recorded here. Version selection and release
steps are defined in [docs/releasing.md](docs/releasing.md).

## [Unreleased]

### Changed

- Add 20-entry pagination to the admin audit log, display timestamps in the admin’s browser timezone with UTC available on hover, and fix skipped events between pages (#1102).

- Reorganize Developer API around a compact token list, expandable details, dedicated creation panel and Quickstart. Search eligible deployments across pages while preserving explicit selections and one-time token reveal protections. Add the flow-name index migration; OpenAPI revision 1.2.0 documents the optional owner-session deployment search parameter.

### Security

- Update jsdom's transitive `undici` dependency to 8.12.3 to fix EventSource parser resource exhaustion and mixed-case Subresource Integrity verification ([GHSA-4qv8-2p9j-2685](https://github.com/advisories/GHSA-4qv8-2p9j-2685), [GHSA-f72v-6w45-q472](https://github.com/advisories/GHSA-f72v-6w45-q472)).

- Upgrade Zod's runtime collection parser and its form resolver to address oversized constrained-collection resource exhaustion, preserving existing identifier, integer, default and form validation behavior ([GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)).

- Update the Rust contract workspace's transitive `serde_with` and `serde_with_macros` dependencies to 3.21.0 to fix the KeyValueMap serialization panic ([GHSA-7gcf-g7xr-8hxj](https://github.com/advisories/GHSA-7gcf-g7xr-8hxj)).

### Fixed

- Reconcile develop deployment preparation/resumption with Lantern integration signing guards: retain unknown hashes, resume only proven-safe original preparations, and retry explicitly unaccepted submissions using identical in-memory signed bytes (#1106).

- Retry an initial automatic Hold probe read failure after one minute while retaining longer backoff for repeated failures, contract reverts and submission/finality errors (#1076).

- Check recent deployment attempts on each ordinary minute reconciliation tick instead of allowing missing RPC reads to grow into multi-minute confirmation backoff; preserve original-hash recovery and long-term unresolved history (#1079).

- Reconcile durable funding and service transaction finality in the background after the browser leaves, including completed submission work and existing confirmed signed transactions; retain unknown outcomes and original hashes with bounded fair retries (#1097).

- Keep flows whose deployments have all retired out of the default dashboard, with paginated access to retained definitions in Retired flows and clearer counts for the displayed results (#1092).

- Return a state conflict for a verified already-active Subscription reactivation during wallet preparation, while retaining upstream classification for unproven or unrelated failures (#1078).

- Reconcile Subscription billing history from confirmed charge-event ledger times, including cancelled subscriptions and retained events behind the cursor; fence stale schedule refreshes against newer configuration, cancellation and retirement observations (#1077).

- Preserve Schedule vested entitlement when pause/resume crosses its fixed window; keep duplicate controls idempotent and reject inconsistent accounting before claims or retrieval. Streamer artifact version 6 requires separate activation and does not repair existing instances (#1075).

- Update vulnerable runtime and test dependencies to restore the CI audit gate without adding exceptions. The wallet SDK's TOML parser now rejects integers that cannot be represented safely instead of returning rounded metadata.

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

- Showcase the first JRU and NVC Aklan hackathons on the marketing homepage, with an event hub, photo galleries, JRU winning projects and repository links, and shared builder resources (#1090).

- Consolidate Windows setup into one guide and PDF following one path: set up the Paiflow starter, then Engr with Kimi.

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

- Enable the pinned Lantern desktop module in the Testnet wallet picker, with
  synchronous account/network/revocation invalidation, sign-only validation and
  controlled recovery errors. Mobile and mainnet Lantern remain unavailable;
  real-extension joint acceptance is still pending (#1001).

- Persist the prepared transaction hash before wallet signing for deploys, triggers,
  allowance approvals and shared contract calls. Preserve unknown signing outcomes
  across reloads, release only matching explicit cancellations, and recheck account
  and network before a single submission (#1065).

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
- Link the Windows Setup Guide from the Paiflow Guide and Iloilo primer, clarify
  its companion PDF role and current Iloilo scope, and align API/AI payment
  guidance with shared RPC deadlines and original-transaction recovery.

- Rename the Web3 Iloilo participant guide to an event primer matching Aklan's section structure, using Iloilo's updated event dates, agenda and meeting links; remove the additional mechanics and onboarding subsections and regenerate the PDF.

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

- Deterministic unsigned TESTNET envelope samples for Lantern scan-fixture
  preparation, with synthetic-state limits and builder/decoder verification (#1003).

- Prepare an experimental Lantern desktop adapter with fake-provider tests and
  an explicitly unavailable picker entry pending upstream provider verification
  and real-extension acceptance (#1001).
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
