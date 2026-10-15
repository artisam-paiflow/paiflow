# Real unsigned Testnet scan samples — two of five

This package contains two **real, expired, unsigned** envelopes captured from the
pinned Railway testing application during the authorized 2026-10-15 Testnet
verification. It supplements the [five synthetic offline fixtures](../lantern-scan-fixtures/README.md),
which remain unchanged. No new transaction preparation, signing, RPC write, or
financial action was performed to create this package.

| Sample                                                     | Operation                            | Captured revision                          | TESTNET transaction hash                                           |
| ---------------------------------------------------------- | ------------------------------------ | ------------------------------------------ | ------------------------------------------------------------------ |
| [Factory deployment](factory-deploy-pipeline.unsigned.xdr) | `deploy_pipeline(admin, blueprints)` | `6b320e717b69878e272871fea1ef08d468ea8298` | `2994ae4fce8176ee373d1baf7524504e069c68b259018ec3ab6cf40d3b1e8420` |
| [Deposit](deposit.unsigned.xdr)                            | `deposit(from, 1000000)`             | `67402e0ba2f9e822c15b8a9b768b4fecdc2fc226` | `2f68d076c7521c27506186a1e4a4b1b6036acd8a7d84a93d8d5f884a0cbb29b6` |

The deployment calls a real factory contract through `invokeHostFunction` /
`hostFunctionTypeInvokeContract`. Its two decoded blueprints create an
`on_receive → split` pipeline, with a single self-recipient and fixed amount of
1000000 stroops. This is not a top-level `createContract` or WASM upload envelope.
The deposit targets that deployed on-receive contract. The manifest records exact
source, contract addresses, constructor arguments, public salts/WASM hashes,
sequence, fee, time bounds and expiration for independent decoding.

Both envelopes have **zero transaction signatures**, source-account authorization
credentials only, no address-authorization signatures, and no memo. They contain no
scoped allowance intent. The corresponding transaction bodies were subsequently
signed and executed during the earlier test; this package includes neither their
signed envelopes nor any key, credential, controller state, or browser profile.

## Provenance and fee distinctions

[manifest.json](manifest.json) allowlists public decoded fields and receipt facts.
The network is TESTNET based on the pinned testing environment and known successful
Testnet transaction hashes. XDR does **not** encode a network passphrase. The raw
server prepare passphrase and raw simulation response were not retained in the
capture records used here; neither is presented as independently preserved evidence.
The captured preparation builders require successful simulation and assembly before
returning XDR (`lib/stellar/deploy.ts` and `lib/stellar/invoke.ts` at the recorded
revisions). Successful on-chain execution is separately recorded, rather than
substituted for a raw simulation response.

| Sample             | Maximum envelope fee (stroops) | Actual chain fee charged (stroops) | Successful ledger | Expired at (UTC)    |
| ------------------ | -----------------------------: | ---------------------------------: | ----------------: | ------------------- |
| Factory deployment |                         981994 |                             851202 |           5211160 | 2026-10-15 15:52:14 |
| Deposit            |                      523953967 |                          455616244 |           5211379 | 2026-10-15 16:10:30 |

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
state. The test uses no network or database.

Real splitter `distribute`, streamer `top_up`, and token `approve` captures remain
missing: this is **two of the five** requested real scan examples. No external
handoff/upload to Lantern occurred. Lantern scanner interpretation, risk labels,
provider compatibility, real handset behavior and wallet-support acceptance remain
unverified. Do not sign or submit these expired historical samples.
