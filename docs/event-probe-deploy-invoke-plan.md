# #486 deploy/invoke continuation — 7 October 2026

The user approved the deploy → one invocation → real 100+1 capture → local failure/recovery sequence, conditional on no Railway changes: “ok proceed, but do not proceed if there are railway changes. report to me first”. This continuation retains the original cumulative ceilings rather than increasing the budget. No Railway deployment, configuration change, shared WASM activation, app database mutation, scheduler change or payment is included.

## Preconditions and boundaries

Read-only checks of project `576ef2f5-16ec-4778-bdef-dca18f14d04b`, `hackathon-testing` / `paiflow-app` must match deployment `c4aa6a5c-3855-4eee-be29-c0699d4f37fc`, commit `c1db0a8c290e03d8ef15f37ac53e218aed8a9b11`, reader SHA-256 `b7c63960b6036b6385cb66b3dc7b98c8769ef2db7f31f80e9e88d4af5b0b99c4`, TESTNET/SDF RPC, sandbox/paid TTL/payroll/off-ramp false and channels zero. Stop and report a mismatch; never repin automatically.

The separately completed [upload diagnostic](evidence/event-rpc-probe-upload-diagnostic-hackathon-testing.json) supplies the prerequisite artifact and cumulative baseline. Its upload-only outcome is historical and is superseded for deploy/invoke status by this continuation.

Reuse uploaded WASM `92b458a551b0e426d6ad96fcf61f969ee91b7dc32f8c93d9286a5ba5239aa6dd`. Verify live availability, TTL and byte hash before funding. No new upload or restoration. A fresh local disposable source/admin is held in memory only. One Friendbot request; no recovered old signer, secret or signed-envelope persistence.

| Limit            | Continuation                                        | Cumulative                              |
| ---------------- | --------------------------------------------------- | --------------------------------------- |
| RPC requests     | At most 50, including preflight and capture         | Baseline 250; ceiling 300               |
| Signed attempts  | At most 2: deploy, invoke                           | Baseline 6; ceiling 8                   |
| Fee reservations | At most 7,985,308 stroops combined and per envelope | Baseline 52,014,692; ceiling 60,000,000 |
| Funding requests | At most one new Friendbot request                   | Baseline 3; ceiling 4                   |
| Principal        | Zero                                                | Historical 200,000 stroops unchanged    |
| Live duration    | 15 minutes                                          | No extension                            |

Reserve fees/requests durably before attempts, with no replenishment on refunds or failed submissions. Stop before signing an over-budget simulated envelope. One unresolved transaction per source; 180-second expiry, 30-second finality bound, serial requests at least one second apart and event passes at least one minute apart. Stop without retry on provider error, 429, timeout, mismatch, unavailable/expired WASM, restoration or ambiguous transaction outcome. Exclusive dated claim prevents restarting this approval.

## Acceptance

Confirm deploy and one invocation, validate 101 events (probe/u32 0–100) in transaction metadata against an independent 200-limit reference, and compare real 100+1 pages and their cursors. Capture at most five production-size pages to establish tip coverage.

Replay the captured pages through the byte-identical pinned reader in a disposable local PostgreSQL database. Cover baseline; page-two RPC failure; real SQL foreign-key failure after the first 100 inserts. Failures must hold cursor before the unfinished ledger. Recovery must store all 101 unique events; isolated rewind/replay must add no rows or duplicate publishes. The unknown probe topic uses STATUS_CHANGE; historical A/B evidence supplies financial decoding and routing proof.

This proves a 100-event boundary, not five-page allowance exhaustion, mixed-workload capacity, TTL rollout, or production readiness. Public evidence only; preserve previous outcomes and accounting. The local replay may reset only its own scratch cursor/database; never change a live cursor.

## Local preparation

143 focused tests passed across seven suites, including continuation accounting, no re-upload, unavailable/expired code, fee limits, runtime mismatch, consumed approval and existing reader regressions. Typecheck passed. No independent review or full-suite run claimed. No application/contract ABI/schema changes.

## Execution and recovery result

**Completed successfully on 7 October 2026.** Fresh runtime snapshot at 03:30:12 UTC matched the pinned deployment, commit, reader and feature/provider settings. The post-capture deployment check also matched. No Railway app deployment or configuration change occurred.

The uploaded WASM was verified live and reused. Probe `CCFT6MBBHND5M6ONSVWFE3YOHGODWTBN4Z3A4SYGAR3UFCCQWRMRREW5` deployed at ledger 5064059 and emitted once at 5064061. Metadata and the independent reference contained 101 matching events; real pages contained exactly 100 and 1, with the second cursor reaching tip ledger 5064085.

All three real-page PostgreSQL replay scenarios passed using the byte-identical pinned reader. RPC-page-two and actual SQL FK failures each persisted 100 events and held coverage at 5064060. Retry stored the final event and advanced to 5064085; duplicate replay added zero rows or publishes. Each scenario ended with 101 distinct event IDs and exactly 101 publish calls. Replay made no external network calls.

The live continuation used 23 RPC requests, one Friendbot request and two signed attempts. Maximum fees reserved: 197,245 stroops (0.0197245 test XLM); actual net fees charged: 156,720 stroops (0.015672 test XLM). Current cumulative accounting is **273 RPC requests, four funding requests, eight signed attempts, 52,211,937 reserved fee stroops**, with historical principal unchanged at 200,000 stroops. Reservations were not replenished. The execution claim is consumed and the disposable signer released; no restart is authorized by this outcome.

The scratch container and its anonymous volume were removed. Public [summary evidence](evidence/event-rpc-probe-deploy-invoke-hackathon-testing.json) and [exact captured pages](evidence/event-rpc-probe-pages-hackathon-testing.json) are saved locally. Executed source snapshots and raw captures remain in ignored `node_modules/.cache/event-probe-deploy-invoke-live-20261007/`; replay code/results remain in ignored `node_modules/.cache/event-probe-repinned-replay-20261007/`. At execution completion these artifacts were local and uncommitted. PR #830 now publishes the report, upload diagnostic prerequisite, continuation summary and captured pages; executable probe tooling/tests and ignored raw captures/replay harness remain local.

This completes the real 100+1 boundary and captured-page recovery sequence. The broader #486 mixed-workload/headroom and publication/rollout gates remain open; no five-page allowance exhaustion or capacity guarantee is claimed.
