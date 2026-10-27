# Lantern integration synchronization

Issue #1106 brings develop `d38faae8` into `lantern-integration` based on `60e1d6d8`
through a normal merge. The synchronization preserves both histories and the
integration branch's shared wallet picker, server-pinned network, pre-sign recovery,
Lantern desktop adapter and exact-parent framing. Apps-tab PR #1105 remains separate.

## Combined deployment recovery

The deployment review retains the existing flow/network-scoped hash/phase/attempt
record and Web Lock. It adds a separate public preparation record containing only
the deployment ID, original hash, account, and safe-signing state. It never stores
unsigned or signed envelopes, wallet credentials or private material.

A fresh successful prepare response creates ready provenance before signing. Before
asking the wallet, the app consumes that provenance and persists the signing marker.
Only a matching explicit wallet refusal restores ready provenance. An interrupted
wallet, invalid signed response, storage failure or unknown outcome retains HOLD.
A missing marker, a consumed preparation record or a legacy sessionStorage deployment
ID does not prove that signing never occurred and cannot enable another signature.

Ready provenance alone does not authorize resumption. The app re-reads the owner API
inside the same admission boundary and checks the deployment, flow, active lifecycle,
network, account, original XDR/hash and server-provided passphrase. Resuming signs
only that original preparation; it never silently prepares a replacement. Conflicting
legacy and current records fail closed without deletion.

Only a 502 `UPSTREAM_RPC` response with explicit `submissionStatus: NOT_ACCEPTED`
from the original submission permits an explicit retry of the exact same signed bytes.
Those bytes remain in memory only and are discarded on navigation/reload or before
retrying. Transport/parse errors, generic errors and lost retry responses keep the
original hash held and remove retry permission. No additional wallet signature or
preparation is requested by submission retry.

Hash-bearing records clear only after exact-hash chain finality and matching owner
DB status/hash, as before. A bare `EXPIRED` value cannot clear them. For a proven
safe unsigned preparation, explicit replacement additionally requires server expiry
metadata bound to its original XDR/hash/account/network. The server verifies a closed
ledger after maxTime, repeated NOT_FOUND reads whose retained history covers the
row's creation (before the app constructed the envelope), current durable state and
absence of accepted/ambiguous submissions. Missing, stale, evicted or partial history
keeps BLOCKED. Browser time alone never authorizes replacement.

## Imported source and validation

Develop includes the Zod 4/form-resolver/CSP startup migration, WalletConnect sign-client
and modal updates, RPC budgets, finality reconciliation, and Streamer pause-accounting
source changes. Validate Zod startup with `node tests/zod-csp.mjs`, existing mobile
pairing/namespace/return regressions, the full Node/SDK/build/audit checks, and Rust
format/Clippy/workspace tests. Source synchronization does not deploy new WASM or
repair already deployed instances; contract activation requires its own scoped work.

The four imported migrations add subscription schedule revision fencing, a Flow-name
search index, ServiceTransaction reconciliation scheduling fields/indexes, and an
audit-log pagination index. Migration validation must use disposable local/CI databases.
The reconciliation migration makes historical service transactions eligible for checks,
so hosted worker activation is part of rollout review.

## Merge and hosted rollout gate

Before merging this synchronization or #1105, reverify the exact Railway testing
service/environment, watched branch and deployment trigger. A merge into integration
may automatically deploy the app, run startup `prisma migrate deploy`, and activate
changed workers. Coordinate explicit authorization for those effects or defer merging
until an authorized deployment-control arrangement exists. This work does not change
hosting configuration, disable triggers, apply hosted migrations, upload/hash-sync
contracts, perform financial tests or authorize staging/mainnet access.

After an authorized green synchronization merge, normally merge updated integration
into #1105 without force-pushing. Re-run Apps-tab/wallet tests, independent exact-head
review and required Node/Rust CI. Real-device Apps-tab acceptance remains under #933.
