# SDK live testnet verification, 2026-10-14

Evidence for #964, continued through 2026-10-15. Completed live groups include
payments, Schedule controls, current-WASM Subscription charge/cancel/reactivate,
early release and refusal, Webhook pool funding/keyed replay/conflict, and positive
packed-SDK Swap quote, and native Webhook execution/replay. Real Swap execution
was withheld at its fee cap; positive demo mint remains disabled. Historical observations below are
dated and superseded by the current results where stated.

The user authorized the testing-only all-WASM registry/fallback refresh and same-
revision service refresh, plus a narrow read-only staging WASM comparison. No
staging writes/branch changes, production/mainnet, release or publication occurred.

## Candidate and environment

- App: `https://pinkraft.xyz`, Railway `testing` environment.
- Current hosted branch/commit: `testing`, `415e0b35a3f9f2853fdbd20ee0a7438483298488`.
- Current verified deployment: `c2d499fc-8299-4c0a-bb61-a0178ac941af`, `SUCCESS`.
- Health after refresh: HTTP 200, app version `415e0b3`, DB/Redis/RPC all `ok`.
- Earlier payment observations used `db3455b12256bb89eafdacdd55a47cba3f5bb9f4`
  and deployment `91d097d6-6d5b-4ca8-b4ca-bf06464e0420`; later sections record
  exact updates and their independently verified CI/runtime.
- Server configuration: `STELLAR_NETWORK=testnet`; deployment review chip
  `TESTNET`; prepared payment passphrase `Test SDF Network ; September 2015`.
- SDK: locally packed, unpublished `@paiflow/sdk@0.1.0`, installed offline into
  a separate private consumer. Integrity:
  `sha512-uotbrEnW53PRqaTzhIVPpSEc3mySpOsv1P7h8613Z3BZc2/TQvARDX90gvX9pbqU59JTL0lYaq6htoHGi7vSow==`.
- Signing: official Freighter 5.49.0 in an isolated Chromium profile, normal
  connection and transaction approval UI, Test Net. No recovery phrase or
  private key was viewed or exported. Credentials and signed envelopes stay
  in restricted, git-ignored private storage. The original temporary profile was
  lost on the scheduled shutdown; replacement artifacts now use persistent local
  `tests/e2e/.auth` storage and are never published.

## Connectivity limitation

On this workstation, Node's automatic address-family selection intermittently
failed with `ETIMEDOUT` for the testing origin. IPv4 curl succeeded while the
resolved NAT64 IPv6 address was unreachable. The rehearsal process uses
`dns.setDefaultResultOrder("ipv4first")` and
`net.setDefaultAutoSelectFamily(false)`, which restored native Node `fetch`.
The SDK and hosted backend were unchanged. The same workstation's Stellar SDK
Horizon client failed to connect; Playwright's read-only Horizon request and
independent Stellar testnet RPC reads succeeded. Financial evidence below uses
RPC ledger entries and finality, not an assumed account balance.

## First isolated native payment

- Owner-created flow: `75911dd7-d910-4d1d-a444-af4f762e37dd`.
- Graph: native `on_receive` → native `pay`, `fullAmount=true`; recipient is the
  throwaway paying wallet, avoiding changes to shared recipient accounts.
- Public wallet: `GB53QGP5S3O4A4WD4KEWNC3VNXPROFLEIDVBDAMYE7UDLQAY7CJ5C53J`.
- Friendbot funding succeeded:
  `c1c75594c8d405e8d0a9588f04bf04d37f982e08ab4d02030c77c1637c36124c`.
  Friendbot faucet funding is separate from deliberate payment outlays.
- Paiflow deployment: `76e18ae1-825d-4b20-b4e2-7ec6cb4d290a`, `CONFIRMED`.
- Deployment hash:
  `2e3bf0747b88f62f7bc6aa59bede074edc231cb84de7b973b327bce1146e554e`;
  independent RPC `SUCCESS`, ledger `5184651`.
- Trigger: `CDNZKNFCLJR4VFRJGNK63ADOHOCRY7AR6JRKV6H4UZIS36N2EL3ECBAS`.
- Payer: `CCPJRA6Z5CBSX4SCZWL253MU6HE42FH7HD3PL33OI7753WENSSQJAQG5`.

Packed SDK reads returned HTTP 200: capabilities identify testnet and supported
execute; balances are fresh and complete with zero contract balance; events
initially empty; OpenAPI is version `1.0.0` with 33 paths; public embed activity
and bounded event pagination succeed. These results claim only this deployment's
actual supported surfaces.

The SDK prepared `1000000` stroops (0.1 XLM), signing used its exact server
passphrase, and unsigned/signed transaction-body hashes matched before one
submission. No write retry or replacement preparation occurred.

- Payment hash:
  `ae2c3fc177466d2efdc62b3a56028c8f3fe4f443f1624d16db1ba33c1507666a`.
- `execute.submit(wait=true)`: HTTP 200, `SUCCESS`, ledger `5184751`.
- SDK `transactions.get` and independent RPC both report `SUCCESS` at that ledger.
- Same-hash indexed `RECEIVE` event: `deposit`, from the public wallet, XLM,
  amount `1000000`.
- Same-hash indexed `PAYOUT` event: `pay`, recipient the public wallet, XLM,
  payment `1000000`.
- RPC wallet balance before: `99999270953` stroops, ledger `5184711`.
  After: `99997927724` stroops, ledger `5184757`. Since payer and recipient are
  the same wallet, its net decrease represents transaction costs; matching
  receive/payout events establish the payout separately.

## Further live evidence

### Public payment and wallet rejection

