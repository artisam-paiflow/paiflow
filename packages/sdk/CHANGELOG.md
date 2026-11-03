# Changelog

SDK versions are independent of the app and API. Follow the repository release
[release policy](https://github.com/artisam-paiflow/paiflow/blob/sdk-js-v0.3.0/docs/releasing.md).

## [Unreleased]

## [0.3.0]

Prepared on 2026-11-03. This beta minor adds client APIs and records the approved
compatibility removals below. The preparation date is not a publication claim; see
the evolving [release record](https://github.com/artisam-paiflow/paiflow/blob/develop/docs/sdk/release-checklist.md)
for the publication date, registry availability and verification status.

### Added

- Policy-v1 execution input types, verified configuration reads, idempotent
  preparation, exact-intent signing/submission and explicit reconciliation (#1160).
  Requires compatible API revision 1.4.0 and reviewed execution artifacts.
- Private-template instance prepare/sign/submit/reconcile/history with explicit
  owned-template grants and original admission recovery (#1165), requiring
  compatible API revision 1.5.0. Live instance acceptance remains unfinished.
- Guarded Pay/Split configuration state/history and exact admin-signed
  prepare/sign/submit/reconcile workflows (#1169), requiring compatible API revision
  1.6.0 and reviewed guarded artifacts. Live mutation acceptance remains unfinished.
- Generated method/type reference, parameterized execution example and current
  receipt/history correlation for existing controls. All signing remains in the
  caller's wallet; credentials never substitute for wallet consent.

### Changed

- Accept verified mutation capability metadata while preserving execution-only
  discovery with `mutation: false` (#1168). Artifact activation and later phase
  acceptance remain separate from package availability.
- Point repository metadata and versioned documentation at the public source
  mirror. Matching SDK source and tag must exist there before publication.

### Removed

- Remove the retired `payroll` capability trigger under the approved retirement
  (#1144). Ordinary Subscription, Pay and Split integrations remain supported.
  Release documentation also stops describing retired Dev backend variants as
  supported (#1138); no SDK Dev setter removal or replacement is claimed. Existing
  npm artifacts and retained supported API v1 contracts are unchanged.

### Verification limits

- Bounded source-packed TESTNET execution passed in Campaign 2; publishing this
  candidate does not establish registry-installed execution, general topology,
  legacy public submission remediation, instance/mutation acceptance or production
  readiness. Unknown/rejected outcomes keep their original identities; there are
  no automatic financial retries or replacements.

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
