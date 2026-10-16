# Developer-token integrated verification — 2026-10-16

Issue [#1034](https://github.com/webnxt-2030/pinkraft/issues/1034), parent
[#1028](https://github.com/webnxt-2030/pinkraft/issues/1028). Local verification passed.
This report establishes no hosted rollout, SDK registry availability or chain settlement.

## Revision and environment

The clean browser/API run tested app revision
`793459637f594de308849c4b282704c438abfea7`, based on integrated `dev-token`
`e47ee914f44658d627a0ff1a365281e52cc01d51`. Subsequent changes in this PR add
control lookup assertions and this report; the production app code is unchanged.
The [machine-readable evidence](developer-tokens-2026-10-16.json) records exact
runtime, browser, colors and artifact identity.

- Node 22.22.2, pnpm 10.4.1, Playwright 1.59.1, Chromium 147.0.7727.15.
- Real Next dev app at `http://localhost:3384`; PostgreSQL at `127.0.0.1:55439`;
  task-owned Redis at `127.0.0.1:6379`, isolated keyspace DB 13.
- Final browser fixture database: `dev_token_verify_4f55eaf33809`. Users,
  deployments, session JWTs, credentials and transaction records are disposable local fixtures.
- Installed `@paiflow/sdk` 0.1.0 tarball (Unreleased source), SHA-256
  `d78ba6036521ca201ec0612684c45f9b5143cec0889d5817057f9783f7b59cb4`.
  No registry install or publication occurred.
- Testnet configuration only. Both RPC and Horizon point to HTTPS loopback port 9;
  relayer key is empty and analytics capture is disabled. No external transaction
  or deployment was performed.

## Exercised boundaries and results

| Layer                                                   | Evidence and result                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Real browser → real management HTTP → PostgreSQL        | Owner JWT fixture opens `/account/developer`, explicitly selects two owned CONFIRMED ACTIVE deployments and creates a Read only token. Format, reveal focus, `ph-no-capture`, copy callback, Done and pagehide clearing pass. Another owned deployment and foreign deployment are refused.                                                                                                                                           |
| Real HTTP and installed SDK                             | One credential/client accesses both selections. Bounded one-item discovery pagination returns only `id`, `flowName`, `network`; capabilities succeeds for each. A seeded durable terminal transaction is recovered through the SDK without RPC.                                                                                                                                                                                      |
| Read-only operation isolation                           | All 23 actual POST operate routes in the declared matrix return 403 before domain body validation; no signed transaction is created. Separate webhook endpoint refuses the developer bearer without its webhook secret. This proves refusals, not financial completion.                                                                                                                                                              |
| Live selection/pre-auth behavior                        | Warm missing-grant refusal, owner PATCH adding that grant, immediate access, removal and immediate refusal all pass while another selection remains usable.                                                                                                                                                                                                                                                                          |
| Shared real rate limiter                                | A fresh credential alternates two deployment IDs through 60 successful capability calls; the next call receives 429. The selection does not multiply the endpoint allowance.                                                                                                                                                                                                                                                         |
| Credential lifecycle and compatibility                  | Expiry after warm authentication, inactive owner, revocation, sandbox management and bearer-only management refuse access. Metadata responses are no-store and contain neither full token nor hash. Existing `pfk_` reads/recovery pass; `pkdev_` is refused by API v1.                                                                                                                                                              |
| Real route handlers/DB with installed SDK fetch adapter | Prepare → separate synthetic wallet callback/signature → submit → PENDING → replacement credential status/recovery → SUCCESS passes. Grant removal before submit prevents send. Retry does not send again after finality and preserves first developer-token attribution. Signer, caller/owner and token FKs remain distinct. Cross-deployment hash replay fails even when fixture snapshots deliberately repeat a contract address. |
| Control and retirement seams                            | A separately seeded SUBMITTING control is looked up through the SDK/real handlers; another deployment or action cannot reconcile it. A synthetic RPC history gap returns 502 and retains the expired-by-wall-clock reservation. Irreversible RETIRING state blocks new submission while accepted signed records and pending durable service work remain.                                                                             |
| Eligible relayer operation seam                         | Read and operate reaches the actual early-release service, resolves its TIMELOCK_BRANCH node, chooses `before` and writes the developer-token audit. Simulation/channel/send are controlled stubs returning a synthetic success. No real relayer action occurred.                                                                                                                                                                    |
| History and leakage                                     | Source-handler request records retain preparation-request correlation, deployment/hash and separate original/replacement credential IDs without envelopes or credentials. Real HTTP records queued in Redis and browser console messages contain no full credential, token hash or fixture webhook secret.                                                                                                                           |
| Accessibility/layout                                    | Chromium desktop width 1440 and mobile width 393: no horizontal document overflow and no axe violations in the create form. Keyboard Enter creates the credential and focus reaches the reveal. Primary-button computed foreground/background are `rgb(101, 0, 46)`/`rgb(255, 177, 196)`, contrast **7.746:1**.                                                                                                                      |

The financial fetch adapter calls the source route handlers in-process; it is **not**
HTTP or a real wallet/chain test. Authentication, permission checks, database,
audit/outcome writes and durable service admission remain real. Unsigned-envelope
construction, RPC responses, event ingestion and relayer boundaries are simulated.
The signing callback uses disposable generated keys and an exact synthetic prepared
envelope in memory. Seeded terminal/control rows are identified above; they are not
receipts for real money movements.

## Defects found and fixed

1. Next omits route parameters for static discovery. The shared v1 wrapper previously
   dereferenced `params.id`, so real `GET /api/v1/deployments` returned 500 despite
   fixtures passing. Normalize static context and test the actual absent-params shape.
2. Primary buttons inherited two foreground utilities. Actual Chromium contrast was
   1.3209:1. Split shared layout from foreground classes; real contrast now passes AA.

## Checks

- Final clean-revision runner: **1 browser journey passed** (1.5 minutes), followed
  by **1 financial route/DB/packed-SDK journey passed**.
- Route/auth/permission/pre-auth/execute/envelope/status regressions: **223 tests,
  8 files passed**. Panel/page/retirement/control-retirement: **83 tests, 5 files passed**.
- Focused source journey and absent-static-params discovery regressions passed after
  fixture refinements; typecheck, changed-file formatting and `git diff --check` passed.
- Required hosted Node/Rust CI and independent review are PR merge gates. This local
  report does not claim those gates have passed; inspect the exact PR head checks.
  No contract code changed.

## Reproduce and cleanup

With the repository's existing dependencies, Python 3, Docker access and Playwright
Chromium installed:

```sh
python scripts/verify-developer-tokens-local.py
```

The runner requires existing task-owned containers `paiflow-dev-token-scratch`
(PostgreSQL loopback 55439) and `paiflow-dev-token-redis-scratch` (Redis loopback 6379).
It checks their names/running state/exact port mappings and refuses an occupied app
port. Each run creates and migrates a new `dev_token_verify_<12 hex>` database,
builds/packs/reinstalls the SDK into `/tmp/paiflow-dev-token-verify`, launches the
loopback app and runs both journeys. It does not reset databases or flush Redis.
No new application environment variables or dependencies are introduced.

The app process group stops automatically. Fixture databases and containers stay
available for independent review; the root orchestrator owns eventual cleanup.
Earlier harness runs also created databases with the same `dev_token_verify_` prefix.
Inspect that exact prefix inside the task-owned PostgreSQL container before removing
fixture databases, or remove the two task-owned containers when the overall review
is finished. Do not remove other services. `/tmp/paiflow-dev-token-verify` is disposable;
its private `app.log` and ignored `test-results` are not published evidence.

Traces, videos, screenshots and Playwright failure DOM snapshots are disabled. Only
the sanitized JSON measurement file is copied into this report directory. The SDK
artifact, token material, sessions and signed envelopes are never committed.

## Explicit limits

Unverified: hosted deployment/configuration, production build behavior in a hosted
runtime, real wallet extension consent/signing, system clipboard/browser permission
variants, browser engines other than this Chromium, a whole-page accessibility audit,
registry publication, on-chain execution/finality/recipient settlement, and unrelated
stream/scheduled/demo work tracked by #990. Existing focused tests support broader
workflow behavior; this report does not rename their simulated results as hosted
end-to-end evidence. No unresolved product questions were assumed.