The packed SDK prepared another `1000000` stroops payment. Freighter Cancel
returned `PaiflowSigningError`, with no submission. Signing was then requested
again for the same original preparation within its transaction time bounds,
approved through Freighter, and verified by matching transaction-body hashes.

- Hash: `e66fce6123f2007de169261148cb01ce017634c9d3bc201af74cc8ef96f007d4`.
- Public submit: HTTP 200, `PENDING`; public status: HTTP 200, `SUCCESS`.
- SDK deployment-bound receipt and independent RPC: `SUCCESS`, ledger `5184787`.
- Same-hash `RECEIVE` and `PAYOUT`: XLM `1000000`, payer and recipient the
  throwaway public wallet. Both payment receipts were checked programmatically
  against the expected amount, wallet, asset, hash and success status.
- One public SSE connection returned HTTP 200 `connected` and `snapshot`, the
  snapshot containing four indexed events. Iteration stopped after two messages
  and closed the connection.

### Schedule fixture and blocking public-route mismatch

- Isolated flow: `ffae53fd-5453-4c8f-b46d-5b2626aca959`.
- Graph: native Schedule, starts `2026-10-15T03:00:00Z` (strictly future at
  preparation), daily interval, three occurrences, pause/retrieve enabled;
  fixed `1000000`-stroop Pay to the throwaway wallet.
- Confirmed deployment: `d7de09c6-696f-4642-a4de-0ee7c43432d9`.
- Streamer: `CCYOW3ZPY2LV6FS4GB47NXYJTYDHNS7U3OLHCOMRQWX7LHIELJYV7C6O`.
- Deployment hash:
  `22d599cff42e34ab119d2bc0240ee5ce56ee0b2972fd7cdcbaa10d225cec9499`.
- SDK capabilities, funding discovery and authenticated Schedule state return
  HTTP 200. State is unpaused, pause/retrieve allowed, zero balance/availability,
  controller and retrieval recipient the throwaway wallet. No funding was
  prepared, signed or submitted.

**Blocked:** `publicSchedule.get()` returns HTTP 401 `UNAUTHENTICATED`,
`Authentication required`, request ID `mv7jg9er-1twriw`. A separate anonymous
HTTP read reproduces 401 (request ID `mv7jh96l-fvcrgr`), whereas the owner browser
session reads HTTP 200 `{paused:false,available:"0",retrieveAllowed:true}`.

The route `app/api/deployments/[id]/streamer-state/route.ts` declares
`deploymentServiceRoute(GETHandler, "public")`, and the SDK contract explicitly
documents it as public. However, `middleware.ts` omits `streamer-state` from
`PUBLIC_PATHS`, so unauthenticated SDK requests fail before the public handler.
The SDK intentionally omits browser cookies. This requires a separately
authorized resolution; neither backend nor SDK authentication was bypassed.
All live writes stopped on discovery. The Schedule fixture remained unfunded
until the user-authorized fix reached testing.

### Public-route fix and resumed Schedule batch

After independently reviewed fixes #977/#979 and passing full Node/Rust CI,
testing served commit `415e0b35a3f9f2853fdbd20ee0a7438483298488` (Railway
deployment `a4959888-da85-4faf-9185-d8d205b53f75`). The same packed SDK
`publicSchedule.get()` returned HTTP 200, request ID `mv7rh33h-oelana`, with
`paused:false`, `available:"0"`, `retrieveAllowed:true`. No cookie workaround
was used. The SDK package remained unchanged.

The existing strictly future Schedule was funded with 1 XLM. Funding returned
`PENDING`; reconciling the original intent returned `SUCCESS`, independently
confirmed by RPC at ledger `5187548`. State showed `10000000` stroops balance,
zero available/claimed and the entire balance unvested.

| Operation   | Transaction hash                                                   | RPC success ledger |
| ----------- | ------------------------------------------------------------------ | ------------------ |
| Funding     | `f1980595ad988f2704e7c46e01e37d99159d0fbdfb8ea015c97f9a70acdb8f42` | 5187548            |
| Pause       | `ac8aa7cba1d06c64e3b3a1a40f2d357faa073adeadc55f749fcfdaa347a3d9d4` | 5187565            |
| Resume      | `bb4e51d481d5d62d3ebb6726fba518270dd41febcaa79cd1a24928c686bd67c1` | 5187582            |
| Pause again | `63a8acb77694dd5472d99c9f7379fcf145055b0e485f682dc930a9b587554493` | 5187590            |
| Retrieve    | `f23e295108e9ef0e3c03b7ee6b7cf14b1b85f21feb6b1253f2aa4212c8b30764` | 5187598            |

Every control used Freighter consent and matching original/signed body hashes;
its original intent reconciled to `SUCCESS`. An early resume preparation was
correctly refused with 409 while pause reconciliation still reported
`SUBMITTING`, `replacementAllowed:false`. Reconciling the original pause to
success allowed the explicit resume preparation; no replacement or repeated
submission occurred.

Indexed events matched all operation hashes, including 1 XLM `RECEIVE` funding
and `RETRIEVE` of `10000000` stroops. Final authenticated and public state show
`paused:true`, zero balance/available/unvested/retrievable; the Schedule is
drained before its first scheduled release.

### Subscription allowance and unobserved automatic charge

- Isolated flow: `3d499cc6-fd1b-4133-9fc2-47c58fa9ff5f`.
- Deployment: `e476fa10-99ae-4b3f-9d3b-04174671573e`.
- Native asset, throwaway wallet subscriber/recipient, `1000000` stroops per
  daily charge, three occurrences.
