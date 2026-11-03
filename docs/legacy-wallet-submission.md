# Legacy wallet submission binding

The public trigger and authenticated generic invocation routes bind submission to
the exact unsigned transaction the server prepared. This closes the legacy
transaction-integrity gap tracked in [#851](https://github.com/webnxt-2030/pinkraft/issues/851).
It does not change the separate policy-v1 execution or allowance protocols.

## Preparation and first submission

After simulation, each supported preparation persists a
`WalletSubmissionPreparation` row before returning XDR. Its transaction hash binds
the source, sequence, fee, resources, operations, target, asset, arguments and finite
expiry. The row also records the deployment/network, submission kind, authorizing
wallet, expected method and a digest of the deployed graph, parameters and durable
pipeline. It contains no private key, wallet credential or signed envelope.

The request/response bodies stay compatible with existing clients:

```text
POST /api/deployments/:id/trigger -> { data: { xdr, networkPassphrase } }
POST /api/deployments/:id/submit-trigger <- { signedXdr }
```

The same registration applies to streamer control preparations at `/invoke` and
Subscription charge, subscribe, unsubscribe and relayer-update preparations. Their
signed submissions continue to use `/submit-invoke`.

Before a first send, the server verifies a real source-account signature for the
environment network, one supported contract invocation without operation-source
overrides or alternate authorization credentials, the durable deployment target
and the exact unexpired preparation hash. Streamer controls require the deploying
wallet and deployed schedule permissions. Subscription charge/relayer updates
require the deploying wallet; subscribe/unsubscribe require the subscriber from
the deployed graph. A first relayer-update submission must still match the current
desired relayer. Generic token approvals and relayer-only methods are refused.

The server reloads deployment evidence under its database lock and records the
source-signed journal atomically before network submission. Concurrent identical
submissions have one first sender; subsequent callers recover the same identity.
An invalid or unprepared envelope produces a local refusal before any
deployment-attributed signed journal, analytics outbox, submit audit or RPC send.
The service-admission wrapper retains its ordinary retirement restrictions.

## Original-transaction recovery

A correctly scoped existing signed journal selects recovery, including for
historical transactions without a preparation row and envelopes whose signing
window has expired. It must still match the deployment, network, kind, source,
valid signature and supported operation/target. A historical unrelated or
misattributed operation cannot gain new submission authority from an old row.

Stored authoritative confirmation/failure with a ledger can answer after provider
history retention. Otherwise the server queries only the original hash. `NOT_FOUND`
returns pending uncertainty and never resends, changes the hash or clears the
original record. Recovery writes only proof-backed finality; it does not create a
second submit audit or asset transfer. Unknown states and original financial
evidence remain retained.

Retirement admission remains unchanged. Financial and receipt evidence, owner
retirement-progress and verified settlement paths remain retained. This change
does not reopen transaction-status or submission service for retiring/retired
deployments, or grant settlement admission to a submit-route retry.

## Rollout and limits

Apply additive migration
`20261103150000_legacy_wallet_submission_preparations` before deploying the
updated routes. Its table has a restrictive deployment foreign key; old financial
rows are unchanged. Expired preparation evidence is retained, with no deletion or
timeout-based financial cleanup.

A transaction prepared before this rollout but never admitted has no server
approval row and is refused locally. Existing clients retain its original hash
and status/recovery controls; a refusal does not justify blindly preparing,
signing or sending a replacement payment. Already recorded submissions recover
their original outcome without an approval backfill or a new send.

No contract ABI/WASM, factory, artifact activation, SDK package, environment
selection or API request field changes are required. Source tests and local CI do
not establish a deployed fix or live wallet acceptance. The live SDK payment
checkpoint is separate from this security change, as are 40-node resource
qualification, device/load/fault testing and later instance/configuration phases.
