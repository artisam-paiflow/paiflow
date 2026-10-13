# Lantern embedded wallet adapter

Issue [#930](https://github.com/webnxt-2030/pinkraft/issues/930) adds the client adapter in
`components/deploy/lantern-wallet.ts`. Issue
[#931](https://github.com/webnxt-2030/pinkraft/issues/931) connects it to public testnet trigger
and Subscription allowance payments. Installed-device support still requires #933 evidence.

## Interface and selection

Call `selectLanternWallet(deploymentNetwork)` before initializing browser wallet SDKs and retain
its returned instance for the connected flow. It returns `null` outside an approved Lantern parent
frame. The caller must use the server-provided deployment network and passphrase, never a wallet
network to choose transaction preparation.

- `getAddress({ signal? })` explicitly connects and returns `{ address }`.
- `signTransaction(xdr, { networkPassphrase, address?, signal? })` returns `{ signedTxXdr }` for
  existing submission code. Supply the account used to prepare the transaction in `address` when
  available. Signing never prepares, modifies, submits, or rebuilds a transaction.
- `disconnect()` clears the local connection and cancels active and queued requests from this
  adapter. It does not revoke Lantern's parent-side grant or close its wallet prompt; the protocol
  provides no method for those operations. Call it when the owning flow unmounts.

Only the immediate parent can be selected, using `location.ancestorOrigins[0]` when available,
otherwise `document.referrer`. If neither exposes an approved origin, selection fails closed.
Approved origins are shared with the framing policy in `lib/csp.ts`. Query parameters and storage
are not wallet selection signals. Every reply must independently match `window.parent` and the
selected exact origin. Every outbound message uses that exact target origin.

## Public payment integration

Both `/trigger/:deploymentId` and `/allowance/:deploymentId` use `TriggerButton`. Its layout
selection runs before mobile prewarming and WalletConnect session restoration. In a trusted Lantern
frame, public testnet actions connect/sign with Lantern and never initialize browser wallet SDKs,
open a wallet picker, restore a WalletConnect pairing/session, or navigate to a mobile wallet.
Embedded public mainnet actions show Testnet-only guidance before any browser wallet initialization.
Standalone Freighter/WalletConnect mainnet and testnet behavior remains available. Payroll retains its
existing browser wallet and session-protected server routes outside Lantern. Inside Lantern, Payroll
wallet actions show authenticated-milestone guidance without wallet initialization or mobile navigation;
authenticated actions are deferred to #932.

The adapter belongs to the component's existing owned payment attempt. Connection and signing receive
its abort signal; signing receives the account used for preparation and the server passphrase.
Deployment, network, amount, mode, template, or deposit-intent changes and unmount disconnect the
adapter and invalidate late replies. Terminal attempts also disconnect locally. Wallet connection
analytics record `walletId: "lantern"` with the existing trigger surface.

`getWalletKit(network, { publicPayment: true })` is an explicit public-flow opt-in, selected before
browser SDK imports or cache access. Its discriminated result has `provider: "lantern"` and a typed
`LanternWallet` for embedded testnet payments, or `provider: "browser"` with the existing browser kit.
Lantern callers use `getAddress`/`signTransaction`/`disconnect`, not browser modal methods. Default
`getWalletKit(network)` callers retain browser wallets outside Lantern and show unsupported
authenticated-action guidance inside Lantern before SDK/cache access; public opt-in rejects embedded mainnet. The
separate TriggerButton path owns its adapter directly because it also owns WalletConnect pairing UI.

Preparation and submission stay on the existing server routes. Public trigger keeps #937's
hash/receipt-only durable record before sending and requires Web Locks; Subscription allowance keeps
its scoped intent and prepared hash. Unknown confirmation retains the original pending payment and
reconciles after reload without preparing or signing again. No signed envelope is stored for recovery.
Tests exercise actual distribute, pipeline/webhook deposit, streamer top-up, and token-approve
preparation through RPC simulation fixtures and real SDK assembly. Each resulting normal Soroban envelope uses the customer transaction
source, meeting Lantern's source rule without fee-bump conversion or a contract rewrite.

## Protocol and lifecycle

The adapter implements `lantern:getPublicKey` and `lantern:signXdr` against Lantern's
[mini-app bridge contract](https://github.com/kimerran/stellar-lantern/blob/ed512f6d3a478e4fc9eaab498627a6d0f8165d30/docs/mini-app-bridge.md).
Primary source was inspected at commit `ed512f6d3a478e4fc9eaab498627a6d0f8165d30` (package 0.6.3).
Installed release support still requires rollout validation in #933.

Complete workflows share one queue per frame, even across adapter instances and deployment
networks. Connection responses must contain a valid Stellar public key and `TESTNET` or `PUBLIC`;
they must match the deployment network. Signing responses, acknowledgments, and errors must echo
the unique signing request ID. No signing acknowledgment within five seconds produces an
unsupported-build message that asks the user to update Lantern. Acknowledged connection/signing
reviews have a two-minute timeout. Terminal success, rejection, error, abort, and timeout remove
their listeners and timers. Queued cancellation settles immediately without overlapping requests.

**Connection timeout/cancellation requires a frame reload.** Lantern's connection replies have no
request IDs, so a late approval cannot safely be correlated with a subsequent connection. Once a
sent connection is interrupted, all adapter instances in that frame refuse further requests until
reload. Closing an old prompt alone cannot prove that a late reply is no longer in flight. Signing
requests have IDs and can ignore old replies, but a pending Lantern review may still require the
user to close it before reconnecting and trying again.

Lantern emits no account/network change event. The adapter refreshes identity before signing and
again before returning the signed envelope. A change invalidates the connection and requires an
explicit reconnect and fresh preparation. The signed envelope must have the original transaction
hash, retain every existing signature, and contain a valid signature from the connected account.
Fee-bump envelopes are refused without conversion; fee sponsorship requires separately supported
inner-envelope preparation, outside this adapter.

A matching Lantern origin and wallet connection are transport selection, **never Paiflow
authentication**. Initial rollout is public testnet payments on Android and the extension. Mapping
`PUBLIC` to the canonical mainnet passphrase is a consistency guard, not a claim of mainnet device
support or authenticated embedded-app support.

## Validation limits

Unit tests use a browser-window message harness and actual Stellar envelopes to verify security,
serialization, cancellation, and signed-envelope integrity. They do not establish installed Lantern
build behavior, real browser referrer/ancestor availability, frame loading, or actual Soroban/device
signing. Those require coordinated #931/#933 validation on Android and the extension.