- Subscription: `CC2AQFHPMC3KMJY5PLFWVO3E3AEJOECHB5VLH7DM46BF36ZGWDRC7K5H`.
- Payer: `CCWI7YMEXHFLLUQKJABAYLMMD7RPOFHLZUA7PDQ3ET2UZPUUVMTKNHJ7`.
- Deployment hash:
  `ca87289bccca8a2c4982595084341caf21e60f29023e273b3178cb3aab959a27`.

Authenticated state and public allowance reads succeeded with allowance zero.
The SDK prepared a 1 XLM allowance, signing explicitly used the observed
subscriber state and normal Freighter consent, and exact transaction-body hashes
matched before one submission. Public submission returned `PENDING`, subsequent
public status and independent RPC returned `SUCCESS`, ledger `5187638`.

- Allowance hash:
  `b98bbd833dd7b994dce5814a81e3007b0540834efc624d0d3da728dd8a740d33`.
- Authenticated state confirmed allowance `10000000` stroops.
- Indexed `ALLOWANCE` event matched the wallet, subscription spender, XLM and
  exact allowance.
- Ordinary relayer configuration was `PLATFORM`, first charge due
  `2026-10-14T07:08:12Z`. No scheduler/backend configuration or cron request was
  changed or forced.
- Observation through `2026-10-14T07:15:47Z`, over six minutes after allowance
  finality, showed unchanged allowance and no charge or payout events. Automatic
  charge/payout remains unverified.

A cancellation was prepared, but automated approval review rejected executing
the cancellation/reactivation batch because the prerequisite automatic charge
had not been observed. No cancellation was signed or submitted and no
reactivation was prepared. Writes stopped; the subscription remains active with
the 1 XLM allowance. Resolving this approval block requires an explicit decision.

### Public utilities and conditional refusals

Explicit SDK demo-token creation returned 403 `FORBIDDEN`: the demo API is not
enabled on testing. No demo token or shared financial operation was created.
Calling a swap quote on the ordinary receive/pay deployment correctly returned
422 `VALIDATION`, no supported deployed Swap node. These are refusal-contract
checks, not positive demo or quote verification.

### Historical pending list — superseded by October 15 results

Subscription actual charge/payout and controls; Webhook funding/callback
idempotency/native authorization; early release; positive swap quotes. Schedule
funding/control/reconciliation and payment/public read/SSE evidence above do not
establish support for those remaining workflows.

## Resumed preparation and old-fixture retirement

Read-only preflight and authorized recovery/cleanup resumed on 2026-10-14,
completed before 13:55:35 UTC. User explicitly authorized a scoped testing-admin
bootstrap exception, old-fixture service retirement, and manual testing cron
calls when needed. No external timer was configured or cron invoked in this batch.

- Fresh health: version `415e0b3`, DB/Redis/RPC `ok`. Railway's latest successful
  testing deployment remains `a4959888-da85-4faf-9185-d8d205b53f75`, commit
  `415e0b35a3f9f2853fdbd20ee0a7438483298488`.
- Container identity matched project `576ef2f5-16ec-4778-bdef-dca18f14d04b`,
  environment `881ead44-6cfc-4249-97dd-492b9f5e2c53`, service
  `78c1d697-51be-4bf4-ab21-e79b240b162c`, and `STELLAR_NETWORK=testnet`.
- Independently reviewed create-only bootstrap created one ADMIN/INTERNAL user
  and an atomic `ADMIN_USER_CREATE` audit record, without reseeding templates or
  overwriting existing users. Reviewed bootstrap SHA-256:
  `33de3efdcba4a6a42f766edfd879634bb7939d82e2980573dbfc1161276af225`.
- Supported admin password-reset API recovered the existing USER/INTERNAL test
  owner. Owner login and ownership-scoped retirement reads succeeded. Newly
  generated credentials are stored in restricted, persistent, git-ignored local
  storage; none are recorded here.
- Immediately before retirement, the old Subscription was ACTIVE/CONFIRMED,
  PLATFORM, due at `2026-10-14T07:08:12Z`. Public testnet state remained
  uncancelled with allowance `10000000` stroops. The owner deployment read showed
  the original ALLOWANCE event and no indexed CHARGE/PAYOUT events; this is an
  indexed observation, not independent proof that no chain charge occurred.
- Authorized owner `POST /api/deployments/e476fa10-99ae-4b3f-9d3b-04174671573e/retirement`
  returned `serviceState: RETIRED`, `retirementBlocker: null`. Paiflow servicing
  ended. The contract and on-chain allowance were not cancelled or revoked.
- Filtered testing HTTP logs returned no Subscription cron requests in the
  queried preceding 24-hour window. User confirmed testing has no configured
  cron job. This does not establish automatic scheduling.
- After retirement, a read-only query matching the Subscription cron's candidate
  filter returned zero eligible deployments. The cron secret is configured;
  its value was neither displayed nor stored in the evidence.

Future manual cron calls establish handler execution and charge behavior, not
unattended scheduler availability. Remaining live SDK gates above are still open.

### Replacement harness review blocker

The packed consumer artifact reproduced the original integrity exactly. A fresh
persistent Freighter profile and wallet were prepared through normal UI, without
viewing or exporting recovery words or keys. Public wallet:
`GATA3FUI5NPFDGWHC42LTPKC4P3YIAKLOJKIPCWOP5XJMTFSVYFB6MGS`.
Official wallet API confirms TESTNET and its exact network passphrase. Friendbot
funding hash `9af10fe97c81894be1c3bbc7c829f264c55310ce00eeac3eb6347abfeb6f02d3`
independently reached RPC SUCCESS at ledger `5192592`; Horizon confirmed the
account and faucet-funded balance `10000.0000000` XLM. No application transaction
or wallet signature was performed in this preparation batch.

