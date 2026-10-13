# Changelog

SDK versions are independent of the app and API. Follow the repository release
policy in `docs/releasing.md`; this metadata does not claim a published release.

## [Unreleased]

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

- Standalone ESM package scaffold, declarations, isolated build and clean-consumer
  artifact validation ([#955](https://github.com/webnxt-2030/pinkraft/issues/955)).

- Shared HTTP transport with explicit credential boundaries, structured errors,
  response metadata, timeouts/cancellation and built-package tests (#956).
