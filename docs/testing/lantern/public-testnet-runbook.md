# Lantern public testnet acceptance runbook — #933

Status: **preparation only; every rollout test is unexecuted**. This package does
not deploy a candidate, provision a live fixture, establish a minimum supported
Lantern release, or enable authenticated support.

Tracking: [#933](https://github.com/webnxt-2030/pinkraft/issues/933), parent
[#928](https://github.com/webnxt-2030/pinkraft/issues/928). The forwardable maintainer
handoff is **[Paiflow #945](https://github.com/webnxt-2030/pinkraft/issues/945)**;
the user forwards it. Do not create or update external Lantern issues as part of
this runbook. See [adapter behavior](../../lantern-wallet-adapter.md),
[public payment reads](../../public-embed-live.md), and
[Subscription approval](../../subscription-allowance.md).

## What this accepts

Run each public testnet case separately on Lantern Android and its Chrome
extension: anonymous `/trigger/:deploymentId` payment/funding and ordinary
Subscription `/allowance/:deploymentId` approval. Lantern connects and signs;
Paiflow prepares, submits, and reconciles. Connection does not log into Paiflow.
Mainnet, authenticated app support, scheduled charges, and launch/deep links are
outside acceptance. Mainnet and Payroll checks below verify refusal boundaries.

The implementation baseline is `lantern-staging` commit
`8c914b6df95221aa16d01d8574e0dff80595a535` (#929, #930, #937, #931).
The inspected Lantern bridge source was commit
`ed512f6d3a478e4fc9eaab498627a6d0f8165d30`, package 0.6.3.
These are **source references**, not installed-build support claims. Record the
actual candidate commit, release/build identifiers, installed extension ID,
device/browser versions, and execution dates in a fresh copy of the
[evidence template](evidence-template.md). A later candidate must identify its
actual commit and relevant differences; do not substitute the baseline for it.

## Pending prerequisites and approvals

| Prerequisite                                         | Current state | Owner/evidence needed                                                                                           |
| ---------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------- |
| Canonical Paiflow app origin and directory entry URL | Unresolved    | Owner confirms exact HTTPS origin and URL; `https://beta.app.paiflow.xyz/` is proposed only                     |
| Lantern directory entry                              | Pending       | Maintainer registers approved origin, `session: true`, testnet metadata; regenerates Android asset associations |
| Installed Android and extension candidates           | Pending       | Maintainer supplies builds containing registration, identifiers and distribution details                        |
| Deployed Paiflow candidate                           | Pending       | Explicit owner deployment approval; record environment, commit, health and final origin                         |
| Fixture provisioning and testnet payment consent     | Pending       | Owner approves isolated team/accounts, budgets and actions; tester consents to each wallet review               |
| QA access                                            | Pending       | Real Android device and pinned-ID extension, inspection access and tester                                       |

Do not deploy or promote `lantern-staging` to `develop` under this preparation
authorization. A deployment is a separate approved operation. Directory URL
selection matters: the bridge pins the exact app origin after redirects. Root
`/` is currently protected against framing; do not treat a registered root URL as
proof public payment pages load. Confirm how the Apps tab reaches a permitted
public payment URL on the candidate. If it lands on a denied page, record a
blocked entry-path test and agree the entry URL with the owners before rollout;
do not broaden protected framing to make the test pass.

## Fixtures: prepare an inventory, then provision only when approved

Use a dedicated non-production team and testnet-only master-key account wallets.
Keep keys and recovery phrases in the wallets. Record public addresses only.
Use the existing builder and standalone Freighter deployment workflow described
in the [alpha guide](../../alpha-testing-guide.md) and
[external-wallet checklist](../../instawards/evidence/d4/e2e-run-checklist.md).
Deployment/funding/trustline creation writes to chain and needs approval;
loading the guide does not authorize those actions. Do not clone private owner
records or use seed scripts against a hosted database to manufacture fixtures.

Provision or nominate these existing confirmed, ACTIVE deployments with contract
addresses and valid deployed graphs; verify their network is testnet:

| Fixture | Requirement                                                                                 | Expected action                                                                       |
| ------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| T1      | Receive/deposit-trigger pipeline to a controlled Pay/Split destination                      | Payment executes the deployed pipeline; use its displayed fixed amount where required |
| T2      | Standalone Splitter, controlled recipients                                                  | Customer-source distribute envelope and intended payout                               |
| T3      | Webhook-root funding flow, controlled owner/destinations                                    | Deposit funds only; no webhook reward invocation                                      |
| T4      | Streamer funding flow                                                                       | Top-up only; no automatic release claimed                                             |
| A1      | Ordinary SUBSCRIPTION, live configured subscriber equal to tester, active and not cancelled | Cumulative token approval to the actual subscription contract                         |
| A2      | Ordinary Subscription configured to another controlled wallet                               | Mismatched wallet refused before approval preparation                                 |
| A3      | Owner-approved cancelled/unconfigured Subscription fixture                                  | Cancelled/setup guidance and no approval submission                                   |
| P1      | Existing Payroll, anonymous test context                                                    | Session protection; no anonymous payroll approval                                     |
| M1      | Existing mainnet public page, if available                                                  | Read-only refusal in Lantern; never sign or submit                                    |

For each fixture record UUID, network, template/root, actual contract/token,
customer/subscriber, controlled recipients, input amount in displayed units and
expected chain amount, initial allowance/state and any trustlines. Choose small
owner-approved amounts that meet the deployed graph's requirement and leave fee
reserves. Do not reuse historical example addresses as recipient instructions.
Do not cancel/configure live subscriptions merely to generate A3. An unavailable
fixture means **blocked**, not passed. SUBSCRIPTION_DEV is not required by this
public-page milestone; do not enable Dev mode for QA.

Before signing A1, anonymously GET
`/api/deployments/:id/subscription-allowance` to verify current subscriber,
network, cancellation/setup state, token, spender and allowance. Public trigger
page data and `/api/deployments/:id/embed/qr` can verify the approved trigger URL;
only eligible roots expose it. `GET /api/health` identifies the candidate version
and database/RPC health (also record Redis status; do not infer it from HTTP 200).
Read-only status probes can perform existing confirmation bookkeeping, but never
broadcast a new wallet payment. Never use owner prepare/execute endpoints as a
substitute for the public wallet UI.

## Deployed headers and redirects: read-only preflight

Run on the approved candidate, logged out and without cookies or bearer tokens.
Use a **GET**, not only HEAD. Inspect one hop at a time; do not use `curl -L`.
Replace these non-secret placeholders with owner-confirmed values:

```sh
QA_ORIGIN='https://OWNER_CONFIRMED_ORIGIN'
QA_TRIGGER_ID='CONFIRMED_TESTNET_TRIGGER_UUID'
QA_ALLOWANCE_ID='CONFIRMED_TESTNET_SUBSCRIPTION_UUID'
curl --silent --show-error --max-time 20 --dump-header /tmp/lantern-trigger-headers.txt --output /dev/null "$QA_ORIGIN/trigger/$QA_TRIGGER_ID"
curl --silent --show-error --max-time 20 --dump-header /tmp/lantern-allowance-headers.txt --output /dev/null "$QA_ORIGIN/allowance/$QA_ALLOWANCE_ID"
curl --silent --show-error --max-time 20 --dump-header /tmp/lantern-root-headers.txt --output /dev/null "$QA_ORIGIN/"
curl --silent --show-error --max-time 20 --dump-header /tmp/lantern-invalid-headers.txt --output /dev/null "$QA_ORIGIN/trigger/not-a-uuid"
curl --silent --show-error --max-time 20 --dump-header /tmp/lantern-trailing-headers.txt --output /dev/null "$QA_ORIGIN/trigger/$QA_TRIGGER_ID/"
```

Inspect raw headers locally. Do not publish `Set-Cookie`. For a 3xx, record status
and a redacted Location, resolve relative locations against the request URL, then
verify the next URL has the confirmed exact HTTPS origin and no embedded
credentials. Stop on cross-origin/unapproved destinations, loops, or more than
five hops. Manually request the approved next URL. Inspect **every response** and
the final browser HTML; CDN/proxy headers can differ from source configuration.
Do not forward credentials across redirects. HTTP entry URLs are not approved.

For both valid public pages the final anonymous HTML must be 200, with no login
redirect, and each enforced CSP must permit precisely:

```text
frame-ancestors https://android.golantern.xyz chrome-extension://iflpkjgolcbleombhldiibhojohjpnmd
```

No `'self'`, `https://localhost`, wildcard, broad `chrome-extension:`, other
extension ID, or hosted Lantern web origin is allowed. Verify the final public
response has **no X-Frame-Options** conflicting with that permission. Multiple
CSP headers all apply; inspect each, not just the first. Report-only CSP does not
establish enforced permission. An HTTP `Origin` header does not simulate a
browser's frame-ancestors enforcement: the same path policy is emitted regardless
of that request header. Test allowed and untrusted parent frames in a browser;
do not expect a server 403 merely because the request Origin is untrusted. Record `nosniff`, HSTS, Referrer-Policy and the
existing Permissions-Policy as well. CSP nonce values vary and need not be saved.

Root, login, dashboard/builder and malformed public URLs must retain protection
(`X-Frame-Options: DENY` and, where middleware applies, `frame-ancestors 'none'`).
Trailing-slash paths are outside the exact public allowlist: record denial or a
safe normalization redirect and recheck its target; do not expect broad framing.
A valid Payroll allowance UUID shares public-route headers but must still refuse
anonymous access through its session check. Verify this separately from CSP.
A public mainnet URL may be frameable by path; its **wallet action**, rather than
its header, must be testnet-only. A 404/500 header check cannot establish a working
fixture or candidate even if its CSP looks correct.

## Execution and test matrix

Copy the evidence template before running. Use `not run`, `pass`, `fail`, or
`blocked` per platform and case. A mock/harness result is recorded separately
from device evidence. Inspect network requests without saving payloads, intents,
receipts, cookies or signed XDR. Do not export a raw HAR or record wallet setup.
Tests labeled **WRITE** can spend testnet funds or change allowance. All other
cases are read-only or cancellation/refusal checks; stop before approval unless
a case explicitly authorizes it. No hidden live fault injection is required.

| ID     | Class         | Steps and acceptance (repeat on Android and extension)                                                                                                                                                                                                                                                                                                                                            |
| ------ | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PRE-1  | Read          | Verify build, entry path, header/redirect checklist, actual parent origin and logged-out public pages. Extension ID must exactly match the pinned ID. Confirm visible network/token/amount/subscriber before proceeding.                                                                                                                                                                          |
| PRE-2  | Read          | In the actual frame check secure context, `navigator.locks` availability and writable localStorage using a disposable QA-only key, remove only that key. Never touch pending-payment keys. Record persistence across frame reload. No raw storage dump.                                                                                                                                           |
| PRE-3  | Read          | Click Connect, cancel wallet review. Trusted frame selects Lantern; no Freighter picker, WalletConnect SDK initialization/session restoration/relay traffic, pairing UI or mobile wallet deep link. Analytics wallet attribution is `lantern` if analytics access is available; unavailable analytics evidence stays blocked.                                                                     |
| PAY-1  | WRITE         | On T1 and T2 separately approve displayed amount and sign. Verify normal Soroban envelope, tester transaction/operation source allowed by Lantern, unchanged prepared hash/signatures, one submit and chain SUCCESS; verify intended recipients/action from public transaction evidence. Record fee/amount and ledger, never envelope.                                                            |
| PAY-2  | WRITE         | Repeat T3 and T4 independently. Verify deposit/top-up SUCCESS and correct funding events; no reward invocation or release inferred from funding.                                                                                                                                                                                                                                                  |
| ALW-1  | WRITE         | A1: approve small additional amount. Verify configured subscriber signs token approve for actual token/spender and allowance increases by requested amount; one submit, SUCCESS. Approval itself is not a charge or payout.                                                                                                                                                                       |
| NEG-1  | Cancel        | Reject connection and reject signing separately; no submit, clear rejection feedback and safe explicit retry. With wallet locked, verify unlock/request behavior or actionable refusal; do not infer locked-wallet behavior from mocks.                                                                                                                                                           |
| NEG-2  | Refuse        | Switch Lantern to wrong network before connect; no prepare/sign/submit. In a controlled pending review change account or network: pre/post-sign identity refresh rejects stale identity and requires reconnect/fresh preparation. For A2/A3 no unauthorized approval.                                                                                                                             |
| NEG-3  | Harness       | Suppress signing acknowledgment: unsupported-build guidance at 5 seconds, no submit, no lingering handlers. With acknowledgment but no completion: review timeout at two minutes. Record controlled harness build separately; never mark real release compatibility from it.                                                                                                                      |
| NEG-4  | Harness       | Wrong signing ID, sender window, exact origin, malformed identity/network, changed envelope/hash, dropped existing signature, missing connected-account signature and fee-bump response are refused; valid matching reply alone may progress. Use isolated synthetic wallets/transactions, never inject a live signed envelope.                                                                   |
| LIFE-1 | Cancel        | Leave/change deployment, network, amount or component scope while connecting/preparing/reviewing; late reply must not sign or submit old scope. Unmount/reopen does not revive it. Cancelled/timed-out sent connection quarantines every adapter in that frame until reload; close old Lantern prompt, reload frame, reconnect explicitly.                                                        |
| LIFE-2 | Cancel        | Repeated clicks join one attempt. Open standalone desktop picker, navigate to another deployment/unmount before selecting; old callback is inert. Repeat on amount/network change. Picker may remain visible: close it manually, do not tear down SDK DOM.                                                                                                                                        |
| REC-1  | WRITE + fault | With controlled response-only fault injection, allow original trigger submission to reach server but lose its response. Original hash/receipt must be durable before send; reload, check same hash, no new prepare/sign/submit until authoritative outcome. Chain SUCCESS results in one payment. Record fault mechanism; blocking the outbound request alone does not reproduce a lost response. |
| REC-2  | WRITE + fault | Repeat lost-response/reload for A1; original hash/scoped intent persists, status recovery reads that exact intent/hash, no repeated approval. New allowance matches only one approved increment.                                                                                                                                                                                                  |
| REC-3  | Harness       | Simulate unavailable RPC, stale/evicted history and NOT_FOUND. Keep pending/unknown and no replacement; wall-clock timeout alone cannot clear it. Only terminal chain status or receipt/intent-authenticated authoritative ledger-expiry proof permits replacement. Do not force live failures or wait out network history to fabricate proof.                                                    |
| REC-4  | Controlled    | Two same-origin frames/tabs for same trigger deployment/network: one Web Lock owner, other refused before preparation; pending state survives reload. With unavailable locks or storage failure, trigger fails closed before send. Test fresh isolated context, not by deleting actual pending records or bypassing locks.                                                                        |
| REG-1  | WRITE         | Standalone desktop Freighter and mobile WalletConnect testnet trigger plus A1 approval (separate approved runs): existing wallet selection/pairing, one submission, confirmation and reload behavior work. No Lantern selected in top-level tab. Record wallet/browser versions.                                                                                                                  |
| REG-2  | Read/refuse   | Unknown embedding origin cannot select Lantern; approved-origin spoof via query/storage cannot select it. Embedded mainnet gives Testnet-only guidance before browser SDKs/deep links. Standalone mainnet browser transport remains available: verify UI/selection without signing.                                                                                                               |
| REG-3  | Read/refuse   | Logged-out Payroll allowance and private invoke/submit-invoke/charges/Dev mutation endpoints stay protected. Check anonymous authorization with malformed non-actionable requests in an approved test environment, never valid mutation bodies. Authenticated pages stay denied to framing; embedded authenticated/Payroll wallet calls show deferred-milestone guidance, no SDKs or navigation.  |

If device tooling cannot produce a fault or protocol reply safely, mark its device
cell blocked and reference the synthetic regression coverage. Never count that
as device acceptance. Unknown payment outcomes halt further writes in that scope.
Do not clear `paiflow_trigger_pending:<id>:<network>` or
`paiflow_allowance_pending:<id>:<network>`, replay signed XDR, manually bypass
locks, or rebuild payments to continue testing. Persisted allowance intents and
trigger receipts are scoped recovery tokens: keep them out of durable evidence.

## Local preparation evidence versus device evidence

Existing synthetic regression entry points (explicit files avoid service-backed
suites accidentally running) are:

```sh
pnpm exec vitest run tests/unit/lantern-framing.test.ts tests/unit/components/lantern-wallet.test.ts tests/unit/components/lantern-public-payments.test.tsx tests/unit/components/trigger-reconciliation.test.tsx
```

They exercise message security, real SDK envelope assembly with simulated RPC,
SDK bypass, scope cancellation and hash-only recovery. They do not establish
installed Lantern capability or deployed readiness. The
[Subscription local fixture](../../subscription-allowance.md#repeatable-local-browser-fixture)
requires a disposable `public_allowance_*` database, synthetic settings, opt-in
RPC preload and separate local production app; it never sends chain transactions.
The [public embed fixture](../../public-embed-live.md#local-checks-and-remaining-live-verification)
uses a disposable `public_embed_*` database and local Redis. Follow those exact
isolation rules, never attach either fixture to a hosted database. This package
has not run those checks or provisioned them.

## Acceptance and handoff

Store sanitized evidence under a separately reviewed run directory with the
filled template. Record exact failed/blocked case, platform, time and reproduction;
stop/report new payment/authentication/security blockers. Preserve unresolved
hashes for reconciliation. Other concerns remain explicit follow-ups, not silent
passes. Fixture provisioning, deployment, directory shipping and device QA remain
pending until their owners provide evidence.

Public rollout acceptance requires successful real-device public flows on both
platforms and documented regressions/failure handling for the tested candidate.
Record the smallest **actually tested** Android and extension builds only after
passing runs. Closing #945's registration handoff unlocks QA; it does not close
#933. Keep #932 authentication evidence separate. Release/promotion and launch
links remain separate approved work after their prerequisites pass.
