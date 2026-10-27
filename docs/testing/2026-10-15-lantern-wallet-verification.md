# Lantern integration wallet verification, 2026-10-15

This report records desktop Freighter checks for [#983](https://github.com/webnxt-2030/pinkraft/issues/983)
while preparing [#1003](https://github.com/webnxt-2030/pinkraft/issues/1003).
Actual Lantern desktop and Android acceptance remains open. The provisional
desktop adapter is unavailable by default; its fake-provider tests do not establish
the vendor API or a working Lantern connection.

## Environment and boundaries

- Origin: `https://pinkraft.xyz`, Railway **testing**, Stellar **testnet**.
- Integration branch: `lantern-integration`, created from develop
  `4d8453738ac63f0c8a888b1884a9b96a4d24286f`.
- Initial exercised revision: `6b320e717b69878e272871fea1ef08d468ea8298`;
  Railway deployment `c5180c09-aa7b-4bf2-80b5-eceb65e28bc7`, `SUCCESS`.
- Health: HTTP 200, revision `6b320e7`, database, Redis and RPC healthy.
- Browser: Chromium `151.0.7922.34`; real Freighter extension `5.49.0`.
- Dedicated disposable owner and wallet; recovery phrase and private key stayed
  inside Freighter. Credentials, browser profile and raw private instrumentation
  remain ignored local artifacts. This report contains no signed envelopes.
- The testing deployment trigger follows `lantern-integration` with CI gating
  preserved. No develop/staging branch changes or staging environment access.
  No mainnet, fiat off-ramp, release or external Lantern handoff.

The paying wallet is
`GCDF6TFSMWXBK7DGO4AQ4WYBSTS5OHM6S4OJRG7MZ7V34AT2LYSOJNWZ`.
It was freshly funded through Freighter's official testnet Friendbot UI.
The flow uses native XLM, Receive followed by a fixed Splitter, with one
`1000000`-stroop recipient matching that same wallet and no cash-out destination.

## Fresh deployment

The builder and deployment review used the shared wallet picker. The server's
testnet passphrase, source, factory call and two constructor blueprints were
checked before one Freighter approval and one submit request.

- Deployment: `93813830-1825-4ee1-851f-da82d057c5c3`.
- Transaction:
  `2994ae4fce8176ee373d1baf7524504e069c68b259018ec3ab6cf40d3b1e8420`.
- Independent RPC: `SUCCESS`, ledger `5211160`.
- Maximum fee: `981994` stroops (`0.0981994` test XLM); Horizon's actual
  `fee_charged`: `851202` stroops (`0.0851202` test XLM).
- Owner deployment record: `CONFIRMED`, with the expected two-child snapshot.

Navigation interrupted capture of the submit response body. The captured public
transaction hash, independent RPC result and owner record establish the outcome;
no repeat submission was attempted to replace that missing instrumentation.

## Explicit payment rejection

A prepared `deposit(from, 1000000)` was rejected using Freighter's Cancel control.
The unsigned transaction hash was
`401ddfd6272f8c720e041633a090c814eefca7e02df61fd1f7d729597d7d9564`.
Instrumentation observed **zero** trigger-submit requests; an independent chain
lookup returned `NOT_FOUND`. The payment UI returned to an enabled state.

## Fee investigation and bounded exception

The rejected payment quoted about `52.27` test XLM in fees. Read-only RPC and
ledger inspection traced more than 99.7% of that quote to the downstream
Splitter's shared WASM lifetime renewal. Its remaining lifetime was about 43,000
ledgers, below the contract's 50,000-ledger threshold; execution extends code and
instance lifetime to 500,000. A code-only renewal simulation quoted
`521552344` stroops (`52.1552344` test XLM). The Receive code was already above
the renewal threshold.

The orchestrator recorded a one-payment exception: a fresh `0.1` XLM self-payment
may use at most `600000000` stroops (`60` **testnet** XLM) in total quoted fees,
after fresh server, RPC, transaction-body and wallet checks. It uses the disposable
Friendbot wallet, without a relayer maintenance transaction, contract upgrade or
application fee-policy change. This diagnostic exception does not establish an
acceptable mainnet fee. Later actions require fresh quotes and their normal caps.

## Confirmed self-payment and event ingestion

The payment used revision `67402e0ba2f9e822c15b8a9b768b4fecdc2fc226`, after
its full Node/Rust push CI passed and Railway deployment
`954ff9d1-99d4-4780-afdc-57bc1bf5e8c7` reached `SUCCESS`. Public health matched
`67402e0` with database, Redis and RPC healthy. A fresh unsigned preparation and
Freighter's Test Net, account and fee display were checked before one approval.

- Transaction:
  `2f68d076c7521c27506186a1e4a4b1b6036acd8a7d84a93d8d5f884a0cbb29b6`.
- One trigger-submit request; HTTP 200 with `PENDING`, followed by independent
  RPC and Horizon `SUCCESS`, ledger `5211379`.
- Amount: `1000000` stroops (`0.1` XLM), paid back to the source wallet.
- Maximum quoted total fee: `523953967` stroops (`52.3953967` test XLM).
- Actual charged fee: `455616244` stroops (`45.5616244` test XLM).
- Wallet balance: `9999.9148798` to `9954.3532554` test XLM. The exact difference
  equals the actual fee; the separate events establish the self-payment.
- Splitter shared-code expiry: ledger `5254545` to `5711379`, exactly the
  successful ledger plus `500000`. This confirms the renewal diagnosis.

The indexed events for that hash were RECEIVE `deposit` and PAYOUT to the
disposable wallet, both for `1000000` stroops of native XLM. Their unique IDs were
`0022382702372102144-0000000001` and `0022382702372102144-0000000004`.
No separate SPLIT event was emitted or recorded.

Four owner snapshots retained those same two unique event IDs across reloads.
The actual owner page opened its SSE endpoint twice during the check. This proves
stable indexed event ingestion and observed SSE connections; the instrumentation
did not inspect replayed SSE message payloads. There was no second payment.

## Deployment recovery on revision b7b92a49

A fresh future Streamer deployment exercised revision
`b7b92a49f9dbce9e9a3e6d1815690ab0f6958afd`, after full Node/Rust push CI
`38774678282` passed and the pinned testing deployment
`a61555a6-4e89-4d87-b839-05967cc71de9` reached `SUCCESS`. Health matched
`b7b92a4`; database, Redis and RPC were healthy. The transaction used the
same disposable Freighter account, native testnet XLM, one self recipient,
a future start, one occurrence and pause/retrieval enabled.

- Deployment: `48ce7fa0-5e3a-487c-9b6b-1f9ad1f53c38`.
- Transaction:
  `2e413cc5d9c930033d55ffaa905d622562d92e58f067d27c1b23dd8e178f0fa1`.
- Independent public Horizon verification: successful, ledger `5212372`.
- Maximum fee: `792051` stroops; actual charged fee: `685531` stroops
  (`0.0685531` test XLM).
- Owner deployment: `CONFIRMED`; Streamer
  `CB7WSHK5TWPVSZVZ3IPRQHCACRHOIYET3AP43H7CYTTE7Z2O2WIVGMRU`.

A local network guard forwarded exactly one preparation and one submission,
received HTTP 200, and deliberately withheld the submit response from the UI.
Two status reads were temporarily blocked. The matching public hash/deployment
marker survived reload; after the block was released, **Check status** resolved
the confirmed transaction and cleared the marker. No replacement preparation,
second wallet approval or resubmission was used. The private instrumentation
retains public recovery coordinates, without signed envelopes or private keys.

## Streamer funding and pause

On the same `b7b92a49` runtime, the newly deployed future Streamer received
`1000000` stroops (`0.1` test XLM) from the disposable account and was then paused.
Each operation had one preparation, one wallet approval and one submission.
Independent Horizon checks confirmed both outcomes and fee amounts:

| Action                    | Transaction hash                                                   | Ledger    | Maximum fee (stroops) | Actual fee (stroops) |
| ------------------------- | ------------------------------------------------------------------ | --------- | --------------------- | -------------------- |
| `top_up(source, 1000000)` | `4cba2f6a867558e845c1f0e401ee9e0c910b6dbd0790588bb9b902e3a99a2184` | `5212404` | `782160`              | `676793`             |
| `pause()`                 | `b372d3eeb984f01b7e56bd01c3cf4cd7086886d495e0b309d4a2fa791d759dd9` | `5212426` | `8493`                | `3662`               |

The owner API indexed a RECEIVE for the top-up. A subsequent contract-state read
reported `paused: true`, claimable `available: 0` and `retrieveAllowed: true`.
The first retrieval preparation was refused before signing by the normal
`10000000`-stroop total-fee cap. An independently reviewed unsigned-only diagnostic
subsequently quoted `290736907` stroops. It did not deliver a transaction to the
wallet UI or permit submission. Independent code-only lifetime-extension simulation
had quoted about `28.9` test XLM, consistent with shared Streamer WASM renewal.

A separately recorded **single retrieval** exception allowed at most `350000000`
stroops (`35` testnet XLM), hardcoded to this operation, Streamer and method. It
retained the normal ceiling for every other operation and preserved all prior
attempt counters. The expired diagnostic was replaced by one fresh preparation;
Freighter's account, Test Net, no memo and fee display were checked before approval.

- Retrieval hash:
  `0c64f7531c4f0104716e06282c8e85f7ea8be60d395a0d53cfa196cf6df68d02`.
- One fresh preparation, one wallet confirmation, one submit request, HTTP 200;
  independent Horizon success at ledger `5212568`.
- Maximum fee: `291056814` stroops; actual fee: `253094360` stroops
  (`25.309436` test XLM).
- Native Streamer balance became exactly zero. Indexed RETRIEVE event
  `0022387809088258048-0000000001` returned `1000000` stroops to the source.
- Source balance changed from `9954.1166568` to `9928.9072208`: exactly the
  actual fee less the `0.1` XLM refund.
- Streamer shared-code expiry changed from `5246690` to `5712568`, exactly
  success ledger plus `500000`. The empty Streamer remained paused.

The one-operation exception was then disabled. This was Friendbot-funded testnet
diagnosis, without company-relayer maintenance or application fee-policy changes;
it does not establish an acceptable mainnet fee.

## Subscription approval and revocation

The same build deployed an own native-XLM Subscription and Payer at deployment
`281a494d-b237-4e83-9407-7d5d980d217b`, confirmed with the expected snapshot:
Subscription `CCKHNCKLTVSQJXILPH7P4HSHVT6EAJJGAZKUXEZ7NPPQN57JXMFQGPP5`
and Payer `CDNR5KVNPPZ3F7P3MQ6AUZF4HAQHGO4D3FJGTS3T26O3ZNB3UNNFFPDO`.
The disposable account was subscriber and recipient. The period amount was
`1000000` stroops. An allowance of exactly **one stroop** exercised native-token
approval without making a scheduled charge eligible: the cron checks allowance
against the full period amount before preparing a relayer charge.

| Action                                            | Transaction hash                                                   | Success ledger | Maximum fee (stroops) | Actual fee (stroops) |
| ------------------------------------------------- | ------------------------------------------------------------------ | -------------- | --------------------- | -------------------- |
| Deploy Subscription/Payer                         | `4b102364f343223dc9803754ab650f722c3752397dc4d22e4004af4e2be6415e` | `5212592`      | `1179057`             | `1022619`            |
| Native `approve(owner, subscription, 1, 8323016)` | `6dabd461593b301a897807ecc9abf32b7eb3e7b9cfae4ac4a36050608dd8045d` | `5212632`      | `3068799`             | `2664845`            |
| `unsubscribe()`                                   | `17e5aac6cf41375b93d921fb26c29ab646b08273a5de6be4a7bd3f88e9cd4aa3` | `5212644`      | `11527`               | `6602`               |

Each action used one preparation, one real Freighter confirmation and one submit.
Independent Horizon checks confirmed these successes and fee amounts. Direct RPC
reads confirmed allowance **1** after approval, then allowance **0** and cancelled
state after unsubscribe, with unchanged next-charge timestamp. No Subscription
charge or Payer execution was performed. This verifies approval and revocation,
without claiming scheduler or relayer acceptance.

## Final self-payment and batch reconciliation

The final `b7b92a49` operation paid `1000000` native stroops through the existing
Receive/Splitter pipeline to the same disposable account. Transaction
`4f42f05d4c86bfdb421bb57231ae625cb9acc84cc8a13d0450279b5a0ff5de4b`
succeeded at ledger `5212661`, with one preparation, wallet confirmation and
submission. Maximum fee was `17629` stroops; independent Horizon verification
reported actual fee `12469` stroops (`0.0012469` test XLM).

All eight planned operations reached successful finality. Their total actual fees
were `258166881` stroops (`25.8166881` test XLM). The account moved from
`9954.3532554` to independently verified `9928.5365673` test XLM, exactly that
fee total: the Streamer top-up was fully retrieved and the Splitter paid the source
itself. All financial test admission was disabled afterward; the high-fee retrieval
exception is consumed.

Independent public RPC reconciliation at ledger `5212604`/`5212605` confirmed the
Streamer native balance zero, paused state, claimed amount zero, expected admin,
future schedule and renewed code TTL. Independent Subscription reconciliation at
ledger `5212666` confirmed cancelled state, zero native allowance and unchanged
next-charge timestamp equal to its initial start. Public event queries found the
expected cancellation and no Subscription charge. These are testnet checks of
these own fixtures, without relayer or scheduler execution coverage.

## CSP and coverage limits

The exercised builder, deployment review and public trigger paths reported zero
CSP violations in the sanitized capture on revision `6b320e7`. This observation
does not cover other routes, wallets or later revisions.

The follow-up owner event page, public trigger and builder capture on revision
`67402e0` also reported zero CSP violations, using the same browser and extension.

The closing `b7b92a49` browser checkpoint recorded zero CSP violations and no
pending markers in the nine exact recovery keys for these own fixtures, after
reload and without clearing storage. Repeated owner snapshots retained four
unique Splitter event IDs across the two payments and two unique Subscription
event IDs. The final payment had indexed RECEIVE/PAYOUT rows, while the narrow
closing projection did not retain the payout amount. SSE replay payloads were
not inspected. These observations do not establish other wallets or networks.

## Shared picker preflight

A read-only browser check exercised revision
`57bee6bb455dcf5f80894671030627d0c552c8d1`, after push CI passed and Railway
deployment `ecc7e499-274e-4b92-bd76-c83d55d18356` reached `SUCCESS`.
Health matched `57bee6b`; database, Redis and RPC were healthy, with testnet
configuration. The actual deploy picker displayed Freighter and Wallet Connect
as available, and **Lantern (not yet supported)** as **Not available**.
Closing the modal restored the deploy control without selecting a wallet or
creating another prepare, signature or submit. No recovery storage was cleared.
Testnet labels were visible and sanitized CSP capture recorded zero violations.

No Lantern extension or fake provider was installed for this check. The default
constructor's absent provider reader is verified in source/tests; this browser
observation does not establish behavior with an installed Lantern extension.

Unverified gates include actual Lantern extension connect/sign-only behavior,
official Android WalletConnect metadata and a real handset, Lantern scan results,
and same-build LOBSTR/xBull regressions. The five committed offline scan fixtures
are synthetic, expired and explicitly use mocked simulation; they are not evidence
of live Lantern acceptance or delivery to its team.
