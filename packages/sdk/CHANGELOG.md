# Changelog

SDK versions are independent of the app and API. Follow the repository release
[release policy](https://github.com/webnxt-2030/pinkraft/blob/71e9326b62d18bf9366ffbf0564fdd62847c3af6/docs/releasing.md).

## [Unreleased]

## [0.2.0] - 2026-10-16

Beta release for selected-deployment developer credentials and scoped
API v1 discovery. Requires a backend implementing OpenAPI revision `1.1.0`;
SDK `0.1.0` does not include these additions. Existing deployment-token integrations,
Node `>=22.22.2 <23`, ESM/declaration exports and zero runtime dependencies remain
supported. No consumer migration is required for existing `pfk_` integrations.

### Added

- Document selected-deployment developer credentials, owner-session management and safe recovery; add a two-deployment server example with separate wallet consent and packed-consumer validation (#1033).

- Developer credentials (`pfd_`) for one Node client across explicitly selected
  deployments, alongside existing `pfk_` credentials. Typed `deployments.list`
  and bounded `deployments.pages` discover the current authorized scope (#1032).

### Security

- Redact developer credentials in error bodies, keys and response metadata;
  retain public/demo/embed/webhook bearer isolation and disabled redirects (#1032).

## [0.1.0] - 2026-10-15

First beta: targets API v1 and the explicitly documented public/Webhook routes
on Node `>=22.22.2 <23`; ESM with TypeScript declarations, no runtime dependencies
or migration requirement.

### Changed

- Record the independently verified real testnet Swap, exact USDC receipt and
  measured storage-rent fee; retain demo-token and unattended-scheduler limits (#982).

- Document bounded SDK testnet verification and explicit transaction-fee, demo-token,
  scheduler and release-readiness limits, with links to the live evidence (#964).

### Fixed

- Harden SDK cancellation cleanup and JSON bounds, retain contract-address validation
  diagnostics, and remove stale build outputs before packing; record beta coverage
  and outstanding live verification (#964).

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