Independent exact-file review of the prepared Subscription harness, SHA-256
`3e0c7427906f402fa6744c07dc5473d1848d123b70acafaa0bdf10ef07703968`,
found that its control reconciliation journal would include the opaque `intent`
field. This violates the harness's public-facts-only journal boundary. The harness
has not executed any fixture creation, deployment, approval or control operation;
no such intent was written. Financial testing stopped for explicit remediation
authorization under the existing orchestration rule. Proposed correction: select
public reconciliation fields, omit `intent`, and independently review the revised
file before execution.

A separate guarded manual-cron runner passed independent review, SHA-256
`c9d6d92a861842d88d5cb6efaa740a0946bb35e0a7cc2540fc8776c7912d8102`.
It has not invoked cron. Its candidate snapshot is not atomic with the endpoint's
query; global testing-cron authorization still governs any call.

### Authorized journal correction and fresh Subscription charge

User authorized omitting the opaque intent. The corrected harness, SHA-256
`4bc21df2a77eaeb677ffb39361e3cf8ed1090ba474ba374c4aa821cb2cd30b05`,
passed independent exact-file re-review, syntax, and an offline projection check.

- Fresh flow `9976ece2-55f9-455f-91de-205b39d1c364`, deployment
  `7b20302c-43df-46a0-a632-d88b0f29525f`; 0.1 XLM daily, three occurrences,
  subscriber and recipient the replacement wallet above.
- Deployment hash `89d87134bac7e482f422a13f719ffcc426e04f35c473bc746906d444f9998d52`,
  RPC SUCCESS ledger `5193028`, app CONFIRMED.
- 1 XLM allowance hash `c296577a97ca4dd598a9cf25ecb3e54f29dff63e1d802b46b6f1266ec4fd0696`,
  RPC SUCCESS ledger `5193044`; public SDK status SUCCESS. Normal Freighter UI
  signing preserved each original prepared transaction-body hash.
- Guarded preflight returned exactly one eligible INTERNAL deployment. One
  authorized manual testing cron POST returned HTTP 200, `platformCharged:1`,
  `failed:0`, `skipped:0`, `truncated:false`. No external timer was configured.
- Charge hash `382a3bef7e3322b941e8a262c6fea209464058c0537dd8e30242bd00edd929ab`,
  independent RPC SUCCESS and deployment-bound SDK receipt SUCCESS at ledger
  `5193054`. Same-hash RECEIVE/charge and PAYOUT/pay events match `1000000`
  stroops and the exact replacement wallet. Their normalized asset is `XLM`.
- Allowance decreased to `9000000` stroops. Subscription remains uncancelled;
  next charge is `2026-10-15T14:37:31Z`. Controls and zero-allowance cleanup have
  not been prepared or submitted.

The harness's `verify-charge` payout predicate incorrectly expected the native
token contract address where ingestion deliberately normalizes it to `XLM`.
The read-only verification stopped with an assertion. Independent source review
confirmed the harness mismatch and proposed binding current native/testnet state
to the independently derived native contract address, then comparing the event
asset with its `XLM` label. Financial work stopped pending explicit remediation
authorization; no charge call was retried and no controls were executed.

User scheduled workstation shutdown at `2026-10-14T17:37:46Z` (October 15,
01:37:46 HKT) and instructed cleanup to begin 30 minutes before, at
`2026-10-14T17:07:46Z` (01:07:46 HKT). Persistent private storage retains the new
profile, credentials and journals for continuation; none are published here.

## October 15 recovery, asset correction, and deployed-WASM blocker

The workstation shutdown removed `/tmp` tooling; the restricted persistent wallet
profile, credentials, packed consumer and journals survived. One browser was
restored using the same wallet. Official Freighter API again verified its exact
public address and TESTNET passphrase. Fresh testing health and Railway metadata
still identify commit `415e0b35`, deployment `a4959888-da85-4faf-9185-d8d205b53f75`.
The previous shutdown deadline has passed; this section records the new user-
authorized resumption, not work claimed to have happened during shutdown.

User authorized the native-asset assertion correction. The prior harness was
reconstructed byte-for-byte, reproducing `4bc21df2a77eaeb677ffb39361e3cf8ed1090ba474ba374c4aa821cb2cd30b05`.
The corrected persistent harness SHA-256
`2fea08eb01590a7af4df77d7477e5e8e9dcb937cc79b4f10903dfb38c15142f0`
passed independent exact-file review, syntax and offline adversarial checks.
Read-only verification of the original charge then passed; no charge was repeated.

The SDK cancellation was prepared, signed through normal Freighter UI, and
submitted exactly once. Its original transaction body hash was preserved:
`649c4fc2ca362effa02fadada87ebb82a957d4642f6e501432a46fe2f60ee5db`.
RPC reports FAILED at ledger `5200135`, `txFailed` /
`invokeHostFunctionTrapped`. Error-only diagnostics identify
`Auth/InvalidAction`, unauthorized nested token `approve`.

Independent inspection found the prepared authorization tree contains
`approve(wallet, subscription, 0, 5200128)`. Execution occurred on a later ledger.
Current source, fixed in commit `5daf857b`, uses stable zero expiration to avoid
ledger-dependent authorization arguments. Thus the failed live fixture exhibits
the earlier behavior despite the application running current source.

- On-chain Subscription WASM hash:
  `1d9d2f5f4ae558b48c3701f1dc4c332b5fe318104c993dd6a400597b49d07221`.
- Read-only query of the explicitly pinned testing environment's
  SUBSCRIPTION/testnet template returned that same old hash.
