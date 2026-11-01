# Private-instance isolation and release readiness

[#1167](https://github.com/webnxt-2030/pinkraft/issues/1167) is **open**. Local source
acceptance covers the working immediate, scheduled, subscription and time-condition
representatives below. The standard Multisig path has two confirmed, pre-existing
compiler/contract incompatibilities. This is not an all-standard-flow release pass.
No artifact upload, registry synchronization, hosted deployment, wallet funding,
browser/device acceptance or live transaction was performed for this evidence.

Release order remains **execution parameters → isolated instances → stored mutation**.
The execution source/readiness PR is merged, but its live release acceptance remains
open under [#1163](https://github.com/webnxt-2030/pinkraft/issues/1163). Merging this
document or its tests does not complete either release gate.

## What was exercised

The shared unsigned packets in `tests/fixtures/instance-acceptance/` come from the
production creation binder, graph compiler and constructor encoder. The default
Node suite regenerates them and compares the bytes with the committed vectors.
They contain public deterministic test identities and unsigned ScVals only.

The PostgreSQL lifecycle matrix publishes one private version, prepares/signs two
independent instances from that same version, publishes a later version while the
first preparation is pending, then retires the template. Both original admissions
keep their version, resolved bindings, graph, compiler output, artifact pins,
unsigned envelope and hash. The second instance can complete after template
retirement; retiring the first deployment does not retire its sibling. The real
polling selection includes only the active sibling. A subscription confirmation
records its own charge window and remains MANUAL when no platform relayer was
configured; creation binding never invents relayer consent.

Every actual prepared factory constructor is also byte-compared with the guest
packet after relocating only the synthetic admin and contract addresses to that
preparation's source and salt-derived addresses. Money, scalar types, enums and
struct encodings are unchanged by this bridge; the guest runner consumes the
committed packet itself.

These tests use real PostgreSQL transactions and developer envelope signatures,
with synthetic account, simulation, send and ledger responses. They establish local
admission, authorization and recovery behavior, not network deployment/finality.

| Representative                              |       Deployed nodes per instance | Local guest isolation evidence                                                                                                                     | Result      |
| ------------------------------------------- | --------------------------------: | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| Receive → full Pay                          |                                 2 | Paying A does not pay B or move B's unsolicited balance; B later pays its own recipient                                                            | Passed      |
| Schedule → fixed Pay                        | 1, a Streamer carrying the payout | Different start/end windows; A's claim/pause does not alter B's claimed amount or pause state                                                      | Passed      |
| Subscription → full Pay                     |                                 2 | Same subscriber grants two distinct spender allowances; charging/cancelling A leaves B's allowance, next-charge time and cancellation state intact | Passed      |
| Receive → time condition → before/after Pay |                                 4 | A's release pays only A's held balance; B retains its later deadline and obligation until its own release                                          | Passed      |
| Receive → Multisig → Pay                    |                        3 intended | Production constructor rejected; after test-only constructor adaptation, Receive forwarding also rejects and rolls back all token movement         | **Blocked** |

The guest runner invokes freshly compiled, unchanged WASM using exactly the packet
constructor ScVals. Construction/fixture setup uses an unlimited local budget;
functional calls restore the SDK's default execution budget. Authorization mocks
are paired with immediate assertions that the expected wallet/admin/subscriber
was required. The synthetic test token implements balances and per-spender
allowances; this is **not SAC, wallet, fee, archival, throughput or network-resource
qualification**. The runner registers each compiled contract at packet addresses;
it does not execute the factory deployment transaction on a network.

The standalone Multisig probe explicitly supplies its actual five-argument
constructor and seeds its accounting in test code, then proves A's approvals and
release do not populate or consume B's approvals/balance. It is not a supported
funding path, an app fallback, or evidence that the production Multisig graph works.

## Confirmed Multisig readiness blockers

The [raw local artifact report](evidence/2026-11-01-instance-artifact-conformance.json)
records the unchanged contract source commit, each WASM's SHA-256/size, constructor
specification and forwarding-method check. It also preserves the original Multisig
spec XDR so the default Node regression runs the same detector without a local WASM
build. The current production encoder supplies **six** arguments and encodes signer
rows as maps. The contract expects **five** arguments, with `Vec<Address>` signers
and no parent argument. Actual guest construction rejects with
`Func(MismatchingParameterLen)`.

Separately, the Receive root invokes `execute_step(asset, amount)`. Multisig exposes
`receive_and_forward(...)` and has no `execute_step`. Fixing only constructor
encoding therefore cannot make this graph run. The guest probe demonstrates the
forwarding failure and atomic token rollback after its explicit test-only
constructor adaptation. Its unauthenticated legacy `receive_and_forward` is not a
trusted substitute; no application route or forwarding fallback was introduced.

The checker intentionally exits **1** while any constructor or incoming-method
mismatch exists. The automated Node test asserts that failure result for the
recorded Multisig artifact; it does not suppress the exit and claim a green matrix.
Do not fix this by changing a known artifact's ABI, silently excluding Multisig
from the agreed scope, or re-encoding an admitted instance. A separately reviewed
protocol/authorization/ABI and artifact-cutover fix is required. Existing pending
and unknown instances retain their original identity and recovery evidence.

## Supported definitions, field types and artifact selection

The complete finite creation-field/type matrix remains in
[private flow templates](flow-templates.md#definitions-and-bindings). All ordinarily
supported standard definitions remain eligible; publication eligibility is not
proof of executable ABI compatibility. Multisig's eligibility currently exceeds
its verified runtime compatibility, as documented above. Payroll, off-ramp and
retired Dev surfaces remain refused; sharing, galleries, developer webhooks,
external-customer records and customer-owned signer/admin/fee payer are deferred.

| Definition family                                                      | Creation declarations                                                                  | Runtime policy/artifact limits                                                                            |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Receive / Pay / Split                                                  | Reviewed minimum, recipients and applicable configured money/allocation leaves         | Runtime execution/mutation only on their separately verified immediate path and pinned reviewed artifacts |
| Schedule / Subscription                                                | Applicable typed money, interval, duration, deadline, subscriber and permission leaves | Standard scheduled/allowance behavior; no new runtime input or stored-mutation authority                  |
| Amount / time / oracle / Multisig conditions                           | Applicable thresholds, deadlines, signers and oracle leaves                            | Ordinary compiled semantics; Multisig remains blocked as above                                            |
| Classic webhook / HTTP webhook / Swap / Yield / Hold / Return to owner | Only the explicitly enumerated meaningful leaves; some have none                       | Existing standard semantics and availability; no revival or inferred runtime policy                       |

Supported scalar tags are `wallet`, `contract`, `stroops`, `bps`, `integer`,
`timestamp`, `boolean` and `text`, with target-specific eligibility. Required values
never use the configured exemplar as an implicit default. Publication currently
requires a deployable configured exemplar; that existing product assumption remains
recorded in `.codex/pending-questions/1164-private-templates.md`.

Version publication pins network, factory/node WASMs and ABI evidence. Preparation
pins the chosen version, validated bindings, compiler output and exact envelope;
the signing review also verifies final encoded router/relayer bindings. Review and
reload must use this original admission, never current environment settings or a
time-sensitive recompile. Existing instances never follow later versions or
registry changes automatically. Mode-less saved graphs retain their existing
contract semantics; immutable template versions do not grant them policy-v1
lifetime guarantees. Creation permission is distinct from runtime permissions.

The local report's current source builds are evidence, **not an activation
selection**. The first execution activation plan still selects its retained
execution-only artifacts and source, as specified in
[execution readiness](execution-readiness.md). Instances must use the generation
actually reviewed and activated for their graph. Do not activate the current guarded
mutation build merely because the default local build produces it; mutation waits
for its own later readiness and authorization. Preserve all existing pinned
generations during rollout and rollback.

## Costs, admission and retention

Every instance deploys its own contracts and storage. The developer is owner,
on-chain admin, transaction source and fee payer; credentials never replace their
signature. The table above gives per-instance contract counts for the exercised
shapes, not a fixed price. Node count, constructor sizes, authorization, footprints,
ledger prices and storage lifetime affect simulation and deployment costs.

Preparation simulates the **actual** factory transaction and returns its unsigned
envelope, validity and `feeStroops` for review. This fee field comes from the
assembled transaction and includes its resource-fee bid; it is not a guaranteed
final net charge or a reusable quote for a different instance. Storage/rent and
future TTL maintenance are additional lifecycle considerations. No live simulation
or network fee quote was collected here; the synthetic RPC's fee is deliberately
not published as a financial estimate. Each new instance must be simulated and
reviewed on the environment-pinned network before signing.

Current conservative admission limits are per owner: **1,000** non-retired,
non-failed template instances; **ten** unresolved template preparations; **one**
unresolved deployment per owner/source. These are implementation assumptions
recorded in `.codex/pending-questions/1165-template-instances.md`, not measured
capacity or a global reservation of another owner's wallet. Retain original
ordered bindings, omitted defaults, key, instance and hash on retries. An unresolved
BUILDING crash or submitted hash can remain blocked indefinitely. Do not offer
cancel, replacement, a fresh key, timeout deletion or a manual reservation reset as
recovery. See [the exact instance lifecycle](api/template-instances.md).

Confirmed instances use the existing event/TTL/automation workers and durable
deployment-work admission. Worker selection excludes retired deployments before
bounded selection; ordinary work also excludes RETIRING. Retirement of a template
stops new admission, while deployment service retirement separately stops new
first sends and retains obligated reconciliation. Financial, transaction, event,
version, audit and idempotency evidence remains intact. The matrix exercises actual
poller selection and retirement service behavior, not a live worker schedule.

## Reproduce and complete the release gate

Use the repository's supported Node/pnpm/Rust versions and a dedicated local test
PostgreSQL database. These commands do not upload or deploy artifacts:

```sh
pnpm db:generate
pnpm test tests/unit/flow-instances/lifecycle.test.ts tests/unit/flow-instances/acceptance-packets.test.ts
node --conditions=react-server --import tsx scripts/generate-instance-acceptance.ts
cd contracts
cargo build --locked --release --target wasm32v1-none -p deposit_trigger -p payer -p paiflow-streamer -p paiflow-subscription -p timelock_branch -p paiflow-multisig
cargo test --locked -p payer --test instance-isolation -- --ignored --nocapture
cd ..
node --conditions=react-server --import tsx scripts/check-instance-artifacts.ts contracts/target/wasm32v1-none/release /tmp/instance-conformance.json <contract-source-sha>
```

The final checker currently returns 1 for the documented blockers. Do not append
`|| true`, reinterpret the expected negative guest probe as Multisig acceptance, or
hide the two manually invoked guest cases behind default `cargo test` skip counts.
Ordinary test configuration is required even for no-I/O generators because the
production imports validate environment configuration; use a synthetic local
environment, never production secrets.

Before release: resolve and independently verify both Multisig protocol/ABI
blockers; complete #1163's execution release acceptance first; obtain explicit
artifact/network/hosted rollout authorization; re-read target network settings;
review registry/factory/ABI pins and costs; then exercise two instances per agreed
family with real developer signing, independent address/state/balance/allowance/
approval and retirement evidence, including browser/device recovery. Record actual
artifact and service revisions, ledgers, fees, retained history and operational
rollback. Keep #1167 and parent trackers open until that acceptance is satisfied.
