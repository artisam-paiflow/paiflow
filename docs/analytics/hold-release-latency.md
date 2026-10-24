# Automatic Hold release latency (#1076)

The strict Hold contract prevents early release. Passing the unlock time makes
release eligible; the ordinary scheduler still has to dispatch a worker and
the relayer still has to submit a transaction. Product semantics remain in
[SPEC.md §3](../../SPEC.md#3-block-library).

## October 20 investigation

Read-only Railway HTTP history for deployment
`94010b64-e29e-4812-bdef-b86a1d1eb44f` at source
`4f0fd687d32b98f80d9cfa0c2e0653d3a8ac9d89` retained 20 successful
auto-release calls from 01:45 through 02:04 UTC. Calls continued approximately
once per minute throughout the delayed Hold. This rules out a complete
scheduler-dispatch gap during that sampled interval; HTTP 200 alone does not
prove successful per-contract work.

For Hold deployment `1087d2e7-e9b2-45f7-b8f5-84b5fb49a180`, the worker
logged `auto-release: probe failed` at 01:54:14.904 UTC. Its request lasted
10.074 seconds. The eventual successful release was logged at 02:00:32.740,
matching chain hash
`48e9d06278ef45bf764fc6cbd24abf2612696aa819c26cd0bb6fb54c6e06035b`.
The on-chain unlock was 01:53:07 UTC.

A sanitized boolean check of that exact failed-probe log matched the masked
error indicating that the relayer account was not funded or did not exist.
At the recorded source revision, the initial probe's `loadRelayerAccount`
helper catches every `getAccount` exception and replaces it with that message.
The relayer-source account read in `buildRelayerTx` can produce the same
message before submission. This narrows the failure to a relayer account read,
but does not identify which of those reads failed or distinguish a genuinely
unavailable account from an upstream transport or provider failure. The raw
error and operational credentials are not reproduced here.

The historical code scheduled the first failed probe five minutes after the
probe's start. If this was its first failure, the observed 01:54 request would
make the row due at approximately 01:59:04.8. The 01:59 request completed at
01:59:03.836 (41 ms), before that deadline, so the next eligible minute call
would be 02:00. The retained timeline therefore supports failure backoff plus
minute-boundary timing as a contributor to the observed delay. It does not
establish the underlying provider/account failure, exact historical row state,
or a complete breakdown of worker admission and network time.

## Focused retry change

Only a thrown first probe read failure, before simulation returns and before
any send begins, now schedules a one-minute retry. Contract simulation reverts
and errors after simulation retain their existing five-minute initial backoff.
Repeated failures retain the existing exponential backoff (ten minutes for the
second failure), capped at six hours. Successful release resets the failure
count. This keeps a brief initial read failure from imposing a five-minute
quiet period without shortening uncertain submission/finality recovery.

The isolated PostgreSQL regression injects one initial read failure, dispatches
an ordinary tick just before its retry deadline and the following tick at
119 seconds, and verifies one successful release and no repeat send. It does
not manually change `nextProbeAt`. Separate regressions preserve repeated-fault
backoff and the stored pending hash after an admitted submission loses finality.
Contract early-release and recipient accounting still require the separate
live wallet/chain acceptance; mocked submission is not that evidence.

## Provisional acceptance target

For healthy providers and the bounded fresh baseline plus five concurrent
fixtures, the provisional target is chain confirmation within two minutes of
the integer on-chain unlock. Record unlock, HTTP dispatch, work admission,
submission and ledger close separately. Let normal scheduling run; manual cron
calls or accelerated scheduling do not satisfy natural-release acceptance.
An outage or repeated failing downstream contract can exceed this target;
unknown transaction outcomes remain unresolved. This is not a worst-case
capacity claim or an unrestricted production SLA.

The earlier October 24 fixture released 52 seconds after unlock. That sample
did not explain the October 20 incident or exercise concurrent work. Track
remaining evidence and limits in
[#1076](https://github.com/webnxt-2030/pinkraft/issues/1076).