- A local locked offline release build of the fixed current Subscription source
  succeeded. Its WASM SHA-256 is
  `3e81ff413c6fe81d90c9b6b2f496b3b45ac01ebe6b9d7410a957fbd976a7d25b`.
  No WASM upload or registry change was performed.
- Original cancellation intent reconciled to FAILED, ledger `5200135`,
  `replacementAllowed:true`. No replacement was prepared. Fresh public SDK state
  remains testnet, uncancelled, allowance `9000000` stroops.

Financial testing stopped for explicit remediation authorization. Proposed work:
upload the fixed Subscription WASM to testnet, sync only the testing Subscription
template, revoke the current fixture's allowance directly through its wallet,
retire its Paiflow service, and deploy a fresh fixture for controls. Existing
Subscription contracts have no upgrade entry point. Reactivation/final cancellation
and direct revocation were not attempted. Staging remains untouched.

### Authorized refresh of every testing WASM template

User authorized updating testing to use all current WASMs. Two independent locked
offline release builds of all 21 workspace crates produced identical artifacts
at source commit `415e0b35a3f9f2853fdbd20ee0a7438483298488`. Exact-head full Node
and Rust CI was independently verified successful in run `38524222415`.

All 21 compiled code hashes and code bytes were already present on testnet.
Six testing registry entries had drifted: PAYER, PAYROLL, SPLITTER, SUBSCRIPTION,
SUBSCRIPTION_DEV and WEBHOOK. The deployed factory executable already matched
the current factory build, `3020bb44c41e358412e61565e0a132b16136b4414fc187afa628b968e6480023`.
No WASM upload or factory deployment was needed.

Independent exact-file review approved manifest
`a70cf5638f2b8bc190d531a334b0ad988561907729325594b55053c55402a97b`,
atomic registry-sync script
`d0b3dc469256792d58cdb314e4486bbfac968ecee8eb1874aea639efda8fb3bc`,
and pinned orchestration controller
`fc7368f6c8eb286fe9b5ddf003d65d23677a3d4323a8b1b90c024fb9a7c624c9`.

The guarded serializable registry sync succeeded: six WASM hashes changed, all
21 were verified against on-chain bytes, every stored ABI and upload timestamp
was preserved, and `CONTRACT_WASM_SYNC` was committed in the same transaction.
The current factory address
`CBFZTEZZN2M7PV3LHM5TSHO6K45RDKT4ICX2YUNWRX6RXWVIOJ3KZJNK`
was preserved; its previously null hash metadata was filled with the verified
factory hash. Only the explicitly pinned testing Railway environment was written.

The 21 public TESTNET WASM fallback variables and unchanged factory-address
fallback were synchronized with automatic deploys deferred. A controlled refresh
of the verified existing testing revision was then requested, deployment
`c2d499fc-8299-4c0a-bb61-a0178ac941af`, SUCCESS. Fresh public health is `ok`,
version `415e0b3`, DB/Redis/RPC `ok`. This refresh was needed because the
application caches factory addresses and hashes for its process lifetime.

Independent postverification on that exact fresh deployment passed: pinned
testing IDs, exact commit/testnet, all 21 registry hashes and preserved ABIs,
all 22 public runtime fallback values, unchanged factory address and current
factory hash metadata. Audit row `4e0132f0-518b-4342-8f2a-1f6d0f1e77ac` records
the exact six changes, source head and factory metadata in the atomic sync.

Existing child contracts retain their code. The old failed Subscription fixture
has not been upgraded, retired, cancelled or revoked by this configuration change.
No staging environment or staging branch operation was performed.

### Fresh current-WASM functional fixture and cron-tool blocker

An independently reviewed functional harness, SHA-256
`fc2c8620ba59a0b86704cac9561770f1e14be4aa6dcb36a437605bc8c7dfc667`,
isolates the new fixture from every old transaction marker. It verifies deployed
Subscription/Payer executable hashes before allowing an approval and checks
cancellation's nested token approval uses stable amount/expiration `0/0` before
any cancellation signature. No cancellation was yet prepared for this fixture.

- New flow `9595d813-d035-483e-9926-e4f15834fd78`, deployment
  `88469dfb-a8db-4dd3-a8f2-9f773a9b56a7`; native 0.1 XLM daily, three
  occurrences, controlled replacement wallet as subscriber and recipient.
- Deployment hash `8efc0e156c8db2ca0eb212a0b2e8dc7ec1ac8c0a7ef78917e85f4ce73b7f1066`,
  RPC SUCCESS ledger `5200547`, app CONFIRMED.
- Independent instance reads verified Subscription
  `CCZNBILLHBIF6ECFD5X5U3GF7AZ4AHMLUBCBX2TJLBF2J47FVT3ZTRVB`
  runs `3e81ff413c6fe81d90c9b6b2f496b3b45ac01ebe6b9d7410a957fbd976a7d25b`;
  Payer `CA3YJIPVW6XRB44772QCC3MUISIPRPNGPNVNOC6ACZ5P7PWMJKNULJ7R`
  runs `b331db1c3e26da4fe8aec7635a567a11fb5e069123c355eaae92d095d5ef457f`.
  Thus a real fresh deployment selected the refreshed runtime templates.
- 1 XLM approval hash `ce7811ef98d2a4b31b7e1a77554596e4f93001e0623f4d42e4ddf22085252937`,
  RPC SUCCESS ledger `5200569`, packed SDK public status SUCCESS.

