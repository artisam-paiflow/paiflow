# Real unsigned Testnet scan samples — five of five

**Local preparation only: not approved for publication or external handoff.** A
previous export attempt was rejected by automatic approval review; this expanded
payload requires explicit user approval for the exact files and destination before
any push, PR or other export. Keeping it local is not Lantern delivery or scan acceptance.

This package contains five **real, expired, unsigned** envelopes. Factory
deployment and deposit were captured from the pinned Railway testing application
during the authorized 2026-10-15 Testnet verification. Splitter distribution was
prepared later through the actual repository builder using read-only public
Testnet RPC simulation; it is explicitly **not** an application/server UI capture.
Streamer top-up and the one-stroop token approval are existing application
captures from the final integration revision, separately checked against pinned
native-XLM Streamer and subscription targets. Packaging
these existing captures performs no new application prepare, signing, submission
or financial action. It supplements the [five synthetic offline fixtures](../lantern-scan-fixtures/README.md),
which remain unchanged.

| Sample                                                     | Operation                            | Captured revision                          | TESTNET transaction hash                                           |
| ---------------------------------------------------------- | ------------------------------------ | ------------------------------------------ | ------------------------------------------------------------------ |
| [Factory deployment](factory-deploy-pipeline.unsigned.xdr) | `deploy_pipeline(admin, blueprints)` | `6b320e717b69878e272871fea1ef08d468ea8298` | `2994ae4fce8176ee373d1baf7524504e069c68b259018ec3ab6cf40d3b1e8420` |
| [Deposit](deposit.unsigned.xdr)                            | `deposit(from, 1000000)`             | `67402e0ba2f9e822c15b8a9b768b4fecdc2fc226` | `2f68d076c7521c27506186a1e4a4b1b6036acd8a7d84a93d8d5f884a0cbb29b6` |
| [Splitter distribution](splitter-distribute.unsigned.xdr)  | `distribute(from, 1000000)`          | `437beafef0c7e444bbef225e190e4e2ad48e4dd3` | `0217cd1936cc6cc0b8b8b5b186895f3c3f98ab0cc3bac91bbab877cdf1fd190e` |
| [Streamer top-up](streamer-top-up.unsigned.xdr)            | `top_up(from, 1000000)`              | `b7b92a49f9dbce9e9a3e6d1815690ab0f6958afd` | `4cba2f6a867558e845c1f0e401ee9e0c910b6dbd0790588bb9b902e3a99a2184` |
| [Token approval](token-approve.unsigned.xdr)               | `approve(from, spender, 1, 8323016)` | `b7b92a49f9dbce9e9a3e6d1815690ab0f6958afd` | `6dabd461593b301a897807ecc9abf32b7eb3e7b9cfae4ac4a36050608dd8045d` |

The deployment calls a real factory contract through `invokeHostFunction` /
`hostFunctionTypeInvokeContract`. Its two decoded blueprints create an
`on_receive → split` pipeline, with a single self-recipient and fixed amount of
1000000 stroops. This is not a top-level `createContract` or WASM upload envelope.
The deposit targets that deployed on-receive contract. The manifest records exact
source, contract addresses, constructor arguments, public salts/WASM hashes,
sequence, fee, time bounds and expiration for independent decoding.

All five envelopes have **zero transaction signatures**, source-account authorization
credentials only, no address-authorization signatures, and no memo. They contain no
scoped allowance intent. The factory, deposit, top-up and approval transaction bodies were subsequently signed and
executed during authorized tests. The distribution was simulated only, never signed or
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

The fourth sample is the existing `top_up` capture from pinned Railway testing
revision `b7b92a49f9dbce9e9a3e6d1815690ab0f6958afd`. It targets Streamer
`CB7WSHK5TWPVSZVZ3IPRQHCACRHOIYET3AP43H7CYTTE7Z2O2WIVGMRU`
(deployment `48ce7fa0-5e3a-487c-9b6b-1f9ad1f53c38`) with exactly
1000000 stroops of native XLM. Independent local decoding confirms the source-only
authorization tree contains exactly that `top_up` and one native-SAC
`transfer(source, Streamer, 1000000)`, with no other authorization calls. The
integration orchestrator separately pinned the Streamer's native SAC on-chain at
ledger 5212530 and verified SUCCESS at ledger 5212404 and charged fee 676793
stroops through Testnet Horizon. That receipt is not inferred from envelope bytes;
only the safe public projection is included here. No raw response, application
payload, private receipt or controller state was copied. For this sample, false
raw-response retention flags mean those responses are not included in this packet;
no claim is made about unrelated private instrumentation.

The fifth sample is the existing application approval capture from the same final
revision. Its top-level call and sole source-only authorization root are exactly
native token `approve(owner, spender, 1, 8323016)`, with no authorization
sub-invocations. The token is
`CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` and the
independently pinned subscription spender is
`CCKHNCKLTVSQJXILPH7P4HSHVT6EAJJGAZKUXEZ7NPPQN57JXMFQGPP5`.
The amount is **one stroop**, not one XLM. `8323016` is the token allowance's
expiration ledger; it is distinct from the transaction time bound that expired
at 17:54:59 UTC. This sample was copied into the packet only after that transaction
expiry was independently checked to have elapsed.

The integration orchestrator separately verified Testnet SUCCESS at ledger
5212632, actual fee 2664845 stroops, and a direct RPC allowance read of 1 stroop,
below the 1000000-stroop subscription period. This is historical approval evidence,
not proof of any later subscription charge, current allowance, or lifecycle
completion. Those chain facts are not inferred from unsigned XDR. No raw
simulation/passphrase response, scoped intent, API body, private receipt or
controller state is included; the retention flags describe this packet only.

| Sample                | Maximum envelope fee (stroops) | Actual chain fee charged (stroops) | Successful ledger | Expired at (UTC)    |
| --------------------- | -----------------------------: | ---------------------------------: | ----------------: | ------------------- |
| Factory deployment    |                         981994 |                             851202 |           5211160 | 2026-10-15 15:52:14 |
| Deposit               |                      523953967 |                          455616244 |           5211379 | 2026-10-15 16:10:30 |
| Splitter distribution |                          14784 |                      Not submitted |     Not submitted | 2026-10-15 16:53:12 |
| Streamer top-up       |                         782160 |                             676793 |           5212404 | 2026-10-15 17:36:03 |
| Token approval        |                        3068799 |                            2664845 |           5212632 | 2026-10-15 17:54:59 |

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
state. The top-up test verifies the entire source-only native transfer authorization tree;
the approval test pins the native token, subscription spender, one-stroop amount,
expiration ledger and absence of authorization sub-invocations.
The distribution test additionally parses retained raw simulation fields,
compares assembled resource data/auth entries, and verifies its source/recipient
preflight and absence of an actual chain execution/charged fee. The tests use no
network or database.

This local packet contains **all five** requested real scan examples, including one expressly
read-only actual-builder RPC sample. No external handoff/upload to Lantern occurred. Lantern scanner interpretation, risk labels,
provider compatibility, real handset behavior and wallet-support acceptance remain
unverified. Do not sign or submit these expired historical samples.
