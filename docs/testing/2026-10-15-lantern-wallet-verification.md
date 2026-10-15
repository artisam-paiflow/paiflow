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

## CSP and coverage limits

The exercised builder, deployment review and public trigger paths reported zero
CSP violations in the sanitized capture on revision `6b320e7`. This observation
does not cover other routes, wallets or later revisions.

The follow-up owner event page, public trigger and builder capture on revision
`67402e0` also reported zero CSP violations, using the same browser and extension.

Unverified gates include actual Lantern extension connect/sign-only behavior,
official Android WalletConnect metadata and a real handset, Lantern scan results,
and same-build LOBSTR/xBull regressions. The five committed offline scan fixtures
are synthetic, expired and explicitly use mocked simulation; they are not evidence
of live Lantern acceptance or delivery to its team.