The old temporary cron tool was lost on shutdown. Its equivalent replacement TS,
SHA-256 `a171c131a00fb4bae897afbeabecbd1cadb5520a778f4826193724c095fdaffe`,
passed typecheck and eligibility checks, but independent review found wrapper
`b2cfeeacfcacc73551377c1340f4e96296f859947cef881994759e6822dde2cc`
places it in `/tmp`, where app packages cannot resolve. A read-only inspector
stopped; independent import-only reproduction and a selected public runtime
resolution check confirmed packages resolve from `/app`, not `/tmp`.
No cron POST, charge, replacement preparation or control transaction was made
by that tool. Its inspector creates no financial-attempt marker. Proposed local
correction is an `/app` script path plus explicit `/app/tsconfig.json`, followed
by exact-file re-review and read-only inspection. Follow-up financial work is
stopped pending explicit remediation authorization. The requested all-WASM
testing configuration refresh itself is complete.

### Authorized local runner correction and read-only staging comparison

User authorized the runner path correction. Frozen wrapper SHA-256
`fecd6a526242dff392815174bc064fdbe7339cb1c1c31934af236d6e565bc082`
passed independent exact-file review. Its only changes are the `/app` script
destination and explicit `/app/tsconfig.json`. Financial gates and TypeScript
SHA-256 `a171c131a00fb4bae897afbeabecbd1cadb5520a778f4826193724c095fdaffe`
remain unchanged. Read-only inspection succeeded: testing/testnet/version
`415e0b3`, exactly one eligible fixture
`88469dfb-a8db-4dd3-a8f2-9f773a9b56a7`, PLATFORM, next charge at
`2026-10-15T01:05:23Z`. No cron POST was attempted. The runner's existing
1,800-second freshness bound has elapsed; it was not loosened. Financial
verification remains paused at that guard, with no charge/control attempt made
for the fresh fixture.

User then explicitly authorized a subagent to inspect staging for older WASMs.
This is a narrow read-only exception to the prior staging-access prohibition;
staging mutation and staging branch/source access remain unauthorized. The
inspection used explicit environment/service IDs, selected public configuration
fields and public testnet factory reads only. No secrets were displayed or saved.

Compared with the verified testing build at `415e0b35`, staging has two older
configured template hashes:

| Kind             | Staging configured hash                                            | Current testing build hash                                         |
| ---------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| PAYROLL          | `055bb5c94bc0dac259f08a6adc97e9305fbf901d5facbdcbbedf799810f474bd` | `07c9795d139b52dea74bcb530020b93882e3a2202b0cb24664156eca6b761a84` |
| SUBSCRIPTION_DEV | `100399b3f899be056e0e5c22d7ecafd3104c65d6a94215a864299807f0042fcd` | `4c7c6eafc5f3c0f2809bfbb71cafb9d9b12de358421010dd7993f7dfc2bb98c0` |

The other 19 registry entries match the reference build. Staging actually runs
testnet at revision `9ae4172227e083d18244781c672e368d8efa43b3`, deployment
`77f08b59-0ed6-4cf1-808e-9e0b1e71693b`. Its configured factory has the same
current executable hash, independently read at ledger `5200957`.
The older SWAPPER environment fallback is superseded by its matching DB row.
Existing deployed pipeline executables and running-process caches were not
inspected. Staging was not changed; the comparison does not claim which WASMs
every historical staging deployment executes.

### Standing autonomy and resumed bounded verification — 2026-10-15

User explicitly approved replacing the stop-on-every-blocker rule with standing
permission for routine reversible diagnosis, fixes, tests, delegation and review,
plus previously authorized testing actions within existing spending limits. Root
saved it in repository guidance and ignored local memory; independent review
passed. Material scope/risk changes still require approval; no staging writes,
production/mainnet, publication or increased budget are authorized. Substantial
work is grouped across implementation, independent review and next-scenario agents.

The Subscription runner now binds to the immutable original start, one-day
interval, three-period end and no prior charge; verifies on-chain next charge is
exactly the first installment; and requires 120 seconds before the next period.
It preserves the exact native amount, allowance, wallet, sole-eligible deployment,
final candidate recheck, once-only markers and original-outcome reconciliation.
This replaces the arbitrary 1,800-second test freshness limit without permitting
catch-up charges. Independent review approved TypeScript SHA-256
`43a446a3ab0a9ab62e5ca4a8bbd2453424ef50a69228ff908f66dae9c51f9bc4`
and wrapper `0fd48883f53e17ae48264406f6274501ed44f96a844af93d76f0f4e18ef84d33`.
Read-only readiness reconfirmed the sole eligible fixture and 1 XLM allowance.
One authorized manual cron invocation has now started; outcome is pending below.

The independently reviewed early-release harness funded a new TIMELOCK_BRANCH
fixture with 0.1 XLM. Funding hash
`dd2264d9c8a37c33075e99224a0764a2e8326c72c8f023fd9b8725e01099e551`
was SUCCESS at ledger `5201504`, matching RECEIVE events and held balance.
One SDK early-release call returned hash
`3007820191ce33c9c25324b935a241d3e069e31e5b6a93273518fd40e4871a84`,
ledger `5201510`; RPC/SDK receipt and before-branch/PAYOUT checks passed.
The harness then stopped because the after-balance endpoint reused the before-read
cache timestamp/value. No release retry was attempted. A separate read-only
reconciliation of the original transaction and refreshed actual balance is underway.

### Updated Subscription and early-release results

The single guarded cron POST completed with `platformCharged:1`, `userCharged:0`,
`skipped:0`, `failed:0`, `truncated:false`. Charge hash
`e2d312b157ef526079856d382966c32e94d39cb12442487056d29176e92e21c7`
was SUCCESS at ledger `5201529`; RPC, packed SDK receipt, exact native 0.1 XLM
charge/subscriber and payout/recipient events matched. Allowance became 0.9 XLM.
All subsequent controls reconciled their original intents to SUCCESS:

