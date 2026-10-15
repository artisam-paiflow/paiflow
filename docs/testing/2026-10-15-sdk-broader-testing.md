# Published SDK broader testing, 2026-10-15

Checkpoint: **2026-10-15, final cleanup inventory at 08:21:12.465 UTC**.
Published `@paiflow/sdk@0.1.0` passed the additional hosted SSE and demo-credential
checks below. Subscription cancellation prevention, Schedule funding/refund,
service retirement and credential/configuration cleanup were verified.
**Positive Subscription charging and the first Schedule claim remain FEE-BLOCKED**:
unsigned estimates were **42.6086882 XLM** and **27.2468293 XLM**, respectively,
above the unchanged **1 XLM** bound. Those calls stopped before POST/signing/
submission; this is not an all-positive testing result.

| Group                                                                  | Result at this checkpoint                                                                                      |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| SSE body fault, explicit reopen, heartbeat, stall and cleanup          | Passed within the bounded caller-adapter/snapshot scope.                                                       |
| Demo issuance, audience, revocation, real expiry and exact restoration | Passed; both new credential rows revoked, no active dedicated-fixture tokens.                                  |
| Subscription                                                           | Positive charge fee-blocked; cancelled first-unpaid-charge prevention and zero-allowance/token cleanup passed. |
| Schedule                                                               | Positive claim fee-blocked; 0.2 XLM funding/full refund, zero balances and supported retirement passed.        |
| Unattended scheduler                                                   | Not configured or tested; manual cron authorization only.                                                      |

Related evidence: [initial SDK verification](2026-10-14-sdk-live-verification.md),
[the separately authorized real Swap](2026-10-15-sdk-swap-execution-982.md), and
[SDK release checklist](../sdk/release-checklist.md). The completed Swap's
single-use 75 XLM fee exception does not authorize another such transaction.

## Environment and artifact

- Host: `https://pinkraft.xyz`, the explicitly pinned Railway testing project,
  environment and application service; testnet only.
- Fresh registry consumer: `@paiflow/sdk@0.1.0`, ESM, Node 22.22.2. Its approved
  published archive integrity was
  `sha512-DueOJNgNzLVSHVSHFDbwGlm6QjVTFAm7vfU3zBPSFgAmJWevPRyfvkDk+C7zgcRm1ggRjDnGUr6wp2B5tO/ISw==`;
  SHA256 `b14c793ca4d49d842e2d7a96ec2945a7b6b8d2d1ccab503ee1b925f77281f242`.
  All 18 JavaScript/declaration files matched the original live-tested SDK bytes.
- SSE and demo issuance/revocation used hosted source
  `116a4d77b5d06c005581063a1ef3dd843abcc77f`, health version `116a4d7`.
- Existing public SSE deployment:
  `76e18ae1-825d-4b20-b4e2-7ec6cb4d290a`.
- Existing dedicated demo deployment:
  `a8f9b6ea-9bbf-4674-8616-34902c7aaa5f`, native Receive → native/USDC Swap →
  full USDC Pay to the existing controlled wallet. No new paid deployment,
  trustline, asset mint or Swap was needed for these credential checks.

Before enabling the demo API, selected owner/service metadata confirmed an
active, confirmed testnet deployment owned by the active internal USER identity.
All three actual chain executable hashes matched the current configured/source
artifacts, and direct unsigned getter simulations confirmed all six native/USDC
pipeline balances were zero. This did not consume or replace the wallet's
previously retained USDC output or its 1 USDC-limit trustline.

## Hosted SSE fault, reopen and cleanup

Four caller-selected connections ran sequentially through the published SDK's
public embed stream. An injected fetch adapter contacted the real hosted endpoint
and wrapped its response body; it did not replace the hosted response with a
synthetic snapshot.

| Check                               | Observed result                                                                                                                                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Abrupt body failure                 | After `connected` and the first real `snapshot`, the adapter errored the body; the SDK surfaced a transport error. One fetch only; no automatic reconnect.                                        |
| Explicit caller reopen              | A new SDK connection received `connected` and `snapshot`; the same four recent event IDs and transaction hashes remained present.                                                                 |
| Heartbeat and caller abort          | One real `: ping` comment was observed within the bounded 12–24 second assertion around the server's 15-second cadence. Explicit caller abort was surfaced and the upstream reader was cancelled. |
| Withheld upstream bytes and timeout | After the initial snapshot, the adapter withheld a real 8-byte upstream chunk. The SDK's 20-second overall deadline expired; at least one actual chunk was held before that timeout.              |
| Explicit generator return           | A separate connection was closed with `return()` after its initial snapshot.                                                                                                                      |

Across all four connections, the SDK made exactly one fetch per connection,
its signal was aborted during cleanup, and the wrapper cancelled its upstream
reader exactly once. All connections were closed. The initial and reopened
snapshots contained the same four existing RECEIVE/PAYOUT events.

