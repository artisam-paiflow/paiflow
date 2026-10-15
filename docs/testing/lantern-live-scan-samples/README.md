# Real unsigned Testnet scan samples — three of five

This package contains three **real, expired, unsigned** envelopes. Factory
deployment and deposit were captured from the pinned Railway testing application
during the authorized 2026-10-15 Testnet verification. Splitter distribution was
prepared later through the actual repository builder using read-only public
Testnet RPC simulation; it is explicitly **not** an application/server UI capture.
No application prepare, signing, submission, or financial action was performed to
create this package. It supplements the [five synthetic offline fixtures](../lantern-scan-fixtures/README.md),
which remain unchanged.

| Sample                                                     | Operation                            | Captured revision                          | TESTNET transaction hash                                           |
| ---------------------------------------------------------- | ------------------------------------ | ------------------------------------------ | ------------------------------------------------------------------ |
| [Factory deployment](factory-deploy-pipeline.unsigned.xdr) | `deploy_pipeline(admin, blueprints)` | `6b320e717b69878e272871fea1ef08d468ea8298` | `2994ae4fce8176ee373d1baf7524504e069c68b259018ec3ab6cf40d3b1e8420` |
| [Deposit](deposit.unsigned.xdr)                            | `deposit(from, 1000000)`             | `67402e0ba2f9e822c15b8a9b768b4fecdc2fc226` | `2f68d076c7521c27506186a1e4a4b1b6036acd8a7d84a93d8d5f884a0cbb29b6` |
| [Splitter distribution](splitter-distribute.unsigned.xdr)  | `distribute(from, 1000000)`          | `437beafef0c7e444bbef225e190e4e2ad48e4dd3` | `0217cd1936cc6cc0b8b8b5b186895f3c3f98ab0cc3bac91bbab877cdf1fd190e` |

The deployment calls a real factory contract through `invokeHostFunction` /
`hostFunctionTypeInvokeContract`. Its two decoded blueprints create an
`on_receive → split` pipeline, with a single self-recipient and fixed amount of
1000000 stroops. This is not a top-level `createContract` or WASM upload envelope.
The deposit targets that deployed on-receive contract. The manifest records exact
source, contract addresses, constructor arguments, public salts/WASM hashes,
sequence, fee, time bounds and expiration for independent decoding.

All three envelopes have **zero transaction signatures**, source-account authorization
credentials only, no address-authorization signatures, and no memo. They contain no
scoped allowance intent. Only the first two transaction bodies were subsequently
signed and executed during the earlier test. The distribution was simulated only, never signed or
submitted; its actual fee charged is therefore unknown/inapplicable rather than
an inferred resource fee. This package includes no signed envelope, key,
credential, controller state, or browser profile.

## Provenance and fee distinctions

[manifest.json](manifest.json) allowlists decoded public fields and provenance.
For the first two samples the network is TESTNET based on the pinned testing
environment and known successful Testnet transaction hashes. Their raw server
prepare passphrase and raw simulation responses were not retained; the recorded
preparation builders require successful simulation and assembly before returning
XDR (`lib/stellar/deploy.ts` and `lib/stellar/invoke.ts` at those revisions).
Successful chain execution is separate evidence, not a substitute for a retained
raw simulation response.

For the third sample the actual `prepareDistributeInvocation` builder used an
explicit `Networks.TESTNET` passphrase and `https://soroban-testnet.stellar.org`.
Before simulation, public `getNetwork` confirmed that exact passphrase and public
contract-instance storage confirmed the source/admin, sole fixed self-recipient
of 1000000 stroops, no next steps, and unpaused state at ledger 5211884. No owner
credential, profile, application POST, relayer, signing, chain submission, or
maintenance path was used. Temporary client adapters exposed only public account
reads and `simulateTransaction` to the actual builder.

[Whitelisted RPC evidence](splitter-distribute.simulation-public.json) records the
successful simulation at ledger 5211885 and its actual raw result fields:
`latestLedger`, `minResourceFee`, `transactionData`, and `results`. Unneeded events,
diagnostics, HTTP headers and application state are omitted. The raw result auth
entries and assembled envelope were both checked to use source-account credentials
only. This is genuine public RPC simulation evidence, not a server/UI capture,
proof of submission, or Lantern scan acceptance. XDR itself contains **no network
passphrase field**; TESTNET hashes and explicit provenance establish intent.

| Sample                | Maximum envelope fee (stroops) | Actual chain fee charged (stroops) | Successful ledger | Expired at (UTC)    |
| --------------------- | -----------------------------: | ---------------------------------: | ----------------: | ------------------- |
| Factory deployment    |                         981994 |                             851202 |           5211160 | 2026-10-15 15:52:14 |
| Deposit               |                      523953967 |                          455616244 |           5211379 | 2026-10-15 16:10:30 |
| Splitter distribution |                          14784 |                      Not submitted |     Not submitted | 2026-10-15 16:53:12 |

Maximum fee is decoded from the unsigned envelope. Actual fee charged is a separate
chain receipt fact; the deployment amount was independently checked against Testnet
Horizon by the integration orchestrator and reviewer. Public transaction links are
included in the manifest. The unusually high deposit fee reflected the earlier
Testnet code-TTL renewal; it is historical evidence, not a fee recommendation
or permission to repeat the payment. Actual fees cannot be inferred from unsigned
XDR, and the decoder tests do not independently re-query chain receipts.

## Checks and remaining acceptance

```sh
pnpm test tests/unit/stellar/lantern-live-scan-samples.test.ts
```

The tests decode the committed bytes, compare all intended operations/arguments,
verify the TESTNET hashes, require PUBLIC hashes to differ, reject transaction
signatures and all address authorization, and require bounded already-expired time
bounds. They also constrain manifest fields to prevent appending private capture
state. The distribution test additionally parses retained raw simulation fields,
compares assembled resource data/auth entries, and verifies its source/recipient
preflight and absence of an actual chain execution/charged fee. The tests use no
network or database.

Real streamer `top_up` and token `approve` captures remain missing: this is
**three of the five** requested real scan examples, including one expressly
read-only actual-builder RPC sample. No external handoff/upload to Lantern occurred. Lantern scanner interpretation, risk labels,
provider compatibility, real handset behavior and wallet-support acceptance remain
unverified. Do not sign or submit these expired historical samples.