| Action       | Hash                                                               | Ledger  | Result                      |
| ------------ | ------------------------------------------------------------------ | ------- | --------------------------- |
| Cancel       | `87bde09ff5bae5a63dac0c3b523d5c27b585431ec98cbe343f78b841883a85e0` | 5201547 | Cancelled, allowance 0      |
| Reactivate   | `050a2314d93664168dc496d5855be8b3c509e03a774a7f45049b90eb325631c5` | 5201561 | Active, allowance remains 0 |
| Final cancel | `6678dba2be2b269312a325f02e062f492a576b70a9ae5439bb5fdc428444073c` | 5201571 | Cancelled, allowance 0      |

Both cancellations' prepared auth trees used token `approve(...,0,0)` and succeeded
across preparation/execution ledgers. The fresh fixture's cleanup marker records
cancelled/zero allowance; no extra direct revocation was needed. The old immutable
WASM fixture is separate and remains subject to bounded cleanup reconciliation.

Early-release deployment `713d14ae-00b6-439b-bc5b-c9ca19cbc89e` was verified
without repeating the successful release. Reviewed read-only reconciliation
harness SHA-256 `4ba1d116b65a7c41ef0325e93ef3a0555584d7e5acaa11641c80df42f8ff2fa5`
confirmed original receipt/ledger, before-branch and exact native 0.1 XLM payout,
direct token/internal zero balances at/after the release ledger, then an API zero
balance with a timestamp newer than the original response. Independent unsigned
RPC reads also confirmed both balances zero at ledger `5201563`.
A separate explicit call on this confirmed drained fixture returned the expected
422 VALIDATION with no funds to release, and balance stayed zero. Early release
functional and refusal verification is complete. Cache behavior is a verification
limitation: the partner display cache can retain a pre-release value for 10 seconds.

### Legacy cleanup, Webhook and positive quote progress

The old controlled-wallet Subscription deployment
`7b20302c-43df-46a0-a632-d88b0f29525f` was cleaned up through a separately reviewed
stable native-token approval of zero, not by retrying its failed cancellation.
Hash `7ed9c6cffb0f93043ccdd5d4b38432135c53dfb7be086bf47b5f74e76e538178`
was SUCCESS at ledger `5201672`; direct token and API reads both showed allowance0.
The original failed control intent was reconciled as FAILED without submission,
then supported owner retirement completed RETIRED with no blocker and allowance0.
Its immutable old contract may still report not cancelled; zero allowance and
service retirement are the actual cleanup result.

The separate original lost-wallet deployment `e476fa10-99ae-4b3f-9d3b-04174671573e`
remains RETIRED. Its 1 XLM on-chain allowance remains because the original wallet
is unrecoverable; service retirement does not revoke it. Independent inventory of
eight dedicated fixtures (18 pipeline contracts) found all 36 configured native/
USDC token balances zero at the inventory snapshot. This is bounded fixture
inventory, not a claim about other environments or all possible token assets.

Reviewed Webhook harness SHA-256
`9f73c1da2f5cab4222ed4bece73ed8344b4ae6aeb85bc7073b870bce0feca3b9`
verified current code hashes, SDK pool funding, original funding reconciliation,
0.1 XLM escrow payout, exact-key replay with unchanged transaction/event set,
and changed-payload conflict409 without a second payout. The native authorization
was signed through ordinary Freighter consent with exact execute/transfer tree,
wallet/native asset/0.1 XLM bounds and SDK signature verification. Its single
callback returned REJECTED/PREPARATION_FAILED, attempt
`b4edfdcf-a397-418e-95ed-4e2bd2d0cb7c`, with no transaction hash. The harness
conservatively stopped; root made no blind retry or replacement. Read-only
source/runtime diagnosis is underway; native execution is not yet verified.

Positive packed-SDK quote passed on confirmed unfunded Swap deployment
`a8f9b6ea-9bbf-4674-8616-34902c7aaa5f`, selected node `swap`, testnet/live freshness:
0.1 XLM input, estimated output `106193` stroops USDC, minimum `105447`, 100 bps.
Router `CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD` and pair
`CCBX3NZTCQLQFSPG7HBOKL4P2RVPOPVFHDNRTOSCCJWBTPL2GHEH7RQS` matched validated
addresses. All pipeline balances were zero. This proves quoting, not execution.

Two deliberate packed-SDK public event-stream connections each connected and
returned snapshots containing the same known payment hashes, then explicitly
closed. This covers explicit close/reopen, not automatic recovery from a network
fault or unobserved heartbeat behavior. The reviewed read-only script SHA-256
is `ea68958c3cbd04b8c1b5993865235882a986c9c459f43d94d51af2a9274f50fb`.

Webhook fixture `61974b84-cb67-438d-98c8-72519332e895` funding hash
`f02d3d32712e0b14d13aed2ab48c640ed0100bfbc6cf00c8305c5c5cceb9d57d`
was SUCCESS at ledger `5201639`; escrow payout
`54cc87f4ec15f902e590a15fb2c0b33ae65f06bfe83af198720bf69f22e4ee63`
was SUCCESS at ledger `5201648`. Same-key replay returned the original attempt
and transaction with unchanged event IDs; changed payload returned409 CONFLICT.
The native attempt's structured response explicitly states the original attempt
failed before submission (REJECTED/PREPARATION_FAILED); it remains preserved while
auth-entry composition is diagnosed through read-only simulation. No replacement
or new key has been submitted.

### Native Webhook completion and real-Swap fee limit