These are caller-boundary body-failure and cancellation checks, not an induced
server outage or proof of infrastructure failover. Reopening retrieves the
bounded recent snapshot (at most 50 events); it does not establish lossless
replay, `Last-Event-ID` recovery or arrival of a newly generated live event.
The SDK ignores heartbeat comments and uses an overall timeout; no independent
heartbeat watchdog is claimed. Client cleanup was observed; server-side leak
metrics were not measured.

## Temporary demo API credentials

The user authorized temporary public demo-token issuance on the dedicated
fixture and exact restoration of the prior configuration. The prior
`DEMO_API_ENABLED` and `DEMO_API_DEPLOYMENT_ID` keys were **both absent**.

The enabled runtime was independently verified at **07:14:53 UTC** on deployment
`6fae3971-de07-4a27-920d-393014f9d068`, with the exact intended source, testing
IDs, testnet, enabled flag and designated fixture. The SDK's explicit
`createDemoToken()` method then issued exactly two credentials, one per durable
issuance marker, with no automatic POST retry:

| Purpose              | Issued, UTC  | Returned expiry, UTC | Completed verification                                                                                                                                                            |
| -------------------- | ------------ | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Natural expiry       | 07:16:18.761 | 08:16:18.761         | HTTP 201; intended deployment HTTP 200/testnet and another controlled deployment HTTP 401; the original unrevoked credential returned HTTP 401 after real expiry at 08:16:49.044. |
| Immediate revocation | 07:16:26.335 | 08:16:26.335         | Same issuance/audience checks; supported owner DELETE revoked it at 07:22:58.662; SDK capabilities returned HTTP 401 at 07:23:20.270, well before expiry.                         |

`POST /api/v1/demo-token` creates a deployment-bound API credential, **not an
asset**. Credentials and original responses were retained privately with mode
0600 and are excluded from this report. No user key, recovery phrase or signed
payload was accessed or published by these checks.

Disabling public issuance does not revoke previously issued credentials. The
natural-expiry credential was deliberately left unrevoked. A narrow read-only
DB audit at **07:49:13 UTC**, against actual source
`a5bd498ef3b53305fe8b8242916e73d83ed07517`, found exactly the two expected new
demo rows, no unexpected new public-demo or owner-token rows, the control row
revoked, and the expiry row still unrevoked. The owner and deployment service
remained active. Historical baseline rows were protected.

**Natural expiry passed using the actual wall clock.** The clock gate was checked
at **08:16:31 UTC**, after the required 08:16:24 threshold. Fresh selected DB proof
at **08:16:48.230 UTC** confirmed the original credential still had `revokedAt:
null`, its exact returned expiry was **08:16:18.761 UTC**, and its owner and
service remained active on source `a5bd498e…`. **Exactly one** published-SDK
capabilities request then returned **HTTP 401 `UNAUTHENTICATED` at
08:16:49.044 UTC**, within one second of that DB observation. This was expiry
rejection of an unrevoked credential, separate from the already completed
control-token revocation check. No fake clock, TTL change, new credential or DB
mutation was used.

After that independent expiry check, the original expired credential was revoked
through the supported owner route at **08:17:53.050 UTC**. The authoritative
final inventory at **08:17:57.249 UTC** confirmed **both new public-demo rows
revoked**, **zero active tokens** on the dedicated fixture, and no unexpected new
public-demo or owner-token rows. The original baseline rows were protected.
This establishes completed demo-row cleanup separately from expiry enforcement.

## Exact demo configuration restoration

The restore deployment `04360dbc-f589-4a34-878e-dea86e8b61ec` reached SUCCESS.
At **07:22:10 UTC**, independent runtime inspection confirmed both demo keys
were actually **absent**, with the exact new deployment ID, source `116a4d77…`,
pinned testing IDs, testnet and HTTP 200/healthy public version `116a4d7`.
Absence was distinguished from present-but-false or empty values.

At **07:23:35 UTC**, one explicit SDK demo-token request returned HTTP 403
`FORBIDDEN`, with zero credentials issued. The public issuance window was closed.
A lifecycle preflight had refused while restoration was still building, before
owner login or DELETE; the control-token revocation proceeded after verified
restoration without issuing a replacement credential.

The two demo settings remained absent in the later fee-guard runtime described
below. Fresh checks at **08:16:55.936 UTC** compared actual configured presence
against the captured both-absent baseline and independently confirmed actual
runtime absence, source `a5bd498e…`, testnet, the 1 XLM relayer cap, zero channels
and healthy public version. That fresh proof was reviewed before the supported
cleanup, which completed at **08:17:57 UTC**. Both demo keys remained in their
exact prior absent state; no further credential issuance, config change or
replacement token was needed for cleanup.

