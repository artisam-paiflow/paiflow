# Lantern Android wallet readiness

The mobile wallet registry centralizes Paiflow's existing Freighter, LOBSTR and
xBull metadata. It supports platform restrictions so a future Android-only wallet
can stay hidden on iOS, including iPadOS desktop user agents. Generic fixture tests
exercise this filtering; they are not evidence of Lantern or real-phone support.

[Lantern mobile integration #1002](https://github.com/webnxt-2030/pinkraft/issues/1002)
remains open. There is deliberately no production Lantern mobile entry. Before
adding one, obtain the official WalletConnect wallet ID, display name, icon,
native and universal link metadata, and exact pairing URI encoding contract.
Do not infer these from Lantern's embedded Apps-tab bridge or its extension ID.
Use an official icon hosted locally when that entry is added.

An Android build supporting WalletConnect v2, `stellar:testnet` and sign-only
`stellar_signXDR` is also required. Verify pairing, rejection, foreground/background,
return to Paiflow, allowance and trigger signing, and one-time submission on an
actual phone; retain public transaction hashes and exact build/device evidence.
An inaccessible upstream prerequisite issue does not establish shipment status.

Follow [wallet regression issue #983](https://github.com/webnxt-2030/pinkraft/issues/983)
and the integration acceptance plan for live checks. Keep existing Freighter, LOBSTR and xBull
native paths, pairing encoding and synchronous user-tap navigation unchanged.
Wallet peer names remain untrusted ranking hints; session restoration must retain
its exact approved topic, chain, account and signing-method checks.
