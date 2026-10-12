# Wallet-control transaction foundation

Issue [#912](https://github.com/webnxt-2030/pinkraft/issues/912) provides internal helpers
for Subscription controls (#913), Schedule controls (#914), and funding (#916).
It does not add a callable control endpoint. Those action issues own eligibility,
capability discovery, request/response documentation, OpenAPI, Postman and testnet examples.

## Preparation

The action handler must use `v1Route`, validate its request and resolve the selected
contract from `pipelineSnapshot`. Check current on-chain controller, subscriber,
permissions and configuration as appropriate; the deployment token grants API access,
not transaction authorization. Customer keys stay in the wallet.

Capture the current RPC ledger **before** building/simulating the transaction. Use
an existing action builder with the required wallet as the transaction source,
`stellarPassphrase()` and finite validity (normally 180 seconds). Builders must
simulate and assemble the transaction before passing its unsigned XDR and captured
`preparationLedger` to `createControlIntent` in `lib/api/v1/control-intent.ts`.
The foundation rejects signed preparation, infinite/past expiry and expiry beyond
five minutes, unsupported operations, wrong action/contract/source and unsupported
authorization credentials. The current source-account credential protocol supports
single-wallet controls; address credentials and fee-bump envelopes fail closed.

Return the unsigned XDR alongside `{ intent, txHash, expiresAt }`. The opaque UUID
identifies a durable preparation; it is not a bearer authorization substitute. The
row binds the exact transaction hash (including Soroban authorization contents),
deployment, server-selected network, action, node, contract and required wallet.
No signed XDR, private key or wallet secret is stored.

A deployment row lock serializes preparation against retirement and concurrent
preparations. One unresolved preparation per node blocks further preparation on that
node, across all actions. The conflict includes the existing `intent` and `txHash`
in `error.fields` so clients can reconcile the existing action. This conservative
policy also serializes future funding requests on a shared node; #916 must account
for that behavior rather than promise concurrent deposits through this protocol.

## Submission and status

The action submit route uses `WalletControlSubmitSchema` and passes the server-selected
action to `submitControlIntent` in `lib/api/v1/control-submission.ts`. Supply an
`assertEligible` callback that checks current domain permissions/configuration before
the first send. The helper checks exact hash, operation and wallet signature before
recording or sending anything. Wallets must sign the returned envelope unchanged.

A locked compare-and-set claims `PREPARED -> SUBMITTING`. The claim, signer history
and audit record commit together. Durable deployment-work admission persists the
transaction hash before the RPC sees bytes. Only the claimant sends: concurrent,
crashed and uncertain retries query the existing status rather than send again.
The helper admits its own work in addition to the route wrapper, so service closure
is rechecked before submission. A crash or bookkeeping failure can leave an
unresolved reservation without sending; it is intentionally reconciled conservatively.

Responses use the existing transaction status shape:
`{ txHash, network, status, ledger?, error? }`. Queued submissions return `PENDING`;
transport uncertainty returns attributable `UNKNOWN`; queue refusals return
`REJECTED`. A refusal does not establish on-chain failure or authorize replacement.
Poll `GET /api/v1/deployments/{id}/transactions/{txHash}` for `SUCCESS` or `FAILED`.
Durable intent outcomes repair both signed transaction history and pending service admission, including after a crash between those writes. Proven expiry uses an exact-intent-verified `CONTROL_EXPIRED` outcome reason and cannot be reopened by delayed queue responses. Durable intent outcomes survive expired RPC history, and concurrent confirmations
cannot be overwritten by a stale lookup. Existing retirement access restrictions
apply; this foundation does not reopen developer access to retired deployments.

## Recovery and safe replacement

Use `reconcileControlIntent(intent, deploymentId, action)` from an authenticated,
rate-limited action handler when explicitly reconciling an existing preparation.
It records ledger-confirmed `SUCCESS`/`FAILED` or proves `EXPIRED` using the existing
allowance finality helper. Action children must expose this adoption/recovery step;
there is no generic reconciliation endpoint in #912.

Expiry requires a closed ledger after `maxTime` and a final `NOT_FOUND` lookup whose
history starts at or before the captured preparation ledger and covers that closed
ledger, with consistent ledger/time metadata. An RPC error, lagging backend or
history gap retains the reservation. A timeout, local clock expiry, `UNKNOWN`,
`REJECTED`, or missing history alone never permits replacement. Even an unsigned
preparation may have been signed and broadcast externally, so abandoned preparations
use the same proof. No automatic cleanup clears financial uncertainty.

Retirement reconciles persisted control evidence internally before consulting RPC, so recovery remains available after deployment tokens are revoked. All unresolved preparations, including abandoned unsigned preparations and queue-refused submissions, block retirement and prevent its event cutoff from being fixed prematurely. Retirement uses the same bounded ledger-proof reconciliation and retains unknown outcomes/history gaps.

After durable `SUCCESS`, `FAILED` or proven `EXPIRED`, a new preparation may be
created subject to current eligibility. Proven expiry is returned through transaction
status as `REJECTED` with `error.code: "EXPIRED"`, and its admitted pending service
transaction is reconciled as rejected. On-chain failure retains its ledger and is
reported as `FAILED`. Expired history without evidence requires verified operational
reconciliation under the deployment retirement runbook; it never grants a retry.

## Verification

Unit coverage exercises representative Subscription/Schedule shapes, funding wallet
binding, altered envelopes, wrong signatures/networks, queue/transport uncertainty,
status attribution and recovery. PostgreSQL tests exercise simultaneous preparations,
concurrent single-claim submission, hash persistence before send, retirement refusal
and durable failed status after RPC history expires. Testnet transactions remain
part of the action-child acceptance and require separately authorized execution.
