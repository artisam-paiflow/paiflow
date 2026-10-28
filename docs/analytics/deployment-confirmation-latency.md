# Deployment confirmation latency (#1079)

Chain finality and the application's stored confirmation are separate observations.
The normal submit request waits for finality; if its acknowledgement or finality
read is unavailable, the deployment remains `SUBMITTED` under the original hash.
Closing or reloading the browser does not stop the scheduled reconciler. At the
October 20 revision below, the owner status route read stored state. Current
`GET /api/deployments/{id}/status` is rate-limited and calls
`reconcileOwnerDeployment` before returning stored status. Its finality read has
a three-second deadline; a verified original-hash result can run deployment
confirmation and outcome bookkeeping. The helper checks ownership-bound signer
evidence, prepared transaction identity and durable pipeline references before
confirming. Missing results and read failures preserve pending uncertainty.

An owner status request can therefore cause recovery and must be recorded as a
confounder when measuring automatic-only reconciliation. Keep deployment pages
closed during that observation and use select-only database snapshots plus
independent chain reads. `GET /api/deployments/{id}` does not call this submitted
deployment reconciler; its `preparedRecovery` check can read chain state for an
expired `PENDING_SIGNATURE` preparation, so it is not a substitute for an
independent database witness. Neither route submits a transaction.

## October 20 investigation

Read-only transaction, database, audit and Railway evidence was reconciled for
deployment `ce0fa1f2-a044-437f-aba1-2701ef909759`, original hash
`a4da9176edaf43928221132ab6756e0abe4c6593bdf900c5b504d47978702000`,
on staging source `4f0fd687d32b98f80d9cfa0c2e0653d3a8ac9d89`.
All times below are October 20, 2026 UTC.

| Observation                                                         | Time         |
| ------------------------------------------------------------------- | ------------ |
| Signed attempt created                                              | 01:11:44.647 |
| RPC acceptance recorded                                             | 01:11:44.993 |
| Chain success, ledger 5287024                                       | 01:11:47     |
| Interactive confirmation warning: RPC unavailable, finality unknown | 01:12:04.956 |
| First and only recorded background check                            | 01:13:01.629 |
| Deployment confirmed in database                                    | 01:13:01.893 |
| Single deployment-confirmation audit                                | 01:13:01.905 |
| Signed outcome confirmed                                            | 01:13:01.927 |

The measured chain-close to database-confirmation delay was **74.893 seconds**;
the ledger timestamp has whole-second resolution. The warning belongs to this
exact hash and identifies the interactive confirmation-read path. It does not
identify the provider's underlying failure or establish that the transaction
was unknown on-chain.

The 01:12 reconciliation HTTP request completed at 01:12:06.308 after 4.139
seconds, giving an approximate dispatch time of 01:12:02.169. At the historical
source revision, acceptance and subsequent unresolved-outcome recording each
scheduled a check 30 seconds later. That 01:12 dispatch was before either
resulting due time. The 01:13 request completed at 01:13:05.858 after 4.253
seconds, consistent with the stored first check and confirmation near its start.
The retained row records `checkAttempts: 1`, the original hash and ledger, and
one confirmation audit.

This sample supports interactive RPC uncertainty followed by confirmation on
the first eligible background tick. Repeated background `NOT_FOUND` backoff did
not cause this sample's delay: it confirmed on its first recorded background
attempt. The retry-policy change below addresses a separately reproduced delay
mechanism, without claiming it caused or would eliminate this historical wait.
No replacement transaction, forced cron invocation or historical-row mutation
was needed to inspect this evidence. Raw errors and credentials are omitted.

## Recent-deployment retry policy

For the first 15 minutes after a signed deployment attempt is recorded, a missing
RPC result schedules another check 60 seconds later. Repeated `NOT_FOUND` reads
do not exponentially postpone these recent deployment checks. Each run retains
its existing row limit, time budget, concurrency claim and deployment selection.
RPC errors also retain the existing minute retry. Successful observations run
the same deployment setup and outcome bookkeeping as interactive confirmation.

After that recent window, the existing exponential backoff remains, capped at
one hour. Missing results past six days stop automatic checks while preserving
the unresolved outcome. No elapsed time or missing response proves failure,
permits rebuilding, or authorizes another transaction. This policy does not
resubmit signed envelopes.

## Acceptance and limits

The provisional target for fresh deployments under the bounded test workload
and healthy providers is database confirmation within two ordinary eligible
reconciliation ticks after chain finality. This is an investigation acceptance
target, not an unrestricted production SLA. It depends on actual scheduler
dispatch, bounded due work, readable RPC history and successful database/setup
work. The 15-minute recent window keeps immediate recovery responsive without
repeatedly prioritizing old unknown hashes.

The isolated PostgreSQL regression advances the clock through four consecutive
minute ticks with missing provider results, checks owner status and replays the
original envelope while pending, then observes finality on the next tick. It
checks the original hash, one send, one confirmation audit, stable pipeline
addresses and webhook setup. It never edits `nextCheckAt` to make the test pass.
These are local provider faults; they do not establish hosted recovery timing.

Before this change, a missing result after four prior checks postponed the next
check by eight minutes. This is a reproduced policy contribution to avoidable
confirmation delay, not proof of the cause of the October 20 incident. That
sample's reconstructed timeline is recorded above; continuous provider-method
timings and the underlying RPC failure remain unknown. Fresh normal-path
observations on October 24 likewise do not prove the delayed path. Keep the
historical investigation explicit in
[#1079](https://github.com/webnxt-2030/pinkraft/issues/1079).