Unsigned simulation and source inspection established why the first native
Webhook harness failed: recording produced a relayer source-account credential
and the customer wallet credential, but the harness retained only the latter.
The existing relayer-source builder simulates the provided authorization list.
The correction preserved the recorded source credential and the normal signed
wallet credential, with exact native 0.1 XLM execute/transfer trees; it did not
change app code, security checks or customer authorization requirements.

Independent review approved isolated native2 harness SHA-256
`cd7f433f408e7f839ad415eef829e2cebe1d92e21068829d571b94e687d6f571`.
A selected DB proof established the old attempt was terminal REJECTED with
`PREPARATION_FAILED`, null hash and null acceptance; exact old-key replay returned
that same refusal before any fresh nonce/key was created. The reviewed fresh
normal Freighter authorization was sent only through the authorized testing API.
New attempt `c29644f7-777d-4068-86b4-4803466d755c` produced transaction
`24b41da568306b4209e156547044c57e8bdabc636d409a55e45aba6edf537c35`,
SUCCESS at ledger `5201798`. RPC/SDK receipt and indexed execute/PAYOUT matched
native 0.1 XLM and the controlled source/recipient. Pool balance was zero;
exact-key replay returned the same attempt/hash and unchanged event IDs.
The temporary Webhook API token was then revoked with zero pool balance.
The original rejected attempt remains preserved; this was a new reviewed attempt
after definitive pre-submission failure, not replacement after unknown finality.

Automatic approval review rejected a proposed diagnostic that would send the
existing signed wallet authorization to the public testnet RPC as credential-like
egress. That diagnostic never ran. Source inspection and unsigned simulations
provided the diagnosis; normal approved wallet/app execution used no bypass.

The independently reviewed real-Swap harness prepared and confirmed a normal
1 USDC-limit trustline for the same wallet and exact testnet USDC issuer
`GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`.
Trustline hash `57612d4716610bdfe7d641d2cfc4c0851aec60d4e65db8a5e042c9406dc93c72`
was SUCCESS at ledger `5201761`; its additional minimum reserve is 0.5 XLM.
The wallet retains this empty authorized trustline; no USDC output was received.

The subsequent unsigned 0.1 XLM Swap preparation exceeded the harness's 1 XLM
fee ceiling before it could be persisted as a signing request. Read-only direct
reproduction confirmed exact source, trigger, `deposit(wallet,1000000)`, native
input and bounded time: estimated fee `590692710` stroops (59.069271 XLM),
resource component `590692610`. Independent reproduction at ledger `5201798`
reported `590802880` stroops total. The fee guard is valid and was not loosened;
no Swap execution was signed or submitted, and no prepayment was used to bypass it.
A likely contributor is shared contract-code TTL extension: SWAPPER code remaining
TTL was below its renewal threshold. This is an inference; the RPC did not provide
a complete fee breakdown. Positive packed-SDK quote remains proven; actual Swap
execution remains limited until a transaction fits the existing fee bound or a
higher financial limit is separately authorized.

Final local verification against the original live-tested artifact passed all170
SDK tests and package/consumer checks (ESM, exports/declarations/examples, package
allowlist and relevant behavioral checks), preserving the recorded tarball integrity.
The exact deployed runtime source `415e0b35` also has successful full Node and Rust
CI, run [38524222415](https://github.com/webnxt-2030/pinkraft/actions/runs/38524222415).
Documentation changes are separate from that runtime/artifact identity and require
their own final review/checks before any future merge or release.

### Final fixture exposure snapshot — 2026-10-15T02:51:43Z

Independent read-only inventory refreshed all eight dedicated owner deployments,
18 pipeline contracts and both configured native/USDC token balances per contract:
all36 balances were zero, with no unknown reads. The controlled old Subscription
is RETIRED with allowance0; the current-WASM Subscription is cancelled with
allowance0. The original lost-wallet Subscription is RETIRED and retains its
1 XLM on-chain approval; this limitation cannot be fixed by a replacement wallet.
The unfunded Swap pipeline remains zero; the controlled wallet retains its empty
1 USDC-limit trustline and 0.5 XLM additional minimum reserve. No Swap input was
spent. Selected metadata and independent on-chain reads were saved privately;
no credentials or signed payloads accompany this public report.

Webhook and Swap temporary API tokens were revoked after their final tests.
Final selected token inventory found four remaining dedicated #964 tokens across
original Receive/Schedule and current Subscription/early-release fixtures. After
independent review, exact owner-route DELETEs revoked all four at
2026-10-15T02:55:55–56Z, with matching returned IDs and non-null revocation times.
Per-token exclusive attempt/success markers were retained; no shared token or
financial transaction was changed. The original retired lost-wallet on-chain
allowance remains the documented cleanup limitation.

The final documentation-containing package smoke also passed once, including a
clean rebuild, isolated offline consumer, export/declaration/file-allowlist and
packed-example checks. Its integrity is
`sha512-9Z3+coLKVr2/Xr2GcxscC9J6P5w4oMHbKhf+bWmmDoBDzGbC9kgOCSEds8q9woJSaHKZN3OnMmRUXSOuaw/ZTg==`.
All18 runtime/declaration files were independently byte-compared with the original
persistent live consumer and matched; `package.json` and LICENSE also matched.
Only README/changelog packaging changed. This new tarball was not substituted
into the completed live runs or published. Original live artifact integrity and
runtime source identity remain separately recorded above.

A final authoritative owner-scoped DB token inventory at
2026-10-15T02:56:36.156Z confirmed zero active deployment API tokens across the
dedicated INTERNAL test owner, and non-null revocation times for all four target
rows. This was read-only confirmation; no token cleanup was repeated.
