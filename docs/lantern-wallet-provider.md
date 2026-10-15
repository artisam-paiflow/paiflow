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

Status checked **2026-10-15 UTC**: all five integration issues remain open. The
merged source snapshot is `6d8d7294`; the completed manual financial rehearsal
used `b7b92a49`. Do not treat evidence from that earlier build as a new run on
`6d8d7294`, or Paiflow preparation as working Lantern support.

| Issue                                                        | Delivered preparation                                                                                                                                                                                                                                                                                                                    | Evidence revision                                                                                                                                   | Remaining acceptance gate                                                                                                                                  |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#397](https://github.com/webnxt-2030/pinkraft/issues/397)   | Shared wallet initialization ([#1006](https://github.com/webnxt-2030/pinkraft/pull/1006)); exact-session trigger signing and recovery ([#1012](https://github.com/webnxt-2030/pinkraft/pull/1012)).                                                                                                                                      | `6d8d7294` source/unit checks; `b7b92a49` desktop Freighter trigger.                                                                                | Actual-handset trigger, native handoff and pending-session return/restore checks.                                                                          |
| [#1000](https://github.com/webnxt-2030/pinkraft/issues/1000) | Shared picker and picked-wallet tracking ([#1007](https://github.com/webnxt-2030/pinkraft/pull/1007)); deploy/payroll recovery ([#1014](https://github.com/webnxt-2030/pinkraft/pull/1014), [#1015](https://github.com/webnxt-2030/pinkraft/pull/1015)); network preflight ([#1018](https://github.com/webnxt-2030/pinkraft/pull/1018)). | `6d8d7294` source/unit checks; `b7b92a49` Freighter deploy, trigger, allowance and subscription actions.                                            | Actual desktop payroll coverage and WalletConnect/mobile checks across signing surfaces.                                                                   |
| [#1001](https://github.com/webnxt-2030/pinkraft/issues/1001) | Inactive SWK 1.x module, fake-provider tests, local icon and telemetry ([#1011](https://github.com/webnxt-2030/pinkraft/pull/1011)).                                                                                                                                                                                                     | `6d8d7294` source/unit checks; unavailable row observed on `57bee6bb`.                                                                              | Verified provider detection, permissions, errors, sign-only contract and install target; real Lantern actions and same-build wallet regressions.           |
| [#1002](https://github.com/webnxt-2030/pinkraft/issues/1002) | Shared mobile registry and generic platform-filter tests ([#1010](https://github.com/webnxt-2030/pinkraft/pull/1010)); no Lantern mobile entry.                                                                                                                                                                                          | `6d8d7294` source/unit checks with synthetic restricted-wallet fixtures only.                                                                       | Official metadata/build, actual Lantern row/deep-link tests, Android pairing/rejection/return and existing mobile-wallet regressions.                      |
| [#1003](https://github.com/webnxt-2030/pinkraft/issues/1003) | Foundations above and five synthetic offline scan fixtures ([#1008](https://github.com/webnxt-2030/pinkraft/pull/1008)).                                                                                                                                                                                                                 | Manual Freighter report on `b7b92a49` ([#1013](https://github.com/webnxt-2030/pinkraft/pull/1013)); `6d8d7294` builder-only browser checks pending. | Real Lantern desktop/Android actions, same-build wallet matrix, verified setup instructions, sample handoff/scanner results and mainnet scan confirmation. |

The [manual Freighter report (PR #1013)](https://github.com/webnxt-2030/pinkraft/pull/1013)
records eight successful own-fixture Testnet operations, including lost-response
recovery, approval/revocation and exact fee reconciliation. It does not establish
scheduler, relayer, payroll, other-wallet or real-handset acceptance. Payroll was
disabled in that test environment; its UI/relayer branch was not exercised.

A working wallet-enabled browser E2E harness remains missing. The correction in
[#1016](https://github.com/webnxt-2030/pinkraft/pull/1016) reports that path as
explicitly skipped; builder-only desktop/mobile-emulation execution is separate
and cannot establish wallet or handset acceptance.

Five additional real, expired unsigned inputs have been prepared and independently
reviewed **locally only**: four application captures and one read-only actual-builder
RPC simulation. They have not been published or delivered. Export still requires
explicit user approval for the exact payload and destination; no payload is linked
here. The committed five offline fixtures remain synthetic, and neither packet
establishes Lantern scanner interpretation or acceptance.

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
