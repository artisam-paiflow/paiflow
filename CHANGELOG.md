# Changelog

Noteworthy Paiflow app changes are recorded here. Version selection and release
steps are defined in [docs/releasing.md](docs/releasing.md).

## [Unreleased]

### Changed

- Prepare the first `@paiflow/sdk@0.1.0` beta release metadata and documentation;
  publication and the release tag remain pending separate approval.

- Record the successful bounded testnet Swap rehearsal, exact USDC receipt and
  measured storage-rent fees, closing the deferred execution evidence gap (#982).

- Document bounded SDK testnet verification and explicit Swap fee, demo-token,
  scheduler and release-readiness limits, with links to the live evidence (#964).

### Added

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

- Allow anonymous Schedule state reads through middleware while retaining sandbox,
  deployment lifecycle and mutation authentication guards (#977).

- Harden SDK cancellation cleanup and JSON bounds, retain contract-address validation
  diagnostics, and remove stale build outputs before packing; record beta coverage
  and outstanding live verification (#964).

- Run the existing Node and Rust CI checks for pushes and pull requests to `testing`.

Historical releases have not been reconstructed. The existing `0.1.0` package
version does not establish a release date or deployment history.
