# Lantern desktop adapter preparation

Paiflow status: experimental, **not yet supported**. The desktop picker lists
`Lantern (not yet supported)` as unavailable. Its link opens the official
[Lantern information homepage](https://golantern.xyz), not installation instructions for a verified compatible
build. Lantern now reports a desktop external-connect build; Paiflow has not yet
received and verified its module, reference documentation and test extension. The current extension may
have other features; installing it does not activate this integration.

[#1001](https://github.com/webnxt-2030/pinkraft/issues/1001) requests a browser-wallet
entry alongside Freighter, separate from the reverted embedded Apps-tab bridge.
The desktop adapter does not restore embedded signing or postMessage adapters.
The separate framing permission below does not activate this adapter.
It uses the installed Stellar Wallets Kit **1.x** module interface without new
dependencies or a library migration.

## What is prepared and what remains blocked

`components/deploy/lantern-module.ts` implements a local SWK module. The shared kit
constructs it **without a provider reader**. That keeps real browser activation
unavailable even when `window.lantern` exists; a similarly named injected object is
not evidence of a compatible or trusted provider. Missing APIs, mainnet, unknown
responses, account/network changes, unsupported signing modes and invalid wallet
signatures fail closed.

Only fake-provider tests supply the constructor's provisional provider reader.
There is no environment switch, per-user bypass or network override. The adapter
refuses mainnet even with an injected fixture. This restriction belongs to the
Lantern adapter; it does not change the environment-pinned network model in
[CLAUDE.md §7.5](../CLAUDE.md#75-networks) or other wallets.

## Desktop readiness — 2026-10-17

The latest replies relayed by the Paiflow maintainer are recorded in
[current handoff #1050](https://github.com/webnxt-2030/pinkraft/issues/1050),
continuing [#1021](https://github.com/webnxt-2030/pinkraft/issues/1021).
Lantern reports that desktop external connect is built, test builds are ready,
and the extension exposes `window.lantern` with `apiVersion: 1`.
Its reported Chrome extension ID is `iflpkjgolcbleombhldiibhojohjpnmd`.
Paiflow intends to vendor the offered `lantern.module.ts`: an import-free,
single-file Stellar Wallets Kit module compatible with **1.9.5**, registered
alongside Freighter. Upstream SWK inclusion has no schedule; we are not waiting
for it. The actual file, reference docs and compatible build remain outstanding.
Joint desktop acceptance will use Lantern's published Testnet release once
available; receipt of source/docs can unblock preparation before that run.
These are upstream-reported facts, not independently verified installation or
compatibility instructions. The extension ID and provider name alone do not
establish provenance, capabilities or a trusted API.

The reported signing model matches Paiflow's requirement: Lantern returns signed
XDR and never submits; Paiflow submits the accepted envelope once. Lantern
refuses `signTransaction` with `submit: true` and requires the server-supplied
Testnet `networkPassphrase` on each request. Mainnet is refused in this release.
The shared kit stays on 1.x. Do not replace `paiflow-provisional-v1` with `1` and assume the
method signatures, response fields, permissions or lifecycle are compatible.
The actual module/reference contract must replace those fixture assumptions.
The private upstream tracking issue
[`kimerran/internal-lantern#294`](https://github.com/kimerran/internal-lantern/issues/294)
remains inaccessible; it is not evidence of unimplemented work.

### Reported error contract to verify

| Lantern-reported failure      | Reported kit mapping | Required Paiflow behavior                                                                                                                                           |
| ----------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `user_rejected`               | `-4`                 | Show the existing cancellation message; do not submit or automatically retry.                                                                                       |
| `not_allowed`                 | `-3`                 | Not connected or Lantern is on Mainnet: ask the user to connect/reconnect or switch to Testnet as appropriate. Do not classify this as cancellation.                |
| `account_mismatch`            | `-3`                 | Require the intended connected account. Preserve the original failure kind to distinguish this from `not_allowed`.                                                  |
| `timeout` / `connection_lost` | Not specified        | Treat the outcome as unknown. Retain the known transaction identity/hash and reconcile before another signature. Without authoritative resolution, retain the hold. |
| Locked wallet                 | Not specified        | Obtain the actual response shape and code from the reference docs; do not infer one from text.                                                                      |

This table records the supplied requirements, **not an implemented vendor error
mapping**. The provisional adapter below continues to use its explicitly fake
uppercase codes. Inspect how the real module propagates both numeric kit errors
and original failure kinds before connecting it to Paiflow's UI and recovery.
In particular, the provisional generic failure message invites a retry and is
not acceptable handling for real `timeout` or `connection_lost`; verified unknown-
outcome handling is a required activation gate.
A failed or timed-out wallet request must leave a clear recoverable UI rather
than an indefinite spinner; ending a spinner never establishes financial finality.

### Deployment and executable test material

As recorded in [#1050](https://github.com/webnxt-2030/pinkraft/issues/1050),
checks on **2026-10-17 UTC** confirmed the testing app at **https://pinkraft.xyz**
from `lantern-integration`, revision `5f956fe505aaa90fe670918b5cd2e96217ddbe30`,
on **Testnet**, with payroll/off-ramp disabled and database, Redis and RPC healthy.
This is a dated checkpoint; recheck the pinned build before joint signing.

Canonical HTTP redirects to HTTPS; signed-out HTTPS root leads to `/dashboard`
and then `https://pinkraft.xyz/login?from=%2Fdashboard`, staying on that host.
The Railway alias `https://pinkraft-prod.up.railway.app` directs signed-out dashboard
entry to the canonical login. Configured `/about`, `/privacy` and `/terms` redirects
leave the app for `https://beta.paiflow.xyz/{about,privacy,terms}.html`; those external
pages' availability/framing was not verified.

The planned final app origin is **https://beta.app.paiflow.xyz**, separately from
initial QA. Its availability/network/redirects are not verified or authorized for
testing by this document. After separately ready and authorized, repeat focused
connect/sign/reject/recovery checks there. Lantern reports only that final origin
is in its directory: expect **“Unverified site” on `pinkraft.xyz`** unless the teams
agree to add it. That expected QA warning is not evidence of connection failure.
Each origin has separate site permissions and browser session/pending state.
Reconnect/approve as required and authoritatively reconcile known pending
transactions before switching; never clear markers or replay to unblock the move.

Available public trigger:
[0.1 Test XLM trigger](https://pinkraft.xyz/trigger/492c9e37-5d6b-4c9b-9eb9-318169051b04).
Its native-XLM payment is **1,000,000 stroops**, fixed to our disposable Testnet
recipient `GCDF6TFSMWXBK7DGO4AQ4WYBSTS5OHM6S4OJRG7MZ7V34AT2LYSOJNWZ`.
A different tester sends that amount to our account; it is **not refunded to them**.
The page, contract state and an unsigned preparation were verified; this does not
mean Lantern is enabled. Testers need Test XLM for both the payment and dynamic
fees; review the actual quote before signing.

The allowance/subscriber fixture remains pending **Lantern's tester public Testnet
G-address** and agreement on the payment recipient, bounded allowance budget,
expiry, amount and schedule. The historical subscription is cancelled and bound
to our wallet; it is not a working approval fixture. The historical one-stroop
scan approval is not a subscription payment budget. After receiving the address,
prepare and verify the suitable fixture and provide its working allowance link
through #1050 before QA. Authenticated deployment QA also needs separately
provisioned tester access; credentials must not be posted publicly.

Do not sign expired scan envelopes, reactivate/fund fixtures, clear pending state
or replay historical transactions merely to make the packet appear ready.
Record exact app/module/extension revisions, available checksums and bounded
fee/spending limits before joint QA. Share public links and transaction hashes,
never credentials, opaque approval intents or signed envelopes.

### Desktop and Android boundaries

Desktop #1001 connects Paiflow's external website to the Chrome extension.
The separate [framing change #1049](https://github.com/webnxt-2030/pinkraft/pull/1049)
is merged and its live headers were verified at the testing revision above:
only `https://android.golantern.xyz` and
`chrome-extension://iflpkjgolcbleombhldiibhojohjpnmd` may frame the app, and
`X-Frame-Options` is absent on the checked login, dashboard redirect and trigger
responses. See the policy details below. This permission does not establish
embedded login or signing, and the previous bridge is not restored.

Android Chrome WalletConnect remains pending on Lantern under #1002. Confirm its
Stellar namespace, `stellar:testnet` chain and `stellar_signXDR` method when
pairing is built.
Apps-tab embedding remains separate and needs its actual signing contract/build
and joint tests; it does not complete #1002. The optional `related_applications`
entry for `com.lantern.wallet` is not implemented and does not block desktop QA.

## Provisional fake-provider contract

The injected object must declare `apiVersion: "paiflow-provisional-v1"` and expose
only the two methods Paiflow needs:

```ts
getAddress({ networkPassphrase }): Promise<{
  address: string;
  networkPassphrase: string;
}>;

signTransaction(transactionXdr, {
  address,
  networkPassphrase,
  submit: false,
}): Promise<{
  signedTxXdr: string;
  signerAddress: string;
  networkPassphrase: string;
}>;
```

Each method result is received as `unknown` and parsed. Account values must be
valid Stellar `G…` addresses. Both response passphrases must match TESTNET. Before
signing, the adapter requires the explicit server-supplied transaction passphrase,
rechecks the selected provider/account before and after approval, fences connection
changes and disconnects with a local generation, and verifies the transaction source matches
the connected account. It never substitutes a client network for a missing or
mismatched server passphrase.

`submit: false` is mandatory in the adapter's provider call. Requests to submit,
submit to a URL, derive a hardware-wallet path, sign a message or sign an auth
entry are unsupported. The adapter itself has no RPC submission path.
The version marker describes expected fixture semantics; only upstream
implementation review and real-extension testing can establish that a real
provider honors sign-only behavior.

The returned envelope must preserve the original transaction body and all existing
signatures and contain a cryptographically valid signature from the connected
account under the requested passphrase. Matching an asserted `signerAddress` field
alone is insufficient. The shared `lib/stellar/wallet-signature.ts` verifier checks
these invariants. Paiflow submits only after its existing signing flow accepts the
returned envelope.

These provisional rejection codes are matched exactly: `USER_REJECTED`, `LOCKED`,
`WRONG_NETWORK`, `WRONG_ACCOUNT`. They become controlled adapter errors; no provider
payload or arbitrary provider message is logged or exposed as a diagnostic detail.
`USER_REJECTED` uses the existing “Transaction cancelled in your wallet.” copy.
Text containing words such as “rejected” or “locked” does not establish an error
kind. The mapping must be replaced or confirmed against documented upstream codes
before browser activation.

`walletId: "lantern"` uses the existing wallet connection schema, delivery queue,
audit metadata and admin submission-proof rows. The telemetry wallet-ID allowlist
explicitly includes `lantern`; unknown labels still become `other`. No connection
schema or DB migration is required. Since the real module remains unavailable, the preparation
does not generate a successful Lantern connection event in normal use.

## Paiflow preparation and acceptance

### Deprecated features in this integration

Payroll and fiat off-ramp are excluded from current Lantern acceptance. Keep
`FEATURE_PAYROLL_ENABLED=false` and `FEATURE_OFFRAMP_ENABLED=false` in the testing
environment. These existing operator switches hide new-use UI and refuse new
payroll/cash-out deployments, new fiat recipients and off-ramp enablement. They
are not settlement stop switches: existing financial obligations, transaction
status, cancellations/refunds and historical configuration/reconciliation remain
available. Draft graphs may still be saved; disabled features cannot be deployed.
Generic Subscription, Splitter and Payer contracts remain supported.

Shared signing uses deployment-request admission rather than importing the
payroll workflow. It deliberately retains the old deployment/network-scoped
`paiflow_payroll_pending` storage namespace, so an unresolved legacy preparation
or transaction still blocks competing writes on that same deployment. A marker
for another deployment or network has no effect. No markers are migrated,
deleted or ignored when flags turn off, and malformed state still fails closed.
Resolve a legacy recipient update through its original status/recovery controls;
turning a feature off does not establish transaction finality.

Historical acceptance checkpoint (**2026-10-15 UTC**): all five integration issues
were open at that check. The merged source snapshot is `6d8d7294`; the completed manual financial rehearsal
used `b7b92a49`. Do not treat evidence from that earlier build as a new run on
`6d8d7294`, or Paiflow preparation as working Lantern support.

| Issue                                                        | Delivered preparation                                                                                                                                                                                                                                                                                                                    | Evidence revision                                                                                                                                                        | Remaining acceptance gate                                                                                                                                  |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#397](https://github.com/webnxt-2030/pinkraft/issues/397)   | Shared wallet initialization ([#1006](https://github.com/webnxt-2030/pinkraft/pull/1006)); exact-session trigger signing and recovery ([#1012](https://github.com/webnxt-2030/pinkraft/pull/1012)).                                                                                                                                      | `6d8d7294` source/unit checks; `b7b92a49` desktop Freighter trigger.                                                                                                     | Actual-handset trigger, native handoff and pending-session return/restore checks.                                                                          |
| [#1000](https://github.com/webnxt-2030/pinkraft/issues/1000) | Shared picker and picked-wallet tracking ([#1007](https://github.com/webnxt-2030/pinkraft/pull/1007)); deploy/payroll recovery ([#1014](https://github.com/webnxt-2030/pinkraft/pull/1014), [#1015](https://github.com/webnxt-2030/pinkraft/pull/1015)); network preflight ([#1018](https://github.com/webnxt-2030/pinkraft/pull/1018)). | `6d8d7294` source/unit checks; `b7b92a49` Freighter deploy, trigger, allowance and subscription actions.                                                                 | WalletConnect/mobile checks across non-payroll signing surfaces; deprecated payroll is excluded from current integration acceptance.                       |
| [#1001](https://github.com/webnxt-2030/pinkraft/issues/1001) | Inactive SWK 1.x module, fake-provider tests, local icon and telemetry ([#1011](https://github.com/webnxt-2030/pinkraft/pull/1011)).                                                                                                                                                                                                     | `6d8d7294` source/unit checks; unavailable row observed on `57bee6bb`.                                                                                                   | Verified provider detection, permissions, errors, sign-only contract and install target; real Lantern actions and same-build wallet regressions.           |
| [#1002](https://github.com/webnxt-2030/pinkraft/issues/1002) | Shared mobile registry and generic platform-filter tests ([#1010](https://github.com/webnxt-2030/pinkraft/pull/1010)); no Lantern mobile entry.                                                                                                                                                                                          | `6d8d7294` source/unit checks with synthetic restricted-wallet fixtures only.                                                                                            | Official metadata/build, actual Lantern row/deep-link tests, Android pairing/rejection/return and existing mobile-wallet regressions.                      |
| [#1003](https://github.com/webnxt-2030/pinkraft/issues/1003) | Foundations above and five synthetic offline scan fixtures ([#1008](https://github.com/webnxt-2030/pinkraft/pull/1008)).                                                                                                                                                                                                                 | Manual Freighter report on `b7b92a49` ([#1013](https://github.com/webnxt-2030/pinkraft/pull/1013)); `6d8d7294` builder-only desktop and Pixel 7 emulation checks passed. | Real Lantern desktop/Android actions, same-build wallet matrix, verified setup instructions, sample handoff/scanner results and mainnet scan confirmation. |

The [manual Freighter report (PR #1013)](https://github.com/webnxt-2030/pinkraft/pull/1013)
records eight successful own-fixture Testnet operations, including lost-response
recovery, approval/revocation and exact fee reconciliation. It does not establish
scheduler, relayer, payroll, other-wallet or real-handset acceptance. Payroll was
disabled in that test environment; its UI/relayer branch was not exercised.

At that historical checkpoint, a working wallet-enabled browser E2E harness was
missing; the correction in
[#1016](https://github.com/webnxt-2030/pinkraft/pull/1016) reports that path as
explicitly skipped. On healthy, pinned `6d8d7294`, the unmodified builder-only test
passed in desktop and Pixel 7 emulation (two cases, no retries or hooks), and the
two new own drafts were deleted through the owner API with the original three
preserved. No deploy control or wallet was used, no prepare/sign/submit path was
exercised, and CSP violations were unmeasured in the ephemeral contexts; emulation
is not handset or wallet acceptance.

As of **2026-10-17 UTC**, all five real, expired unsigned inputs and the retained
splitter-distribute simulation from [PR #1022](https://github.com/webnxt-2030/pinkraft/pull/1022)
are merged into `lantern-integration` under
[`docs/testing/lantern-live-scan-samples/`](testing/lantern-live-scan-samples/README.md).
The packet includes four application captures, one read-only actual-builder RPC
simulation, a decoded manifest, provenance and validation tests. It covers factory
deployment, deposit, splitter distribution, streamer top-up and token approval.
The earlier offline fixtures remain synthetic. Neither packet is executable joint
QA material; do not sign or submit expired historical envelopes.

Lantern [posted scan results for all five](https://github.com/webnxt-2030/pinkraft/issues/1021#issuecomment-6206961436).
The maintainer then [approved all five plus the simulation](https://github.com/webnxt-2030/pinkraft/issues/1021#issuecomment-6210830894)
for retention as scanner fixtures in Lantern's development repository and its
public repository at release, with the described public metadata and attribution.
The latest maintainer-relayed reply reports that the fixtures are incorporated
and the scanner now describes contract creation, self-returning transfers and
allowance spender/amount/duration better. No further delivery or retention approval
is pending for this exact packet and destination. These scanner results do not
establish external connection, real-extension signing or joint acceptance.

## Required next steps

1. Receive and inspect the offered SWK module, reference documentation and test
   extension. Record their exact provenance/revisions and available checksums.
   Verify the real provider API, permission/approval behavior, documented failure
   codes and sign-only guarantees. Reconcile every provisional field
   and response with that implementation; do not silently treat this fixture API
   as vendor agreement.
2. Validate provider detection and compatibility before changing the default
   unavailable gate. Confirm how the connected account and network can be read
   without relying on self-reported signing-result metadata alone.
3. Complete the executable allowance/subscriber packet through #1050 and recheck
   the testing origin/redirects before signing. Run joint desktop QA with Lantern's
   published Testnet release on the same pinned Testnet app build: connect, trigger,
   allowance, deploy and one subscription action. Post transaction hashes/results
   on #1021, cross-referencing #1050, and verify each submits once. Include refusal,
   account/network change and interrupted/reloaded recovery cases. Run Freighter
   and WalletConnect regressions on that build; existing-wallet mobile/device
   acceptance remains outstanding.
4. Complete Android WalletConnect separately in #1002. Confirm Lantern's mainnet
   scan path before considering mainnet adapter activation under #1003.

No real-extension, real-phone or mainnet acceptance is claimed by the unit tests.
The local copied icon does not require a CSP change. The adapter adds no Lantern scripts, child-frame sources or network endpoints
to Paiflow's CSP. The separate ancestor permission below controls who may frame Paiflow.

## Icon attribution

`public/wallets/lantern.jpg` is an unchanged copy of `homepage/logo.jpg` from the
[official public repository at commit
1156c771c04410c5fc7e5cb051af797e70918682](https://github.com/kimerran/stellar-lantern/blob/1156c771c04410c5fc7e5cb051af797e70918682/homepage/logo.jpg).
The repository's MIT license credits “Copyright (c) 2026 Lantern contributors”.
Its full license text is retained in `public/wallets/lantern-license.txt`. This is
asset attribution; it does not imply upstream review or endorsement of Paiflow's
provisional adapter.

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
