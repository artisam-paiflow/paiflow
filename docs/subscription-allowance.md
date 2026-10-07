# Wallet-only subscription allowance approval — #790

A confirmed subscription's `/allowance/:deploymentId` page lets its configured
customer approve through their own wallet without a Paiflow account or deployment
API token. It supports `SUBSCRIPTION` and `SUBSCRIPTION_DEV`. The team still owns
configuration and Dev mutations. One deployment has one configured subscriber;
connecting another wallet does not create a subscription.

The public state and preparation route is
`/api/deployments/:id/subscription-allowance` (GET/POST). Its explicit response
contains customer consent fields only: deployment/flow label, network, actual
subscription contract and token, current subscriber, cancellation/setup state,
asset label when known and allowance. The shared snapshot helper resolves the
actual subscription root. Subscriber, asset and cancellation are read from the
deployed contract, including after Dev updates. An unconfigured subscriber gets
setup guidance; a mismatched wallet or cancelled subscription cannot prepare.
Unknown asset labels show the actual token address rather than stale graph data.

Preparation reads the current allowance and adds the requested positive i128
amount, retaining the existing bounded expiration-ledger calculation and
simulation. The server issues an HMAC intent under the existing `AUTH_SECRET`,
scoped to this deployment/network, subscriber, token, spender, cumulative amount,
full transaction hash and finite validity window. Submission at
`/subscription-allowance/submit` requires the intent and an exact matching signed
envelope. The hash binds expiration, sequence, fees, resources, authorization
entries and all operations. A real Ed25519 subscriber signature must verify on
the pinned network. Fee bumps, unrelated/extra operations and changed envelopes
are rejected before submission. The server neither holds the customer key nor
signs consent. This path supports account wallets signing with their source key;
non-master signer and smart-account consent are outside this change.

Submission rechecks the deployed configuration and reads the prepared hash first.
Confirmed/failed replays never send another transaction. Signer records and audit
metadata use the submitting session, or null for anonymous customers, with the
wallet address separately recorded; the owner is not substituted for the signer.
The intent-to-submit audit row precedes the RPC call so existing confirmation
bookkeeping can reconcile a lost response. It does not assert successful consent.

The browser stores only the hash and server intent, never a signed envelope or
key. `/subscription-allowance/status?intent=...` reconciles that exact hash, even
after the submit intent's ten-minute expiration. It reuses existing transaction
confirmation and safe allowance-event bookkeeping. While outcome is unknown,
new approval is blocked and the customer can check status or reload. A missing
transaction permits another approval only after validated ledger close time
passes the prepared transaction's maxTime, followed by another NOT_FOUND read.
Wall-clock time, unavailable RPC or malformed/undecodable ledgers cannot establish
expiration. Local storage must be available to recover after closing/reloading;
within the same mounted page the pending hash also remains in memory.

Public limits per IP/minute: 40 page/state reads, 20 preparations, 20 submissions
and 60 scoped status reads. Status also uses the existing transaction-status
limiter. They use the existing Redis-backed limiter with its per-process outage
fallback. Responses carrying state/prepared envelopes are `no-store`. Middleware
opens only this page and these three subscription endpoints. Sandbox exclusions
remain; general invoke/submit-invoke, charges, subscribe/unsubscribe, Dev mutations
and payroll retain their existing authentication boundaries. The shared payroll
page still requires a page session.

## Verification and rollout

Focused regression coverage uses synthetic wallets, contract state and RPC
responses to test both variants, changed/missing subscribers, cumulative allowance,
transaction tampering, signatures/network, replay and uncertain/expired submission.
No contract/ABI, DB schema or dependency change is required.

The installed SDK is 16.3.1. Three read-only public testnet `getLatestLedger()`
requests succeeded against protocol 29 during implementation on October 7, 2026.
An additional public latest-ledger → getLedgers read returned a matching ledger
sequence and string close time. These limited probes do not close #792 or prove
all application reads and payouts work.

Promotion/deployment and real wallet approval, scheduled charge and recipient
payout remain pending. Follow [the manual verification queue](hackathon/manual-verifications.md)
and record the deployed commit, environment, tester and public transaction evidence.
Source participant/AI guidance describes builds containing #790; external
Mechanics/AI/starter copies and the participant PDF still need reconciliation
with verified promoted behavior. Event Plan reconciliation remains on hold.

## Local validation — October 7, 2026

Typecheck, production build (39 static pages), existing migrations and synthetic
seed, formatting/diff checks, and all 3,573 tests in 244 files passed with four
workers. The dependency audit passed with one existing ignored low advisory.
The final production Chromium fixture passed with anonymous, other-team and
sandbox contexts and synthetic signed ordinary/Dev approvals. RPC is mocked for
that fixture; it provides no real wallet, scheduled charge or on-chain payout evidence.

## Repeatable local browser fixture

Use a disposable localhost PostgreSQL database named `public_allowance_*` and
apply the existing migrations. Set `DATABASE_URL`, a synthetic `AUTH_SECRET` of
at least 32 characters, and a synthetic public `STELLAR_RELAYER_ADDRESS`. Set
`PUBLIC_ALLOWANCE_LOCAL_TEST=1` and `PUBLIC_ALLOWANCE_STATE_PATH` to a temporary
JSON path, such as `/tmp/allowance-rpc-state.json`, in both app and test processes.
Build the app with the same synthetic settings, then run:

```sh
node --import ./tests/fixtures/subscription-rpc.mjs node_modules/next/dist/bin/next start -p 3390
```

In a second terminal with those fixture variables and
`PLAYWRIGHT_BASE_URL=http://localhost:3390`, run:

```sh
pnpm exec playwright test --config playwright.subscription-allowance.config.ts
```

The explicitly opted-in preload replaces SDK RPC methods only in that local
process. The test creates synthetic customer keys locally, signs prepared
transactions against that synthetic RPC, and exercises real production
HTML/RSC, middleware, API handlers and database bookkeeping in Chromium.
It covers ordinary and Dev approval, an unconfigured/changed Dev subscriber,
private-data omission, cross-deployment refusal, confirmed replay, anonymous
signer attribution, another team and sandbox exclusion. It never submits to
Stellar or performs a real wallet payout. Stop the app and dispose of the fixture
databases afterward. Do not use this preload with a live application database.