## Relayer fee guard deployed before further financial work

[PR #991](https://github.com/webnxt-2030/pinkraft/pull/991) merged into testing at
`a5bd498ef3b53305fe8b8242916e73d83ed07517`.
Its exact postmerge [full Node/Rust CI](https://github.com/webnxt-2030/pinkraft/actions/runs/38698568518)
passed, and the normal automatic testing deployment
`b74875e2-c5a2-4153-a46e-fc1c0ecf72f2` reached SUCCESS.

Independent selected runtime checks at **07:38:12 UTC** established:

- Actual source and deployment matched that merge and the explicitly pinned
  testing project/environment/service; network was testnet.
- `STELLAR_RELAYER_MAX_FEE_STROOPS=10000000` was present: a **1 XLM total
  declared-envelope fee ceiling** for transactions built by `buildRelayerTx`.
- Relayer channels resolved to zero through the schema default; the optional
  channel variable was absent. Public health correctly omitted its channel count
  when none were configured.
- Both demo environment keys remained absent; public health was HTTP 200/ok,
  version `a5bd498`.

The guard rejects a supported relayer transaction above the configured ceiling
and disables automatic restoration on that path while configured. It does not
cap every user-signed transaction or establish a cumulative spending budget.
No scheduler was installed or enabled. The user authorized bounded **manual cron
calls only**. Each scenario requires its own reviewed scope, current runtime gate,
exact original receipts and direct post-finality balance checks. The Subscription
fee refusal and later cancelled-unpaid skip below do not establish a positive
charge; the first Schedule claim was separately refused on its fee estimate. The fee limit is not authority to retry an uncertain financial submission or prepay shared-code rent.

## Subscription fee refusal, cleanup and unpaid-charge prevention

The new isolated Subscription fixture
`f2be9a15-55a9-48ba-ad39-cdf535eb8e35` reached deployment SUCCESS at ledger
**5205413**, original hash
`75d05e75c6d437cda90194ffc819cd15c75bfd4c7d87b0682e6131735370e675`.

The later reviewed **unsigned charge preflight**, at ledger **5205475**, estimated
**426086882 stroops (42.6086882 XLM)** in declared fees, above the normal
**10000000-stroop (1 XLM)** ceiling. It required no restoration, but the fee bound
still refused the operation. The refusal occurred **before the manual cron HTTP
POST**: no charge transaction was signed/submitted, and `manualCronCalled` was
false. The limit was not raised and no TTL prepayment was used to bypass it.
This is evidence of the rehearsal's preflight guard stopping an excessive fee;
it is not a successful hosted charge, payout, automatic scheduler run or live
exercise of the backend's rejection response. No rent breakdown for this quote
is asserted.

The authorized normal-wallet cleanup reconciled the original cancellation:

- Hash `ca982e3a3a948e9da0c38965b11be3b53b67d58b272a1f8f4272372fbc8c09d5`:
  **SUCCESS**, ledger **5205493**.
- Net fee **6602 stroops (0.0006602 XLM)**; cancelled state true and remaining
  allowance **zero**.
- The dedicated scoped API token was revoked through the supported owner route
  at **07:57:51.780 UTC**.

A later, separately approved manual cron request tested the already-cancelled,
unpaid fixture. **Exactly one POST** completed with `platformCharged: 0`,
`userCharged: 0`, `skipped: 1`, `failed: 0`, and `truncated: false`. It submitted
**zero financial transactions**. Refreshed state remained cancelled with zero
allowance, `lastChargedAt` null, and the original on-chain next-charge timestamp
still equal to its start (`1792050564`); no first charge had occurred.

Selected durable DB proof at **08:03:33.017 UTC** showed `chargeRelayerMode: MANUAL`,
`nextChargeAt: null`, `lastChargedAt: null`, exclusion from the global due query,
and **zero unresolved work**. The manual request therefore established
**cancellation prevents the first unpaid charge**, with no payout or extra
on-chain transaction. It did not establish successful positive charging,
quiet-after-a-previously-paid-period behavior or next-period charging. The earlier
positive-charge quote still remains fee-limited; the later negative request did
not bypass that refusal. Earlier historical positive Subscription evidence is
separate.

## Schedule funded and refunded; first claim refused on fees

The new controlled Schedule deployment is
`08c5b3bb-b4f7-42d9-8dd1-34cab370ca14`. The original funding transaction
`880153dd4b25239bd1c6277b69719135ebd4faab15e56b5821af7ed23b6cc95a`
reached **SUCCESS**, ledger **5205512**, net fee **645059 stroops (0.0645059 XLM)**.
Post-finality state held **2000000 native stroops (0.2 XLM)**, with claimed amount
zero.

A separate **unsigned**, read-only funded cancellation/refund simulation at
ledger **5205522** included the native transfer branch and quoted a total fee of
**11341 stroops (0.0011341 XLM)**, no restoration required. This priced the funded
path; an earlier empty-balance quote could not establish the transfer fee. No
refund was signed or submitted by that quote, and it does not prove a future
claim/refund fee or financial finality.

The first eligible release was **08:07:29 UTC**. At that natural first payable
instalment, a separate unsigned claim preflight at ledger **5205617** quoted
**272468293 stroops (27.2468293 XLM)**, above the normal 1 XLM ceiling. No
restoration was required, but the preflight refused **before any cron HTTP POST**;
no signature, financial submission or on-chain write was made by that claim attempt.
No successful scheduled payout or natural scheduler execution was established,
and no fee-limit increase or TTL prepayment was used.

Normal-wallet consent on the direct contract `cancel` path returned the full
held **2000000 native stroops (0.2 XLM)** to the controlled admin wallet:

- Original authenticated cleanup hash
  `426e5abea825ef89fd124c9913639c48bb133a76d780a8eef2fe5dd89b379b4d`:
  **SUCCESS**, ledger **5205755**, net fee **6435 stroops (0.0006435 XLM)**.
- Same-hash native transfer event `0022358547476029440-0000000000` corroborated
  the full refund to the controlled wallet. This transfer amount is separate from
  the transaction fee; no fee-free native wallet balance delta is implied.
- Direct native balance on the Schedule contract was **zero**. App same-hash
  status reconciliation also returned SUCCESS.

The first private cleanup helper had omitted the owner session on the normal
submission route. Its original HTTP status was not retained. Before a new
operation was authorized, combined proof at **08:18:08.723 UTC** established
non-admission of original hash
`bdbc5ffd407caabd940874f14adbb2104f2b669a774fefc31450a4fc0aadd987`:
pinned middleware/route behavior, selected DB absence of admission/signature/
service/event/audit records and unresolved work, RPC NOT_FOUND for the expired
original, unchanged account sequence and the full held balance. A separate safe,
unauthenticated POST probe returned 401; that diagnostic is not the original
HTTP result. Expiry/NOT_FOUND alone was not used to clear unknown finality.

A narrowly reviewed helper correction added normal owner authentication. The
successful hash above is a **new authenticated cleanup operation**, not a blind
retry or resend of the original. Original preparations/attempt markers remained
preserved. This was a private verification-helper issue; no SDK, backend or
contract behavior change was required to obtain the refund.

After direct refund, the supported owner retirement route reached **RETIRED**
with **no retirement blocker**. Direct native and USDC balances were both zero.
The retirement verification confirmed the dedicated API token revoked and the
Schedule job excluded from global due work. Direct `cancel` alone did not retire
service/jobs or establish a paused contract state; the separate retirement is
what ended service. This direct cleanup is not SDK `schedule.retrieve` coverage
or a successful scheduled payout.

## Final cleanup inventory

A fresh selected DB inventory at **08:21:12.465 UTC**, on source `a5bd498e…`,
confirmed **zero active API tokens across the dedicated testing owner**,
**zero globally due Subscription candidates**, **zero due Streamer jobs**, and
**zero unresolved work**. The new Schedule service was RETIRED with its job
cancelled; the new Subscription DB row was MANUAL with durable next/last charge
null. Its separate on-chain cancelled/zero-allowance observation is recorded
above. The demo keys were restored to exact prior absence, and both newly issued
demo rows were revoked. These are dated observations, not
a guarantee about every future candidate.

All performed financial workflows reached their verified cleanup states. No
additional financial write is planned by this checkpoint. The positive
Subscription charge and Schedule payout remain unverified under the current
fee ceiling; the separately consumed high-fee Swap exception was not reused.

## Verification and review status

- [x] Actual natural-expiry rejection: one SDK 401 at 08:16:49.044 UTC, with fresh
      unrevoked-row and active owner/service proof.
- [x] Supported-route final demo-row cleanup after the expiry check, with both new
      rows revoked, zero active dedicated-fixture tokens and fresh exact restoration proof.
- [x] Original Schedule refund SUCCESS, full 0.2 XLM transfer and direct zero
      native contract balance after the fee-limited claim.
- [x] Supported Schedule service retirement, zero native/USDC balances and revoked
      token; final owner/global-due/unresolved inventory verified.

The focused testing documentation change still requires independent final
evidence review and exact-head full Node/Rust CI. Those review/check results are
recorded on its PR; this report does not predeclare them successful.

This checkpoint does not claim unattended scheduler operation, lossless SSE
recovery, broad production reliability, cheap arbitrary Swap execution or a new
SDK release. The retired lost-wallet allowance limitation from the earlier report
is unchanged. No staging/mainnet action is part of this broader testing work.
