# Immediate execution v1: contract/compiler implementation

Implements [#1159](https://github.com/webnxt-2030/pinkraft/issues/1159) against the
[shared domain contract](reusable-flows.md). This is source and local build evidence,
not an upload, registry update, service deployment or wallet acceptance record.

## Supported source and financial behavior

An explicit `graph.fieldPolicies` selects policy-aware constructors for **every**
node of one Receive → zero or more Pay → terminal Pay/Split path. No branches,
joins, fan-out, prefunded trigger, delayed condition, schedule, subscription,
webhook, swap or yield participates in this execution context. Every node uses the
root asset. Mutable fields are refused until their separately reviewed workstream.
Absent policies keep the existing legacy compiler and entry points unchanged.

`lib/flows/execution-v1.ts` provides the path, default policies and compiler source
validation used by the backend handoff. Omitted Pay policies are all constant;
omitted Split policies preserve row order and use existing row IDs, or `row-1`,
`row-2`, etc. Constants are checked at construction; execution recipients and
allocations are stored as absence, never draft fallback values.

The root requires payer authorization over the exact seven `execute_v1` arguments,
checks the full path's reviewed revisions before pulling funds, and consumes a
temporary `(payer, nonce)` replay record through the explicit ledger expiry. The
expiry must be in the next 720 ledgers and is checked independently of storage TTL.
Two payers may use the same nonce without sharing arguments or spending budgets.
Children require their immutable parent's authorization for the complete context,
asset and conserved per-hop amount, and verify their own node/address/revision.
The terminal checks the complete path has been consumed. No execution arguments are
persisted as current configuration.

Fixed v1 Pay requires its full configured payout; underfunding fails atomically.
Percentage Pay uses the existing overflow-safe floor arithmetic. A nonterminal Pay
forwards exactly incoming minus payout; a zero remainder cannot skip a declared
child. A terminal Pay returns only that invocation's unused budget to its original
payer. It leaves unrelated holdings untouched. These are new policy-aware semantics;
legacy partial fixed Pay and legacy terminal retention are unchanged.

Split merges configured rows in their immutable order, then an explicitly declared
additional roster. Constant row IDs, recipients and allocations cannot be supplied
as overrides, removed, reordered or shadowed. Missing/unknown/duplicate/irrelevant
inputs and wrong allocation modes fail. The combined roster contains 1–20 unique
wallet recipients. Percentage totals are exactly 10,000 bps; the last row receives
the checked rounding remainder. Any execution-aware fixed Split, including
recipient-only execution, requires its full configured/merged total to equal that
call's incoming amount. No partial batch, retained execution remainder or old
accumulation funds that execution. Constant-only fixed Split retains its accounted
accumulation behavior and is terminal, so it cannot send old funds into runtime
destinations.

Every v1 token transfer verifies exact sender debit and recipient credit using
checked balance deltas. Under-delivery or an extra debit fails atomically instead
of using unsolicited holdings. This does not turn arbitrary dishonest token code
into a trusted asset; the app resolves configured Stellar assets to their asset
contracts. Unsolicited balances have no v1 sweep/cancel path. No arbitrary WASM
upgrade, policy/mode update or routing setter can bypass constants. Legacy
`deposit`, `execute_step`, `receive_and_forward`, `distribute`, Pay `cancel` and
Pay/Split `set_next_steps` refuse policy-aware instances. Admin Split pause/unpause
retains its existing availability control and does not rewrite configuration.

## Builder declaration and review (#1161)

Pay settings offer a constant recipient or one supplied by the payer on each
payment. The configured payout rule/value remains constant. Split settings offer
independent recipient/allocation sources for each stable configured row, plus an
appended payer-supplied recipient/allocations list. A constant platform recipient
and share can remain fixed while destinations and remaining allocations vary.
Draft edits preserve surviving identities/modes; newly configured rows start
constant. Changing a draft is not an update to a deployed contract.

Runtime fields hide their saved draft address/allocation controls and explain that
every input is required for every payment, with no saved default. Percentage totals,
rounding and exact fixed execution funding are described beside the controls and
in the complete-path English/deployment review. Deployment trustline checks include
only configured recipients; the payer's actual destinations are checked at payment
preparation. Template creation bindings and stored updates remain distinct, and no
stored-update option is offered here.

The server resolves this environment's configured hashes using the normal
DB/environment resolution and compares each participating kind against the reviewed
manifest. Draft design/save remains available before activation, with an explicit
unavailability message. Policy-aware deployment controls are withheld until all
required kinds match. The server preparation path repeats its authoritative checks;
UI readiness never authorizes an artifact or weakens deployment validation. Existing
mode-less flows keep their configured behavior and ordinary deployment controls.

## ABI and persistence handoff

`contracts/execution-v1.rs` is included by the three standard contracts and defines
one ABI. `lib/stellar/execution-v1.ts` owns its ScVal encoding and strict read
decoding. Constructor **argument counts are preserved**, but the relevant argument
is now Rust `Val`, accepting either the old native shape or the v1 struct below.
This is still an ABI/spec change and requires newly reviewed WASMs for v1 use.

| Contract        | Existing config-bearing argument      | V1 struct                                                                                   |
| --------------- | ------------------------------------- | ------------------------------------------------------------------------------------------- |
| Deposit trigger | `next_steps`: legacy target vector    | `RootConfig { version, node_id, min_amount, next_steps }`                                   |
| Pay             | `recipient`: legacy address           | `PayConfig { version, node_id, recipient_mode, payout_value_mode, recipient, payout_rule }` |
| Split           | `recipients`: legacy recipient vector | `SplitConfig { version, node_id, allocation_mode, rows, additional_mode }`                  |

`FieldMode = Constant | Execution | Mutable`; Mutable is defined for shared ABI
continuity but rejected in this phase. `PayoutRule = Full | Fixed(i128) |
Percentage(u32)`. Configured Split rows contain `row_id`, field modes, optional
recipient and `MaybeAllocation = Missing | Present(Allocation)`, where Allocation
is `Fixed(i128) | Percentage(u32)`. The explicit allocation absence avoids the
SDK v26 host conversion limitation for `Option<custom enum>`. Recipient absence is
ScVal void; unknown struct keys or enum variants fail conversion.

Root `execute_v1(payer, asset, amount, nonce, expires_at_ledger, bindings, inputs)`
uses ordered node/address/revision bindings and typed Pay/Split inputs. Children
receive `execute_step_v1(context, asset, amount)`, with the same original funded
amount, payer/root/nonce/expiry, full bindings/inputs and a checked path index.
`executionV1Args(intent)` is the exact API/SDK encoding handoff. The signed
transaction binds the environment passphrase; the invoked root binds its address.
Deployment/tenant IDs remain orchestration evidence, not replacement authorization.

`capabilities()` refuses legacy instances. Policy instances report policy/ABI 1,
execution true, mutation false, immutable policies true and revision binding true.
`field_policy()`, `config_revision()` and `current_config()` expose immutable policy
and confirmed state; revision starts at zero. Root current_config includes policy,
revision and asset. Pay adds parent, next steps and configured payout; Split adds
parent and minimum (zero for compiled v1). Decoding returns the shared confirmed
configuration envelope, with runtime fields absent, plus immutable asset/routing.
The API reader must verify it against original deployment evidence at a consistent
confirmed ledger and validate the actual executable hash, not trust getter labels.

## Verified execution reads

The server brackets all capability/configuration getters with two complete batches
of contract-instance ledger entries. For reviewed execution and guarded artifacts,
these getters derive their state from instance storage. Each batch must contain
exactly the expected live entries with matching keys, contract addresses and pinned
WASM hashes. Every getter must succeed without restoration and report a ledger
within the two batch ledgers. Both instance XDR values and last-modified ledgers
must match, including when a value changed and then reverted. A bounded retry
restarts the complete observation after a detected change or inconsistent response.

Ledger advancement alone does not invalidate unchanged state. Returned configuration
observations use the final batch's common confirmed ledger. Guarded mutation reads
run their authority/revision/obligation getters inside this same window and persist
history only after successful verification. Revisions alone cannot fence obligations:
accepted Split accumulation can change without a configuration update.

This relies on the configured RPC serving consistent ledger snapshots and accurate
[entry modification metadata](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getLedgerEntries).
Actual concurrent instance writes can still require a retry; this is not throughput
qualification. The reviewed getters do not depend on ledger time or external storage;
new artifact support must recheck that dependency before using this fence. Contract
revision and obligation checks continue to protect the later read/send race. A late
hosted review failure after durable preparation retains its original capability,
request and intent/hash for recovery; an HTTP 502 is not proof of non-admission.

Deployment accepts v1 only when **every** selected template/hash matches
`EXECUTION_V1_WASM_HASHES` in `lib/stellar/execution-artifacts.ts`. Old/missing/
unknown/wrong-kind artifacts fail before RPC. The prepared `pipelineSnapshot`
retains each exact `wasmHash` and `artifactCapabilities` beside its durable address;
no lookup of today's registry can replace that evidence. Existing mode-less
deployments retain their legacy snapshot shape. Constructor changes must be rebuilt
and independently reviewed with matching manifest hashes; an env flag does not
grant capability. No active registry/env value is changed here.

Execution error discriminants are stable and separate from legacy contract errors:
101 invalid policy, 102 invalid input, 103 invalid amount, 104 unauthorized,
105 stale revision, 106 unsupported capability/path, 107 expiry, 108 replay,
109 arithmetic overflow. Native SDK conversion/auth failures may precede these.

## Local verification and resource evidence

Build with the repository lockfile and Rust **1.95.0**:

```sh
cd contracts
cargo build --locked --release --target wasm32v1-none -p deposit_trigger -p payer -p paiflow-splitter
cargo fmt --all -- --check
cargo clippy --all-targets -- -D warnings
cargo test --workspace
cargo test -p payer --test runtime-inputs -- --ignored --nocapture
cd ..
node --import tsx scripts/check-execution-artifacts.ts
```

The final manifest verification reports exact hashes and byte sizes. The ignored
WASM test reads those local build outputs and executes real root/Pay/Split WASMs
against a test-only SEP-41-shaped token using exact source-account credentials.
Ordinary tests cover raw auth/input/revision/replay/roster failures and unrelated
balances, with no network or wallet funding. The ignored legacy profile fixture can
run against base `a7a5a9a9e752974db0f09aa34c625d9f235c7c8a` for comparison.
For the same 111-stroop root → fixed-10 Pay → 10%/90% Split financial outcome:

| Local fixture                                              | Instructions |  Metered memory | Writes |
| ---------------------------------------------------------- | -----------: | --------------: | -----: |
| Base `a7a5a9a9`, native contracts                          |      718,624 |    87,059 bytes |      6 |
| V1 native contracts, runtime roster and unrelated balances |    1,886,264 |   221,362 bytes |      7 |
| V1 compiled WASMs, same v1 fixture                         |    6,796,340 | 6,480,879 bytes |      7 |

These are local host estimates, not live fees, throughput or supported network-scale
claims. Native estimates omit guest VM costs. The v1 fixture additionally proves
unsolicited holdings remain untouched, and adds validation, exact balance-delta
checks and replay writes; it is more expensive, not an assumed efficiency win.

SDK v26's debug auth-snapshot observer exhausts its separate shadow budget in this
WASM fixture after the extra balance calls. The bounded functional run disables
only that observation hook, retains real source-account authorization and the
default CPU/memory budget, and asserts the financial outcome; IO resource snapshots
in that diagnostic run may be unavailable and are not reported as successful IO
limit evidence. A separate unlimited-harness profiling run retains auth/IO
observations, verifies the payer's auth record and asserts metered CPU/memory below
100 million/40 million respectively. The table's full WASM resources come from
that profiling run. Neither run is proof of network resource suitability. Ordinary
native security tests still enforce exact auth entries and reject altered signed
inputs, unauthorized parents, stale revisions and replay without mock-all-auth.
Network resource suitability remains a simulation and
cross-layer acceptance concern in #1163. Actual activation requires separate approval.

The [cross-layer acceptance and activation plan](execution-readiness.md) connects
production-generated constructor/call XDR to HTTP/hosted flows and compiled WASMs,
records the 20-recipient diagnostic and the 40-node memory refusal, and distinguishes
dated public network settings from local SDK defaults. It is not an activation or
funded-wallet acceptance record.

## Guarded mutation-capable artifact generation (#1168)

The original execution-only hashes above remain trusted for existing pinned
snapshots with `mutation: false`. New standard root/Pay/Split builds add guarded
stored configuration without retrofitting those contracts. The per-hash manifest,
constructor initial mutable roster wrapper, current-state reads, whole-path
obligation admission and local resource comparison are documented in
[mutation v1](mutation-v1.md). New mutable graphs require that new artifact generation
throughout the path; existing execution-only graphs remain compatible with their
old pinned hashes and strict execution semantics. The local verifier now defaults
to the current guarded source build; use `--execution-only` when verifying a rebuild
of the retained execution-only source. No artifact activation is implied.
