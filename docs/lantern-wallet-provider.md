# Lantern desktop integration

The Testnet desktop picker now registers Lantern alongside Freighter using the
published single-file module from **v0.7.0-testnet.21**, wrapped with Paiflow's
signing and connection safeguards. This is implementation readiness, **not joint
real-extension acceptance**. Deployment and joint QA remain to be verified.
Lantern is omitted on mobile and mainnet. Android Chrome WalletConnect (#1002)
is not built upstream; Apps-tab embedding uses a separate postMessage bridge and
is documented separately in [public Apps-tab support](lantern-apps-tab.md).
Deprecated payroll and fiat off-ramp are excluded.

## Module, release and installation

[Vendor provenance and MIT license](../lib/stellar/vendor/lantern/README.md)
record the byte-preserved source, exact revision and checksum. The app stays on
Stellar Wallets Kit **1.9.5**; it does not wait for upstream SWK publication.

1. Download `lantern-extension-0.7.0.zip` from the
   [pinned release](https://github.com/kimerran/stellar-lantern/releases/tag/v0.7.0-testnet.21).
   Expected SHA-256: `7f2526bed09da0b33bfeff3bd327aa71b0cbbe454e08162d5de1695ad5ecd23a`.
2. Unzip into a folder you retain. In `chrome://extensions`, enable Developer
   mode, choose **Load unpacked**, and select that folder.
3. Confirm extension ID `iflpkjgolcbleombhldiibhojohjpnmd`, use Testnet and a
   disposable funded wallet, then open the authorized testing deployment.
   Chrome's broad website permission belongs to the extension's page bridge;
   Paiflow does not load an external Lantern script.

The published ZIP checksum, manifest version 0.7.0 and manifest-key-derived
extension ID were statically verified on 2026-10-19. The extension was **not
installed or executed** by those checks. The local icon remains the unchanged
MIT-licensed copy documented in `public/wallets/lantern-license.txt` (upstream
homepage/logo.jpg at 1156c771c04410c5fc7e5cb051af797e70918682).

## Origin and permissions

Joint desktop QA targets **https://pinkraft.xyz**, deployed from
`lantern-integration` on Testnet. Expect Lantern's **Unverified site** label there.
The final public origin is **https://beta.app.paiflow.xyz**; its deployment and
testing require a separate authorization and focused acceptance pass.
Permissions are per origin, account and network. Reconnect when changing origin;
reconcile pending transactions before switching. Sessions and browser recovery
records do not transfer across domains. No manual marker clear or blind replay.
Recheck deployed revision, server network and redirects before live QA.

## Runtime contract and safeguards

The [official reference](https://golantern.xyz/docs/reference/connect/) governs
the extension API. Paiflow requires top-frame `window.lantern.isLantern === true`,
`apiVersion: 1`, callable documented methods and
`isConnected()` returning `{isConnected: true, apiVersion: 1}`. Websites disabled
in Lantern Settings makes it unavailable. Missing/unsupported providers leave
other picker entries usable and offer the pinned install destination.

Connection calls upstream `requestAccess()`, then separately verifies
`getNetwork()`. Non-interactive reads use `getAddress()` and never regrant access.
Actual address/signature responses have no network-passphrase field; the network
is checked separately. The server's Testnet passphrase is sent explicitly with
the expected account on **every signing request**, never derived from the wallet.
`submit: true`, derivation paths, alternate submit URLs, message and auth-entry
signing are refused locally. Lantern signs only; Paiflow submits once.

SWK 1.x ignores upstream `onChange`, so our wrapper subscribes directly. Every
account/network/revoke event synchronously invalidates the grant and pending
signing generation, even if the user switches away and back. The selected surface
is pinned to that generation; a later connection cannot revive it. Before and
after signing, provider identity, current account and Testnet are rechecked.
Listeners are detached on local disconnect/provider replacement. Local disconnect
clears Paiflow's grant only; revoke site permission in Lantern Settings.
Transaction checks reject fee bumps, source mismatch, mutated transaction bodies,
dropped signatures and missing/invalid connected-account signatures. Wallet ID
`lantern` flows through existing connection tracking and audit/statistics paths.

## Errors and recovery

Provider messages/payloads never reach the UI. Kit `ext` preserves the semantic
code rather than treating every numeric `-3` alike:

| Lantern code                                         | Paiflow behavior                                                        |
| ---------------------------------------------------- | ----------------------------------------------------------------------- |
| `user_rejected` / kit `-4`                           | Cancellation; release only the matching, still-current signing attempt. |
| `not_allowed` / kit `-3`                             | Ask to connect on Testnet or enable websites in Lantern Settings.       |
| `account_mismatch` / kit `-3`                        | Reconnect the intended account.                                         |
| `network_mismatch`                                   | Switch to Testnet and reconnect.                                        |
| `invalid_request`, `unsupported`, `busy`, `internal` | Controlled request-specific failure; no automatic retry.                |
| `timeout`, `connection_lost`                         | Unknown outcome; preserve the prepared hash and recovery hold.          |

There is **no locked-wallet error**. Lantern opens its Unlock screen; closing it
returns `user_rejected`. Mainnet is refused with `not_allowed` in this release.
Upstream timeouts are 10 minutes for connect/sign and 15 seconds for other calls;
Paiflow's action admission can end earlier and still retains uncertain recovery.
A stale refusal after a lifecycle change cannot clear a pending hold.

Signing recovery (#1065/#1067) persists the prepared hash and unique attempt before
asking for a signature. Only matching explicit cancellation clears that attempt.
Unknown outcomes, malformed responses and account/network drift retain it. Exact
hash reconciliation and surface-specific finality checks govern recovery; a
`NOT_FOUND` response alone is not permission to sign again. Deploy confirmation
also requires matching authoritative owner DB state. Lantern never submits or
retains a signed envelope; the original hash is known before signing.

## Tests, fixtures and remaining acceptance

Official-contract provider mocks and in-memory cryptographic transactions cover
detection, permissions, sign-only requests, refusal/error mapping, generation
changes, unknown-outcome holds, body/signature mutation and existing-wallet
regressions. They are **not** real-extension, phone or mainnet acceptance.

The five expired unsigned scanner inputs plus retained simulation are already
published under [the sample packet](testing/lantern-live-scan-samples/README.md).
Lantern reported scanner results and retention/publication was approved on #1021.
Do not sign those historical inputs or use them as executable joint QA fixtures.

Remaining work under [#1001](https://github.com/webnxt-2030/pinkraft/issues/1001),
coordinated through [#1050](https://github.com/webnxt-2030/pinkraft/issues/1050):

- Independently review, pass CI, merge and verify the authorized Testnet deployment.
- Prepare the subscriber fixture for Lantern's supplied public Testnet account;
  publish allowance link, exact amount, budget, expiry and schedule before signing.
  Keep payments going to Paiflow's disposable recipient. This PR creates no fixture.
- Run joint desktop connect, trigger, allowance, deploy and one subscription action;
  record app/module/extension revisions, public hashes and one-submit evidence on
  #1021. Include rejection, unlock/close, Mainnet, wrong account, revoke,
  account/network away-and-back and interrupted/reloaded recovery cases.
- Run Freighter and WalletConnect regressions on that same build. Keep #1001 open
  until real acceptance is evidenced; Android and final-origin acceptance remain
  separate.

The desktop adapter changes no CSP, cookies, auth, network endpoints or environment
variables. Its local icon requires no external image allowance.

## Lantern framing permission

For the framing request in [#1021](https://github.com/webnxt-2030/pinkraft/issues/1021),
Paiflow permits these exact parent origins in `frame-ancestors` across the app:

- `https://android.golantern.xyz`
- `chrome-extension://iflpkjgolcbleombhldiibhojohjpnmd`

All other ancestor origins remain blocked, including Paiflow itself and other
Lantern subdomains or extension IDs. Every ancestor in a nested frame chain must
be permitted. `X-Frame-Options: DENY` is removed because it conflicts with this
permission; an ancestor-only static CSP also protects middleware-excluded paths.
Middleware responses retain the full nonce-bearing CSP and the same ancestor list.
Existing marketing redirects (`/about`, `/privacy`, `/terms`) leave this app for
`beta.paiflow.xyz`; they do not grant framing permission to that destination.

This is header permission only, not embedded-app acceptance. The previous bridge
from [#928](https://github.com/webnxt-2030/pinkraft/issues/928) is not restored;
real Apps-tab loading and signing still require compatible Lantern artifacts and
joint tests. This is separate from desktop external connection (#1001) and Android
Chrome WalletConnect (#1002). Auth guards, redirects, session cookies
(`HttpOnly`, `Secure`, `SameSite=Lax`), passkeys, Google sign-in and other security
headers are unchanged. Cross-site cookie restrictions may prevent authenticated
sessions in an iframe; no embedded login or signing readiness is claimed.
