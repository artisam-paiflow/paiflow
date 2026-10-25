# Lantern public Apps-tab support

Paiflow's public Testnet trigger and Subscription allowance pages can use Lantern's
Apps-tab postMessage signer. This restores and adapts the implementation preserved
on `lantern-staging`; it does not establish installed-device acceptance (#930/#931/#933).
Desktop external connect uses a separate top-frame `window.lantern` module.

## Transport and recovery

The [published bridge contract at `095d93f`](https://github.com/kimerran/stellar-lantern/blob/095d93f7247e530406a02d530c8f93dac5c1ea77/docs/mini-app-bridge.md)
is the baseline. Only the immediate approved Android or Chrome-extension parent
selects embedded signing. Every reply must come from that parent window and exact
origin; signing replies must echo the unique request ID. No wildcard destination
is used. The framing policy remains the exact two-parent policy from #1049.

The public flow selects the bridge before mobile prewarming, WalletConnect session
restoration, wallet selection or browser deep links. It uses `lantern:getPublicKey`
and sign-only `lantern:signXdr`; Paiflow retains preparation, validation, submission
and finality reconciliation. Mainnet and Payroll allowance are refused in this
public embedded path. Authenticated signing and embedded login remain #932.

All adapters in a frame share one request queue. Connection replies have no IDs:
an interrupted sent connection quarantines the bridge until the frame reloads, so
a late reply cannot approve another connection. Signing requires an acknowledgment
within five seconds and allows two minutes for review. Timeouts, cancellation after
signing starts, malformed responses and provider errors preserve the prepared hash
and recovery hold. Timeout guidance never authorizes another signature.

Only an error-free `lantern:signRejected` is treated as explicit user refusal and
can release its matching signing attempt. A `signRejected` carrying an error or
`txError` is a controlled failure with unresolved signing state, regardless of its
text. Provider error strings are not displayed or used to infer cancellation.
Before/after signing, account and network are re-read; the unchanged body, source,
existing signatures and connected-account signature are verified. The current
pre-sign hash/attempt protocol and separate opaque allowance intent remain intact.

## Validation and live acceptance

Harness tests use real locally assembled Soroban envelopes with mocked RPC and a
simulated parent. They cover source/origin/ID checks, serialization, acknowledgment,
errors, cancellation/late replies, identity drift, envelope/signature changes,
public-flow submission and recovery, and bypass of mobile SDK/navigation. These
tests do not claim real Android or extension acceptance.

Before joint testing under #933:

1. Coordinate the offered `pinkraft.xyz` Testnet session-app entry and exact containing
   Android/extension builds under #945/#1050. The published final-origin registration
   for `beta.app.paiflow.xyz` does not register the testing origin.
2. Verify the authorized candidate's revision, Testnet configuration, redirects,
   headers, iframe origin, same-origin APIs, persistent storage and Web Locks.
3. Agree current bounded trigger/allowance fixtures. The allowance published in #1050
   ends October 26, 2026 at 23:08:07 UTC; arrange replacement if missed. Never execute
   historical expired scan envelopes or clear pending transaction markers.
4. On actual Android and extension builds, record connect/sign/one-submit/finality,
   rejection/lock/account/network cases, reload and lost-response recovery, and
   applicable existing-wallet regressions. Keep directory `verified: false` until
   evidence supports changing it.

No deployment, financial action, upstream registration, authentication/cookie change,
Android WalletConnect enablement or final-origin promotion is part of this code change.
