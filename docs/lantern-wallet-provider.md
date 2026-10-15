# Lantern desktop adapter preparation

Status: experimental, **not yet supported**. The desktop picker lists
`Lantern (not yet supported)` as unavailable. Its link opens the official
[Lantern information homepage](https://golantern.xyz), not a claim that a compatible
browser provider or Paiflow signing path has shipped. The current extension may
have other features; installing it does not activate this integration.

[#1001](https://github.com/webnxt-2030/pinkraft/issues/1001) requests a browser-wallet
entry alongside Freighter, separate from the reverted embedded Apps-tab bridge.
This implementation does not restore framing, embedding or postMessage adapters.
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

The private upstream tracking issue
[`kimerran/internal-lantern#294`](https://github.com/kimerran/internal-lantern/issues/294)
could not be inspected. The public product information and repository do not
establish the browser provider contract. The provisional API below is **Paiflow's
declared fake-provider test contract**, not Lantern documentation or an upstream
implementation claim.

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
rechecks the selected provider/account, and verifies the transaction source matches
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

## Required next steps

1. Obtain the real provider API, permission/approval behavior, documented failure
   codes and sign-only guarantees from Lantern. Reconcile every provisional field
   and response with that implementation; do not silently treat this fixture API
   as vendor agreement.
2. Validate provider detection and compatibility before changing the default
   unavailable gate. Confirm how the connected account and network can be read
   without relying on self-reported signing-result metadata alone.
3. On the same pinned TESTNET build, complete real-extension deploy, trigger,
   allowance and one subscription action; record transaction hashes and verify
   each submits once. Run Freighter and WalletConnect regression checks too.
4. Complete Android WalletConnect separately in #1002. Confirm Lantern's mainnet
   scan path before considering mainnet adapter activation under #1003.

No real-extension, real-phone or mainnet acceptance is claimed by the unit tests.
The local copied icon does not require a CSP change. No Lantern scripts, frames or
network endpoints are added to Paiflow's CSP.

## Icon attribution

`public/wallets/lantern.jpg` is an unchanged copy of `homepage/logo.jpg` from the
[official public repository at commit
1156c771c04410c5fc7e5cb051af797e70918682](https://github.com/kimerran/stellar-lantern/blob/1156c771c04410c5fc7e5cb051af797e70918682/homepage/logo.jpg).
The repository's MIT license credits “Copyright (c) 2026 Lantern contributors”.
Its full license text is retained in `public/wallets/lantern-license.txt`. This is
asset attribution; it does not imply upstream review or endorsement of Paiflow's
provisional adapter.
