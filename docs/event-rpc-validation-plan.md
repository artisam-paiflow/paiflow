# Event RPC validation plan for hackathon testing

Prepared 6 October 2026 for [#486](https://github.com/webnxt-2030/pinkraft/issues/486).
**Latest result — 7 October: real grouped filtering/routing, same-ledger 100+1
pagination and captured-page PostgreSQL failure/recovery checks passed.**
The [isolated probe continuation](event-probe-deploy-invoke-plan.md) closes the
previously untested 100-event boundary. This does not prove five-page allowance
exhaustion, representative mixed-workload capacity or rollout readiness.
Sandbox remained disabled during the follow-up and probe continuation. Initial
stops and earlier incomplete checks below are historical outcomes; the latest
continuation supersedes their pending page-boundary status.

The user approved execution of this bounded, supervised correctness campaign on
6 October 2026 after discussion of RPC pacing. Deployment, promotion, service
configuration changes and higher budgets remain outside that authorization,
except the user's subsequent approval to enable sandbox temporarily in
`hackathon-testing` for this campaign and restore it afterward.
Its purpose is to validate grouped filtering, SDK emitter routing and same-ledger
pagination through real RPC transport. Representative mixed-workload capacity
and #804 rollout acceptance remain separate.

## Observed environment and revision

Read-only Railway inspection on 6 October confirmed the following active container:

| Item                                  | Observed value                                                                   |
| ------------------------------------- | -------------------------------------------------------------------------------- |
| Railway project                       | `paiflow`, `576ef2f5-16ec-4778-bdef-dca18f14d04b`                                |
| Environment / service                 | `hackathon-testing` / `paiflow-app`                                              |
| Active deployment                     | `23fbf193-fb42-412e-8431-965129b29f02`                                           |
| Active commit                         | `36f46b8b71cd3e0de3962fd33429ea459a8e1e10`                                       |
| Image digest from deployment metadata | `sha256:96c3d9568b4c52cc2e2da0051da84807767522f1fba01b87a5ab806f8149b249`        |
| Network / provider                    | TESTNET / `https://soroban-testnet.stellar.org`                                  |
| Runtime settings                      | TTL maintenance `false`; payroll `false`; off-ramp `false`; relayer channels `0` |

The active deployment ID and full commit were read from the container's Railway
metadata variables. `NEXT_PUBLIC_APP_VERSION` was absent, so that variable cannot
identify this candidate. GitHub's commit comparison confirms the active commit
contains #814's event batching merge, `0e148f786fe3ab99c2c402e8321331306c552bb7`.
It is not the latest `hackathon-staging` revision.

Railway also listed deployment `829a20bb-cf3a-4231-bcca-a88c6b153586`, commit
`2403ce282e9c7baf9f537fe021f8c7454a865ef2`, as WAITING during inspection.
Recheck immediately before execution. Any change of active deployment, image,
provider, network or relevant settings requires the plan to be repinned and
reviewed before submissions. This plan does not approve the waiting deployment.

## Preconditions

1. Obtain separate approval for this campaign and the proposed limits below.
2. Confirm the pinned runtime, one replica, TESTNET passphrase, provider host,
   health and available ledger-retention window. Verify active migrations and
   the deployed event reader's source/artifact correspondence.
3. Inventory existing scheduler/cron activity without changing it. Use no
   relayer-signed operations and do not start a second relayer process.
4. Check the existing DB-selected factory and standard Deposit, Pay and Split
   WASM registrations, ABI, code/instance TTL and asset against chain state.
   Stop if any required registration is missing, expired or incompatible;
   uploading, restoration and shared hash activation need a separate plan.
5. Validate both fixture graphs client-side and server-side. Inspect simulated
   recipient amounts, invocation tree and event sequence before signing.
6. Record the campaign manifest: runtime/image and event-reader hashes, SDK
   version, provider host, owner/deployment/node IDs, snapshot contract addresses,
   template kinds, asset, starting ledger, approved recipients and budgets.
   IDs and addresses are assigned during approved fixture creation; they are not
   existing fixtures or authorization to reuse other deployments.

## Execution preflight on 6 October

The active testing container changed before execution to deployment
`0ea0dfed-e27f-4da6-bb20-94324c36aed0`, commit
`2403ce282e9c7baf9f537fe021f8c7454a865ef2`, image
`sha256:b896c42d188635099f78e0422474f7797a45797d7351841e56a427cc7f639b3a`.
This is the revised candidate for the campaign; the earlier observation above
is retained as history. Review of intervening changes found the scoped
deployment-reconciliation rehearsal preserves the normal confirmation path.
The event-reader source is unchanged by that release, and its SHA-256 matches
the source at the deployed GitHub revision. The local checkout also contains
dashboard invalidation wiring absent from this runtime; live-reader validation
must use the deployed revision.

Six serial read-only RPC requests passed without 429 or provider errors. They
confirmed TESTNET protocol 29, healthy retained history, a live factory instance,
available Deposit/Pay/Split WASM, the native SAC and required factory/template interfaces. DB migrations
and Redis readiness passed. Offline fixture graph validation passed for both
five- and six-contract shapes. These are preflight results, not event-delivery
or capacity evidence.

At that preflight, sandbox and public registration were disabled. No fixture
had been created or funded and no transaction allowance had been reserved.
See [preflight evidence](evidence/event-rpc-preflight-hackathon-testing.json).

## Execution outcome on 6 October

**Stopped with partial evidence; the live #486 validation gate remains incomplete.**
The user subsequently authorized temporary sandbox enablement in testing. The
campaign ran on deployment `52467c5a-6741-4744-9141-950288d05fa3`, commit
`2403ce282e9c7baf9f537fe021f8c7454a865ef2`, image
`sha256:822b2ddabcbba9df3c5f5c337f591976cae3bd9fe74934eac46885ff75cc07da`.
Its deployed event-reader SHA-256 was
`212707ade90134a16ce5fbd039fefd372367148d50938e03fe405938dd67a487`.

Two disposable immutable pipelines were deployed through the normal APIs, and
one `100000`-stroop deposit was submitted through each. Existing app records
confirm all four transactions. Fixture A's eight events matched independent
transaction metadata, persisted emitter/payload routing and Redis/SSE deliveries;
its cursor advanced beyond the payment ledger. Recipient increases were exactly
`65000` and `35000` stroops. The source debit reconciled to the first three
transactions' net fees plus that deposit's principal.

At **13:13:42 UTC**, the client's first `getTransaction` request for fixture B's
payment failed without a captured HTTP status. The client stopped immediately.
No retry, provider fallback, additional transaction or further campaign RPC
diagnostic followed. Read-only inspection of existing app records subsequently
confirmed B at ledger `5053768`; its balances, net fee and event delivery were
not independently verified. No HTTP 429 was observed, but the failure's subtype
was not retained, so this result cannot establish provider ban safety or capacity.

Four signed attempts reserved **1.0522570 test XLM** in maximum fees and
**0.02 test XLM** in principal. Independently known net fees for the first three
transactions total **0.6258112 test XLM**; the last payment's fee is unmeasured.
The request ledger reached a conservative ceiling of **141**, including six
preflight requests and eight measured direct SDK calls. App-internal calls were
reserved using source-reviewed upper bounds rather than measured. Direct client
requests were serial and spaced; app calls retained existing runtime pacing.

Grouped-versus-individual RPC comparisons, same-ledger pagination, the production
100-event page boundary and the local SQL replay were not completed. A successful
five-contract scan alone does not complete the combined live gate.

Sandbox was restored to `false` and verified in successful deployment
`5fe997b5-8a8d-4d4e-903c-c538d29de931`. TESTNET, disabled TTL maintenance,
disabled payroll/off-ramp and zero relayer channels were verified. The client
and SSE connection were closed; its in-memory keys/cookies were released, and
the disposable local PostgreSQL container was removed. Public testnet fixtures
and their app records remain as evidence. No direct live DB changes were made.

See [campaign evidence](evidence/event-rpc-campaign-hackathon-testing.json).
The follow-up below reconciles B's balances/events. Do not resubmit either
already-confirmed payment.

## Authorized follow-up: 6 October UTC / 7 October Hong Kong

The user authorized verifying the second payment and finishing the pagination
checks. The active deployment, commit, provider and event-reader SHA-256 still
matched the restored testing runtime above. Sandbox remained disabled. No new
fixture, signed transaction, fee expenditure or service configuration change
was required.

Independent RPC transaction metadata confirms B's payment succeeded at ledger
`5053768`, with a net fee of `2882526` stroops. Its ten pipeline events matched
the real grouped-filter results. Across both payments, recipient balances rose
by exactly `135000` and `65000` stroops. The source balance and sequence
reconciled to all four transactions, **0.9140638 test XLM in net fees** and
**0.02 test XLM in principal**.

For both fixtures, individual and grouped filters returned identical event IDs
and payloads, and matched independent transaction metadata. SDK emitters routed
correctly; group sizes were `[5]` for A and `[5, 1]` for B. Diagnostic limit-2
paging retrieved each tested ledger without missing or duplicate IDs, over five
pages for each first group. These checks use real provider transport and cursors.

One guarded operator invocation of the unchanged deployed ingestion function,
scoped to B, stored all ten events and advanced the shared cursor through ledger
`5055814`. Stored emitters, decoded kinds/assets/amounts and payloads matched the
independent reference and local replay. No direct event/cursor writes or live
cursor rewinds were used. B's live SSE delivery was not separately observed.

Two local PostgreSQL replay checks passed using the pinned deployed reader and
captured real limit-100 responses. Initial reads stored eight and ten events;
replaying the same range stored zero new rows and published no duplicate events.
Group boundaries and cursor advancement passed. RPC, Redis, email and off-ramp
were mocked only for this isolated SQL replay. An initial harness attempt used
end-ledger-bounded diagnostic responses, whose cursor had not reached the tip;
the reader correctly followed that cursor. The harness was corrected to use
separately captured start-ledger-only responses, without changing reader code.

The follow-up made **31 measured direct RPC reads** and **three measured
ingestion reads**, serially paced with at least one second between completed
requests; ingestion/diagnostic passes were at least one minute apart. No provider
errors or HTTP 429 occurred. The cumulative conservative request ceiling is
**208 of 300**, retaining the original reservations and a 36-request ingestion
allowance rather than replenishing unused budget. The local client and disposable
PostgreSQL container were removed after validation.

**Production page-boundary evidence remains not exercised.** The tested ranges
contain at most nine matching events in a single group and ledger, so even
successful real limit-2 pagination and sparse limit-100 replay cannot validate
the unchanged reader's full 100-event pages or its allowance boundary. No dense
fixture or transaction storm was manufactured. The combined #486 live gate stays
open until an eligible dense fixture supplies that evidence; provider capacity
and representative competing-workload headroom remain separate checks.

See [follow-up evidence](evidence/event-rpc-followup-hackathon-testing.json).

## Disposable fixtures

Use one authenticated test owner and a dedicated test wallet, funded from TESTNET
Friendbot. The owner's key remains in the client wallet; it is never sent to or
stored by the backend. Use two already-funded, tester-controlled recipient
accounts R1 and R2, distinct from each other and the paying wallet. All amounts
are native test XLM; notification settings are Off and payout mode is on-chain.

| Fixture           | Graph and expected payment from one deposit                                                                                                                                                                                                    |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A: five contracts | Deposit → Pay A1 → Pay A2 → Pay A3 → Split A4. Deposit `100000` stroops; each Pay sends `10000` to R1 and forwards its remainder. The terminal Split sends the remaining `70000` 50/50 to R1 and R2. R1 receives `65000`, R2 `35000`.          |
| B: six contracts  | Deposit → Pay B1 → Pay B2 → Pay B3 → Pay B4 → Split B5. Deposit `100000` stroops; each Pay sends `10000` to R1 and forwards its remainder. The terminal Split sends the remaining `60000` 50/50 to R1 and R2. R1 receives `70000`, R2 `30000`. |

Use standard contracts. One outgoing money edge per
nonterminal node avoids Deposit's multi-child funding behavior. The Split has
distinct recipients and basis points `5000 + 5000 = 10000`. Each graph has one
trigger root and at least one action, consistent with [SPEC §3](../SPEC.md#3-block-library).
Confirm these proposed graphs are accepted by the actual deployed validators;
do not change validators or substitute a new contract implementation to make
the rehearsal pass.

Multiple Pay emitters share topic names, and Deposit, Pay and Split provide
different template kinds. Fixture B crosses the five-contract request boundary.
Their nested calls produce multiple events in one transaction and ledger without
parallel transaction sources. Derive exact event counts and ordering from the
approved simulation/confirmed transaction metadata; do not assume one event per
node, since forwarding and token contracts also emit events.

Do not use, fund, renew or mutate the #804 Webhook → Pay recovery fixture. Do not
reuse customer flows or enable subscription, payroll, off-ramp, oracle, scheduled
release, paid TTL maintenance or relayer channels for this campaign.

## Proposed execution and financial limits

| Limit                       | Proposal                                                                                                                                              |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supervised duration         | At most 60 minutes after fixture setup begins; stop rather than extend automatically                                                                  |
| Signed transaction attempts | At most 12 total: up to two factory deployments and ten deposits; failures count                                                                      |
| Envelope fee ceiling        | `5000000` stroops = 0.5 test XLM per transaction, including resource fees                                                                             |
| Campaign fee ceiling        | `60000000` stroops = 6 test XLM in maximum-fee reservations                                                                                           |
| Deposit amount              | `100000` stroops = 0.01 test XLM per payment                                                                                                          |
| Total payment principal     | `1000000` stroops = 0.1 test XLM across all deposits                                                                                                  |
| Source concurrency          | One dedicated user wallet, one unresolved transaction at a time; no relayer use                                                                       |
| Additional provider traffic | At most 300 campaign RPC requests, including SDK-hidden account loads, simulations, submissions, finality, diagnostics and reader calls               |
| Request pacing              | Direct client RPC: one in flight, at least one second after completion; app calls retain runtime pacing; ingestion/diagnostic passes one minute apart |

These are proposed campaign caps, not a verified provider allocation. They are
independent of #804's existing 150-XLM TTL allowance. Friendbot account funding
is not payment principal and does not expand either cap. No fiat or mainnet funds
are involved. Record account balances, reserves and available fee balance first.

Maintain an append-only campaign ledger outside the application's transaction
logs. Before each signing/submission, reserve the assembled envelope's maximum
fee and payment principal, record the unsigned transaction hash, source sequence,
purpose and expiry, and persist that reservation. Refuse an envelope exceeding
any cap. Never release reservations because of refunds, rejection, failure,
timeout or an unknown outcome; count actual fees separately. Reserve principal
conservatively even if a failed transaction moved no money. Do not retry an
unknown hash with a new transaction. No signed XDR or key enters reports/logs.

Deployments exceeding the fee cap in simulation stop the campaign before
submission; raising a cap needs explicit approval. Do not turn on automatic
restoration, retries or fixture cleanup transactions to bypass the limits.

## Test sequence and acceptance

### 1. Grouped filtering and SDK representation

Deploy A and B through the existing authenticated prepare/sign/submit path and
record their durable `pipelineSnapshot`. Submit one serial deposit to each.
Wait for confirmed SUCCESS and record the transaction ledger and events from
transaction metadata as an independent reference.

Within a fixed, retained ledger window containing those transactions, compare
the deduplicated event-ID sets from individual contract filters against the
five-contract filter for A and the two groups for B. Use the SDK version pinned
to the candidate and real provider responses. Keep contract-type filters and
ledger windows identical; use returned cursors without mixing them with start
or end ledgers. Filter later results to the original window if the provider tip
moves while cursor paging.

Pass requires exact set equality and matching contract address, transaction hash,
ledger, topics and values. Confirm the SDK preserves each event's actual emitter
address. Token/SAC events outside the requested pipeline groups must not be
misidentified as pipeline emitters. Provider rejection, retention loss or an
unexpected emitter fails the check; do not silently widen the window/filter.

### 2. Application ingestion and routing

Allow the existing authorized deployment event-reading endpoint and SSE path
to poll the fixtures. Use one viewer and read-only, fixture-scoped DB inspection
to compare rows with the independent reference. An endpoint read can write
events/cursors; this is part of the approved fixture execution.

Pass requires every supported pipeline event to be stored once under the correct
deployment, emitter/node/template, decoded kind, asset and amount. Count any
unsupported decoder event explicitly rather than treating it as stored coverage.
Verify amounts and recipient balances against the expected payment arithmetic,
with sender fees accounted for separately. Replay the same raw RPC range through
the pinned reader in disposable local PostgreSQL to exercise deduplication;
compare with live fixture rows. Do not rewind live cursors or delete live rows
to force replay. Measure confirmation-to-ingestion and ingestion-to-SSE latency.

### 3. Same-ledger pagination through real transport

Use the known fixture transaction ledger and groups with multiple emitted events.
Run diagnostic SDK requests with page limit 2, unchanged filters, and provider
cursors. Ensure at least one ledger spans pages. Compare the complete paginated
set with transaction metadata and the larger-page reference, with no missing or
duplicate IDs. Store these responses as SDK/provider diagnostic evidence only.
Do not feed limit-2 responses into the unchanged production reader: its full-page
test is tied to 100 records, so that substitution would invalidate the coverage
test. Verify production-reader partial coverage and failed-page recovery only
with real 100-record pages in the following subtest. Diagnostic transport failures
may be injected locally after such a real page; do not disrupt the shared service
or provider to test failure behavior.

### 4. Production page boundary evidence

The checked-in reader uses **100 events per page**, **five pages per requested
contract**, and **at most five contracts per group**. Diagnostic limit-2 success
does not validate this boundary.

Prefer an existing, consented disposable pipeline transaction retained by the
same provider with more than 100 matching events in one ledger and one group.
Bound its search to at most ten read requests inside the campaign request cap;
inspect fixture-owned history only. Run the unchanged pinned reader against
that real range with disposable local PostgreSQL and compare with an independent
complete reference. A full final page at the allowance must report partial
coverage and must not advance beyond an incomplete ledger. Repeat to detect
nonprogress, preserving the documented single-contract overflow limitation.

If no eligible dense ledger exists, record this subtest as **not exercised** and
leave #486's combined RPC/chain/pagination gate open. Do not create a transaction
storm, new event-emitter WASM or additional source accounts to manufacture it.
Producing a dense fixture requires a separately reviewed design and budget.

## Stop conditions

- Stop submissions immediately on network/passphrase, deployment/image/provider,
  snapshot, asset, recipient or template-registration mismatch.
- Stop on any provider HTTP 429, 5xx, transport timeout or malformed event/cursor
  response. Record Retry-After; do not automatically retry or switch providers.
  One finality-status read for an already-submitted hash is allowed after at least
  max(60 seconds, Retry-After), within the request cap. Otherwise mark unresolved
  and reconcile separately; never submit another source sequence.
- Stop new work if a transaction has not reached SUCCESS/FAILED within 30 seconds,
  or fails with bad sequence, unexpected auth, restoration or resource errors.
- Stop on incorrect financial results, missing/misrouted events, duplicate rows,
  cursor movement beyond proven safe coverage, or an unexpected recipient balance.
- Stop if a confirmed fixture event remains absent after two normal poll attempts
  at least one minute apart or five minutes after confirmation, whichever comes
  first. Report a failure; do not change cron cadence to catch up.
- Stop on degraded application DB/RPC health, a lost fixture-retention window,
  apparent background backlog growth, or unrelated workload interference.
- Stop before exceeding 12 attempts, 6 test XLM reserved fees, 0.1 test XLM reserved
  principal, 300 RPC requests or 60 minutes. No cap replenishment or auto-extension.

Stopping cancels campaign generators and local diagnostics, not Railway or its
existing schedulers. Retain fixtures and transaction hashes for reconciliation.
Do not delete audit rows, rewrite cursors, restore contracts, change deployment
settings or submit cleanup/refund transactions without separate authorization.

## Evidence and decision

Record a redacted manifest, request timeline and count, provider errors, event-ID
set comparisons, transaction ledgers/hashes/outcomes, fees and reservations,
recipient arithmetic, fixture-scoped DB rows/cursor coverage, replay results and
SSE timing. Hash captured raw event evidence and source artifacts. Do not include
cookies, API tokens, wallet keys, signed XDR or raw authenticated request bodies.

Report each subtest as passed, failed or not exercised with its actual page size
and execution context. Close the combined #486 gate only when grouped filtering,
actual emitter routing and the production page-boundary evidence all meet their
acceptance criteria. A diagnostic pass, preserved overflow limitation or missing
dense fixture must not be reported as complete busy-ledger validation.

Official protocol reference: [Stellar RPC getEvents](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getEvents)
documents the five-contract filter maximum, inclusive starting ledger, opaque
pagination cursor, actual emitter field and event-ID deduplication. Provider
limits and retention are rechecked during campaign preflight.

## Real 100+1 boundary and recovery completed — 7 October 2026

A separately authorized isolated TESTNET probe reused the successfully uploaded
WASM, deployed once and emitted 101 events in ledger 5064061. The Railway testing
deployment/commit, exact reader hash and relevant settings matched the approved
baseline before execution; the post-capture deployment also matched. No Railway
deployment/configuration change or shared WASM registration occurred.

Transaction metadata and an independent limit-200 RPC reference matched the real
limit-100 pages exactly: **100 events followed by 1**. The second cursor reached
RPC tip ledger 5064085. Three isolated PostgreSQL scenarios replayed these captured
pages through the byte-identical pinned deployed reader: normal ingestion,
page-two RPC failure and an actual SQL foreign-key failure. Both failures stored
100 events while holding the cursor at 5064060, before the unfinished event ledger.
Retry stored the final event and advanced to 5064085. Every scenario finished with
101 unique event IDs and 101 publishes; isolated rewind/replay produced zero
additional rows or publishes. Local replay made no external network calls.

The probe topic decodes as generic STATUS_CHANGE. It exercises production paging,
persistence, coverage and duplicate suppression; the earlier real A/B fixtures
supply financial decoding, actual emitter routing and grouped-filter evidence.
The continuation added 23 RPC requests, one Friendbot request, two signed attempts,
197245 reserved fee stroops and 156720 net charged fee stroops. Cumulative accounting
is 273 conservative RPC requests, four funding requests, eight signed attempts and
52211937 reserved fee stroops. Historical 200000-stroop principal is unchanged.
Reservations are never replenished; old consumed execution modes cannot be reused.

See the [execution report](event-probe-deploy-invoke-plan.md),
[continuation summary](evidence/event-rpc-probe-deploy-invoke-hackathon-testing.json),
[exact reference and pages](evidence/event-rpc-probe-pages-hackathon-testing.json)
and [upload prerequisite](evidence/event-rpc-probe-upload-diagnostic-hackathon-testing.json).
The executable local probe and replay harness are outside this evidence-only PR.

This completes the real 100-event page-boundary and captured-page recovery checks.
The pre-existing single-contract overflow/page-allowance limitation remains.
Representative live mixed-workload/headroom validation and the retained workload
publication/review plus #804 rollout handoff remain separate open gates. #486 stays
open; this report does not establish supported capacity or production readiness.
