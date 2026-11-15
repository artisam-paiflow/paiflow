# Conditional reusable payments: v2 foundation

Ordinary-flow source authoring, deployment review and owner recovery are described in [conditional authoring](conditional-authoring.md). Artifact activation and live acceptance remain separate.

Shared contract for [#1222](https://github.com/webnxt-2030/pinkraft/issues/1222),
under [#1221](https://github.com/webnxt-2030/pinkraft/issues/1221). This document is
normative for #1223–#1228. `lib/flows/conditional-v2.ts` and
`conditional-v2-state.ts` define strict, **unavailable-at-runtime** domain values.
They are not an extension of v1 payloads or a declaration of trusted artifacts.
The source implementations are described in [conditional execution v2](conditional-execution-v2.md)
and [guarded conditional mutation v2](conditional-mutation-v2.md). Neither activates
the conditional generation in deployment, API, SDK or discovery runtime paths.

## Compatibility and availability

| Generation           | Wire / ABI                                                | Runtime disposition in this foundation                            |
| -------------------- | --------------------------------------------------------- | ----------------------------------------------------------------- |
| Mode-less legacy     | Existing configured graph and constructors                | Preserve existing semantics and original evidence                 |
| Execution-only v1    | Policy 1, execute_v1, retained execution hashes           | Preserve exact pins and existing receipts                         |
| Guarded immediate v1 | Policy 1, execute_v1 / mutate_v1, guarded hashes          | Preserve exact pins, current state and recovery                   |
| Conditional v2       | Definition / intent / arguments 2, execute_v2 / mutate_v2 | Domain only; deployment, execution, mutation and discovery reject |

V2 uses separate schemas and entry points. Never add conditional cases to a v1
union, reinterpret version 1 as a branched graph, substitute the latest registry
for an immutable artifact pin, or infer capability from parsing this definition.
Existing `fieldPolicies.version: 2` fails the v1 literal check. Canvas graphs have
no top-level `version`; reserved normalized-definition keys must fail before legacy
unknown-key stripping, including mixed legacy/v2 packets. Normalized v2 values
must never pass the legacy compiler after their identifying fields are stripped.

No hashes, trusted-manifest entries, registry updates, runtime `supported: true`
response, API routes or SDK release are introduced here. Later implementations
must require **all** Receive, Pay, router and Split artifacts in one explicitly
reviewed conditional generation, verify their exact deployed executable hashes,
and compare capability getters with immutable pins. Mixed v1/v2 paths fail.
Required future capability tuple is `{policy_version:2, execution_abi:2,
mutation_abi:2, conditional:true, execution:true, mutation:true,
immutable_policies:true, revision_binding:true}`. This is an ABI requirement,
not an advertised capability. Both conditional execution and whole-graph guarded
mutation enforcement must exist before that tuple becomes trusted. Old manifests
remain retained. Factory kind-agnostic deployment remains unchanged.

Private templates, creation bindings, version publication and instance workflows
retain their existing schemas and behavior. A conditional-v2 definition is not a
new template input. Shared template readers continue to reject unsupported policy
versions/artifact pins. No template compatibility expansion is needed here.

## Definition, topology and immutable evidence

The normalized `ConditionalDefinition` has `version:2`, one resolved
`assetContract`, immutable deployment `owner`, `root`, ordered `prefix`, one
`condition`, `trueBranch`, and `falseBranch`. `root` contains its node ID and
nonnegative minimum amount. The prefix contains only sequential partial Pays;
each branch is exactly one terminal Pay, Split or `{kind:"return_to_owner",
nodeId}`. A Pay/Split contains its existing policy and resolved stored
configuration. The condition contains `nodeId`, strict `kind: amount_gt | amount_lt`,
`thresholdStroops` and `thresholdMode: constant | mutable` (default constant).
Execution is never a threshold mode. All objects reject unknown keys.

This representation makes joins, cycles, extra roots, nested conditions, branch
chains, fan-out, extra assets and mutable topology unrepresentable. The future
canvas adapter must independently reject every extra/disconnected node or edge,
require explicit True and False condition handles, one parent per non-root node,
and no other branching. It must not discard unsupported graph fragments to create
a valid normalized definition. At most 40 **complete graph** nodes are allowed,
including root, condition and both terminals; a prefix therefore has at most 36
Pays. Structural limits do not establish network/resource suitability.

The immutable original graph, definition, field modes, configured Split row IDs
and order, payout/allocation kinds, asset, admin, comparison kind and all links
are constructor evidence. Persist those alongside the complete compiled pipeline
and artifact/ABI pins. Current stored values are separate observations. A prepared
intent embeds the **verified current** definition at its bound revisions, not a
replacement for initial snapshots. Compare every immutable leaf and constant to
initial evidence before trusting a current definition. No history or registry
lookup may rewrite initial evidence.

Return to owner lowers to the existing `PAYER` contract family: full payout,
constant recipient equal to immutable owner/admin, constant full payout policy,
no next steps and no execution or mutation fields. Keep the authored
`return_to_owner` node ID and semantic kind in the compiled implementation/review
mapping, with resolved owner address, asset, router parent and pinned PAYER hash.
Do not represent it as an editable Pay in immutable review evidence or create an
independent contract family. Its current revision is always zero. The owning
Paiflow account's email is not a destination; resolve the deploying owner wallet
at preparation. The payer may differ from owner. Its own incoming budget is paid
to owner; terminal ordinary Pay's unused remainder is refunded to **payer**.

## Amount and selected input rules

Amounts are canonical decimal strings, bounded by signed i128 max. Thresholds
and minimum/obligation amounts may be zero; funded amounts and fixed payouts are
positive. Revisions are canonical u64 strings starting at zero. Bps remain integer
numbers 1–10,000. All arithmetic is checked. Prefix Pay percentage is strictly
less than 10,000; full payout cannot precede a condition.

Starting with the funded amount, apply prefix payouts in path order. Fixed Pay
requires sufficient incoming budget; percentage Pay deducts
`floor(incoming * bps / 10000)`. Implement checked wide multiplication or the
algebraically equivalent quotient/remainder calculation to avoid intermediate
i128 overflow. Refuse a zero remaining budget. Test that remaining amount, never
raw holdings or the original funded amount, against the current threshold:
`amount > threshold` or `amount < threshold`. Equality always selects False.
V2 compares directly; it does not implement greater-than by incrementing the
threshold. Zero and i128-max thresholds are valid; max greater-than is always
False, without wrap or narrowing.

`arguments:{version:2,inputs:[...]}` carries existing Pay/Split node input shapes.
The client supplies amount and values, never an authoritative branch choice.
Preparation computes selection from verified current terms. Require every declared
execution field on the prefix and selected terminal, and no other input. Constant,
mutable, unknown, duplicate, Return/condition/root and inactive-branch inputs fail.
Canonical input order follows prefix then selected terminal; configured Split
row inputs follow their declared row order, followed by additional rows in their
explicit order. API/UI must discard unprepared branch-local values when the route
changes; an already prepared original is never silently rerouted or rebased.

Merge inputs with current stored fields only after exact field-set validation.
Preserve v1 recipient uniqueness, row membership, count, allocation mode, totals,
constant shares and last-row rounding. A selected fixed Split with **any** execution
field requires an exact incoming total. Constant-only fixed Split retains accepted
accumulation and its existing batch/residual rules. Fixed Pay underfunding fails;
terminal ordinary Pay refunds its unused incoming remainder. Percentage Split
uses configured-then-additional row order and assigns remainder to the last row.
Unselected terminals receive neither execution nor funds. Preserve exact supported
asset transfer-delta checks; unrelated holdings never enlarge the call budget.

## Complete bindings, routing and authorization

`nodes` is always the complete ordered vector:

1. Receive root.
2. Prefix Pays in money-path order.
3. Condition.
4. True terminal.
5. False terminal.

Each entry is `{nodeId,contractAddress,expectedRevision,wasmHash}`. IDs and
addresses are unique. Root and Return revisions are zero. The condition revision
covers threshold changes; each Pay/Split revision covers its stored configuration.
Every node, including constant nodes and the inactive terminal, is bound. Root
preflight verifies exact length/order, all identities, immutable parents/links,
asset/admin, executable capability pins and **every current revision** before
pulling payer funds. Any revision change anywhere rejects an old payment. There
is no old-config execution fallback. Constructor topology plus exact artifacts
binds policy/constants; the intent also retains the verified current definition.

The execution intent contains version 2, deployment UUID, passphrase hash, root,
asset, payer, funded amount, random 32-byte nonce, finite positive u32 ledger
expiry, complete nodes, current definition, arguments, computed selected branch
and amount-at-condition. The server provides deployment/network/pins; callers
cannot select authoritative chain state. Preserve request/key digest, exact
unsigned envelope and hash, fee, signer, nonce, expiry and artifact evidence before
signing. Contract/auth arguments carry the full context; transaction signing binds
the environment passphrase. Expiry must satisfy `current_ledger < expiry <=
current_ledger + 720` at admission, and execution fails at/after expiry. Use checked
u32 arithmetic. Root retains consumed `(payer,nonce)` through expiry and checks
explicit expiry independently of TTL. Rollback restores nonce and all funds/state.
No mutable per-payer argument slot or last-recipient cache is permitted.

Future Rust ABI (snake_case fields; strings/amounts/revisions map respectively to
SDK String, i128/u64; hashes to BytesN<32>, addresses to Address):

```text
execute_v2(payer, asset, amount, nonce, expires_at_ledger,
           bindings: Vec<GraphBindingV2>, inputs: Vec<NodeInput>, route: RouteV2)
RouteV2 { selected_branch: True|False, amount_at_condition: i128 }
ExecutionContextV2 { payer, root, asset, funded_amount, nonce, expires_at_ledger,
                     bindings, inputs, route }
execute_step_v2(context: ExecutionContextV2, amount: i128)
```

`GraphBindingV2` has the same four fields as the domain binding. The root is the
invoked address. The authenticated route is a reviewed assertion, independently
recomputed by root from bound current terms and again checked by the router
against its actual incoming budget; it is never a payer-selected routing override.
The route indices are `[0, prefix indices..., condition index, selected terminal
index]`; True does **not** forward to the following False binding. Terminals
require no remaining selected-path step or unused selected input.

The payer authorizes the root's entire call including both branches' bindings,
inputs and route. Every child requires its immutable parent's authorization for
the exact full context and hop amount, verifies own ID/address/index/revision,
stored root/admin/asset/parent and expiry, rejects missing/extra context, and
forwards only its incoming conserved remainder to its immutable selected successor.
The condition verifies comparison, threshold revision and actual arriving amount
before authorizing exactly one terminal. A terminal validates that it is the
selected endpoint. Inactive contracts are read during root preflight, not executed
or authorized for payout. All old deposit/execute/charge/release/cancel/refund,
setter/routing and upgrade paths must reject v2 instances if they omit these checks.
There is no arbitrary upgrade escape or permissive policy-less fallback.

## Constructor and immutable manifest ABI

Compile Receive to `DEPOSIT_TRIGGER`, condition to `ROUTER`, Pay/Return to `PAYER`,
and Split to `SPLITTER`. V2 constructors use a tagged argument wrapper, separate
from all retained legacy/v1 constructor decoders:

```text
NodeInitV2 is the tagged value in an arity-preserving constructor slot below
NodeInitV2 { version:2, node_id:String, manifest:GraphManifestV2 }
GraphManifestV2 { version:2, root:Address, admin:Address, asset:Address,
                  nodes:Vec<InitialArtifactV2> }
InitialArtifactV2 { wasm_hash:BytesN<32>, state:NodeStateV2 }
```

Every manifest state has revision zero. The nodes use complete canonical order;
each state's node ID/address, admin/asset, nullable parent, ordered successors and
full original policy/configuration are fixed. Root address equals the first state.
The factory/compiler passes the same complete manifest to every node constructor,
using deterministic precomputed child addresses. Each constructor validates the
whole shape and its own node's identity, expected semantic/family kind and all
immutable values; it cannot accept a caller-supplied alternative owner or graph.
All are initialized atomically in the factory deployment transaction. Constructors
validate only static manifest values and their own identity; they never query
children that the sequential factory has not deployed yet. Complete live child
manifest/current-state reads happen at execution preflight.

Each node stores this immutable complete manifest in instance storage, alongside
separate current values/revision and any accounted obligations. No constructor
hash is advertised by the foundation. A declared hash is a pin to verify against
the deployed executable, not a self-attestation. Deployment preparation verifies
the trusted manifest; runtime root preflight compares the full ordered bindings
against stored manifest IDs/addresses/hash pins, then obtains every live revision
and status before funding. Children compare the full forwarded bindings to their
same immutable manifest as well as checking local revision/context. Current values
never overwrite that manifest. It is intentionally a correctness-first shared
shape; simulation/resource validation must refuse oversized combinations. Any
future storage optimization must preserve exactly these checks and read fencing.

`graph_manifest_v2() -> GraphManifestV2` returns the immutable complete manifest on
every node. `field_policy_v2() -> NodeStateV2` is an exact alias of
`initial_config_v2()` (full original state, revision zero), not an unspecified second
policy representation. Its Pay/Split policy fields reuse the normalized policy
shapes; the outer state carries wire version 2. The condition policy and initial
threshold are its ConditionState. These getters never return changed values.
The compiler preserves authored semantic kinds in these states and its durable
implementation map, even where both Pay and Return use PAYER artifacts.

## Concrete implementation compatibility and encoding (#1223)

The following constructor/getter adapters supersede the abstract single-init
constructor notation. Inspection of existing standard-family constructors and
strict v1 getter consumers requires preserving their legacy call shapes. No
private-template feature is expanded by these adapters.

| Kind         | Wire arguments (Env excluded)                                       | V2 tagged slot               |
| ------------ | ------------------------------------------------------------------- | ---------------------------- |
| Receive      | admin, asset, next_steps                                            | next_steps: Val = NodeInitV2 |
| Pay / Return | admin, asset, recipient, amount, percentage_bps, next_steps, parent | recipient: Val = NodeInitV2  |
| Split        | admin, asset, recipients, min_amount, parent, next_steps            | recipients: Val = NodeInitV2 |
| Router       | admin, asset, threshold, path_a, path_b, parent                     | threshold: Val = NodeInitV2  |

Router broadens its third argument's decoder to Val: retained i128 thresholds
continue down the legacy decoder unchanged. The v2 tagged init contains
`version:2`, `node_id`, and the complete `manifest`. Unknown/malformed tagged values
must fail without a legacy fallback. Every redundant outer argument must equal its
manifest-derived value. Router path_a is exactly the True successor and path_b the
False successor; comparisons use the immutable comparison enum directly, never
legacy threshold adjustment. Pay amount/bps match its payout rule; Return has
amount0/bps10000 and no successors. Split min_amount is0 and has no successors.

All v1 getters preserve their names and return types on retained instances. V2
instances reject old getter and mutating/execution entry points. Separate v2
getters are `capabilities_v2`, `graph_manifest_v2`, `field_policy_v2`,
`initial_config_v2`, `current_config_v2`, `config_revision_v2` and
`mutation_status_v2`. `field_policy_v2` aliases `initial_config_v2` exactly. All
getters read instance storage, preserving the whole-graph read fence.

Freeze the concrete shared Rust wire types in `contracts/conditional-v2.rs`:

```text
ComparisonV2 = AmountGt | AmountLt
StoredModeV2 = Constant | Mutable
ReceiveStateV2 { min_amount:i128 }
ConditionStateV2 { comparison:ComparisonV2, threshold:i128, threshold_mode:StoredModeV2 }
ReturnStateV2 { recipient:Address }
NodeConfigurationV2 = Receive(ReceiveStateV2) | Pay(PayConfig) |
  Split(StoredSplitConfig) | Condition(ConditionStateV2) | ReturnToOwner(ReturnStateV2)
NodeStateV2 { version:u32, node_id:String, contract_address:Address, revision:u64,
  admin:Address, asset:Address, parent:Option<Address>, next_steps:Vec<Address>,
  configuration:NodeConfigurationV2 }
InitialArtifactV2 { wasm_hash:BytesN<32>, state:NodeStateV2 }
GraphManifestV2 { version:u32, root:Address, admin:Address, asset:Address,
  nodes:Vec<InitialArtifactV2> }
NodeInitV2 { version:u32, node_id:String, manifest:GraphManifestV2 }
GraphBindingV2 { node_id:String, contract_address:Address,
  expected_revision:u64, wasm_hash:BytesN<32> }
RouteV2 { selected_branch:True|False, amount_at_condition:i128 }
ExecutionContextV2 { payer:Address, root:Address, asset:Address, funded_amount:i128,
  nonce:BytesN<32>, expires_at_ledger:u32, bindings:Vec<GraphBindingV2>,
  inputs:Vec<NodeInput>, route:RouteV2 }
MutationStatusV2 { state:NodeStateV2, obligations:i128 }
```

PayConfig, StoredSplitConfig, NodeInput and their nested types reuse the existing
v1 value encodings. Their internal config version remains1; only the enclosing
conditional generation is2. Maps use exact snake_case struct keys and XDR-sorted
symbol keys; enum values use ordinary Soroban tagged vectors with the exact variant
names above. Option<Address> encodes None as ScVal Void and Some directly as ScAddress.
Option<Vec<T>> encodes None as Void and Some directly as ScVec, including an
explicit empty vector. These are not tagged Some/None enum vectors.
MaybeAllocation remains the distinct tagged Missing/Present enum. A child derives its
complete-graph position from immutable manifest address and node ID; there is no
caller-controlled index or mutable global routing slot.

Before funding, root compares every child's full immutable manifest against its
own, then verifies local current state/revision and the reviewed pins. On-chain
pins bind the immutable declared manifest; SDK26 has no general child-executable
introspection getter. Actual deployed WASM hashes must also be verified by the
snapshot-pinned RPC reader before a payer authorizes an API/hosted or direct-client
payment. No retained or v2 contract exposes an arbitrary WASM upgrade path; a
getter/capability claim is never executable provenance. Do not claim on-chain
binary introspection where only immutable pin comparison is performed.

#1223 implements execution and getters only. Its local capability getter returns
`{policy_version:2,execution_abi:2,mutation_abi:0,conditional:true,execution:true,
mutation:false,immutable_policies:true,revision_binding:true}`. This is a partial
implementation tuple, not a trusted public availability claim. It must not enter
any production trust manifest/discovery response. The full mutation tuple above
is implemented separately by [#1224](conditional-mutation-v2.md); public integration
additionally requires the API/reader work and explicitly reviewed artifact activation.
No deployment/compiler/API may infer availability from accepting the pure v2
schemas or this local getter. All old v1 mutation/routing/legacy entry paths reject
v2 instances until an explicit enforcing v2 method exists.

## Atomic mutation and whole-graph obligations

`arguments:{version:2,changes:[...]}` accepts existing Pay/Split patches and
`{kind:"condition",nodeId,expectedRevision,thresholdStroops}`. Changes are partial,
nonempty and unique, ordered by complete graph order. Every named node must
actually change, have matching expected revision and remain below u64 max before
increment. A condition patch requires mutable threshold policy; comparison, mode,
links, asset and owner cannot change. Validate merged Pay/Split state with existing
constant preservation, fixed payout kind, configured-row and allocation rules.
Root/Return changes and execution-field/constant overrides fail.
Split row patches name unique configured row IDs and may arrive in any order;
merging by ID preserves the stored configured order and its rounding semantics.
The complete-graph ordering rule applies to node changes, not to partial row patches.
`ConditionalMutationIntentSchema` wraps version 2, deployment UUID, environment
passphrase hash, root contract, immutable admin, verified current definition,
complete nodes and exact mutation arguments. The prepared-envelope record
separately retains fee/timebound/sequence/hash and durable admission identity. Changes advance
each changed node exactly once; unchanged nodes retain revisions.

```text
mutate_v2(bindings: Vec<GraphBindingV2>, changes: Vec<NodeChangeV2>)
MutationContextV2 { root, admin, bindings, changes }
mutate_step_v2(context: MutationContextV2)
ConditionMutationV2 { node_id:String, expected_revision:u64, threshold:i128 }
NodeChangeV2 = Pay(PayMutation) | Split(SplitMutation) | Condition(ConditionMutationV2)
```

PayMutation and SplitMutation retain their existing v1 wire fields, but v2 merges
and revision checks operate on NodeStateV2, never v1 policy storage. Root mutation
has exactly two arguments; child mutation has one complete context argument.
Options retain Void/bare-value encoding and MaybeAllocation retains its tagged
Missing/Present representation. There is no mutation branch selector or index.

The root authenticates its immutable admin for the entire group. Before applying
anything, it queries `mutation_status_v2()` on **every** complete-graph node, verifies
all immutable identities/topology, current revisions and accounted obligations,
and rejects if any obligation is nonzero. This includes inactive-branch accepted
fixed Split accumulation and debt after token loss even with raw balance zero.
Root, condition and Return report zero accounted obligations; Pay/Split report
actual accounting. Unsolicited holdings are not obligations and are not transferred
by mutation. No timeout, reset, clear, sweep or missing database row erases debt.
Only actual settlement discharges it. Repair funding preserves the original terms.

Apply the group in complete order, traversing both terminals independently; no
payment route selects mutation reach. Each child requires its stored parent's
authorization for the exact full mutation context. Each changed child also requires
admin authorization, checks local revision/obligations/field eligibility and emits
one resulting-state event. Unchanged nodes authenticate forwarding and validate
identity/revision. Root explicitly authorizes its successor; the router authorizes
both terminals. Parent auth alone never grants admin mutation authority. The
simulation must produce the actual full auth tree, including changed children.
Check/apply is one atomic invocation with shared instance dependencies; any later
failure rolls back every update/event. No mutation transfers tokens.

## Getter, current-state and history handoff

All v2 getters read instance storage so the shared whole-graph instance fence is
sufficient. Introducing persistent configuration/obligation dependencies requires
extending that fence before enabling it. Concrete common getters are:

```text
capabilities_v2() -> capability tuple above
initial_config_v2() -> NodeStateV2                       # original values, revision 0
current_config_v2() -> NodeStateV2                       # resolved stored values
config_revision_v2() -> u64
mutation_status_v2() -> MutationStatusV2
NodeStateV2 { version:2, node_id, contract_address, revision,
              admin, asset, parent:Option<Address>, next_steps:Vec<Address>,
              configuration: ReceiveState|PayState|SplitState|ConditionState|ReturnState }
ReceiveState { min_amount:i128 }
ConditionState { comparison: AmountGt|AmountLt, threshold:i128,
                 threshold_mode: Constant|Mutable }
ReturnState { recipient:Address }                     # immutable admin, full payout
MutationStatusV2 { state:NodeStateV2, obligations:i128 }
```

The `configuration` discriminant is the semantic kind (including distinct
ReturnToOwner), so there is no independent semantic tag that can disagree.
PayState/SplitState carry node ID, immutable field policy plus resolved configuration,
using the existing v1 value representation (execution fields tagged absent).
`next_steps` for condition is exactly `[True address, False address]`, prefix/root
has exactly one successor, all terminals have none. Parent is None only for root.
`field_policy_v2()` returns exactly the original `NodeStateV2` as specified in the
constructor section; it never reports changed values as initial.
ReturnState has no editable policy. `initial_config_v2()` includes initial appended
Split roster; getter truth is checked against immutable original evidence.

`ConditionalCurrentConfigurationSchema` defines the strict decoded whole-graph
wire observation: version, confirmedLedger, definition, complete nodes and
per-node statuses `{state,obligationsStroops}`. Decoded state uses `nodeId`,
`contractAddress`, `revision`, `admin`, `assetContract`, nullable `parentContract`,
ordered `nextContracts`, and tagged `configuration`. Pay/Split configurations
include `nodeId`, `policy` and `configuration` from the normalized definition;
condition includes `kind:"condition"`, `comparison`, `thresholdStroops` and
`thresholdMode`; receive includes `kind:"receive"` and `minAmountStroops`; Return
includes `kind:"return_to_owner"` and immutable `recipient`. Status shape and
linkage checks live in `conditional-v2-state.ts`.
A read is trusted only after exact snapshot-pinned executable verification, getters
and immutable-value comparison, and a closing instance witness for **all** graph
nodes including inactive branch. Use existing bounded concurrency/deadlines and
retry the complete read on a changed witness. Returned ledger is the closing
confirmed observation ledger, not a claim every getter ran in that ledger. Equal
wall-clock/latest ledger numbers alone do not establish consistency. Unknown,
missing, mismatched or failed reads refuse preparation/editing; history is never
a substitute for failed current observation.

Changed nodes emit topics `(Symbol("config_v2"), node_id)` with complete
`NodeStateV2` data, including resulting revision, policy/current values and immutable
root/parent/asset/admin/branch linkage. Root is recoverable from immutable graph
membership (and verified against the root's status); the event has no mutable root
parameter. Conditional payment router emits topics `(Symbol("route_v2"), node_id)`
and data `{root,payer,nonce,amount_at_condition,selected_branch,
condition_revision,bindings}`; it contains no private contact metadata. Exact
transfer events remain available for accounting; a route event is not transfer
proof. Failed calls leave no successful route/config events.

Decode config-v2 separately from config-v1. Validate emitter against immutable
snapshot and semantic kind, preserve eventId/tx hash/event ledger and full decoded
state; use existing monotonic event-cursor advancement and idempotent eventId.
Append observed per-node revisions without overwriting initial snapshots or
regressing verified current state on replay/out-of-order events. Preserve conflicting
evidence and fail closed. History coverage stays `observed-revisions-only`,
`historyComplete:false`, explicit revision gaps and nullable event provenance for
getter-only observations. A grouped tx can have several events; never deduplicate
by transaction hash or assume today's current revision proves complete history.

## Downstream ownership and release boundary

| Issue | Concrete handoff                                                                                                                                                                                               |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #1223 | Strict normalized topology adapter; v2 constructors/encoding, execute/root preflight, authenticated selected routing, owner lowering, exact compiled semantic map, bypass audit and real Rust/compiler vectors |
| #1224 | Same ABI owner as #1223; whole-graph statuses, parent/admin mutation tree, grouped merge/revisions, getters/config-v2 events and obligation settlement vectors                                                 |
| #1225 | Shared fenced reader with #1226; server-computed route/inputs, complete pins/current intent, canonical signing receipt and existing exact-original execution lifecycle                                         |
| #1226 | Same reader; condition patches, exact admin receipt, refusal/admission lifecycle, append-only config-v2 history and direct external edits                                                                      |
| #1227 | Canvas adapter and explicit authoring availability; both-branch immutable/current review, owner distinction, selected requirements and exact mutation/signing recovery                                         |
| #1228 | Existing opt-in/ownership proof/public limits and #1225 sender; show actual route, amount-at-condition and owner destination, retain scoped original recovery                                                  |
| #1229 | Production packets vs compiled execution/mutation, stale inactive revision/obligation races, compatibility, resource and separately authorized release acceptance                                              |

Keep `/api/v1` legacy/v1 request and receipt shapes unchanged. #1225/#1226 may add
an explicitly version-discriminated v2 operation within the existing API major
only after auditing strict SDK/UI consumers and updating OpenAPI/release notes;
clients must opt into v2, never receive v2 in a v1 receipt. Reuse current session /
selected-deployment token permissions, rate limits, durable deployment-work and
retirement admission. API access never supplies payer/admin on-chain authority.
Public hosted ownership proof and privacy boundaries remain unchanged. No new
sender, credentials or private-key handling is introduced.

[#1225's explicit execution protocol](api/conditional-execution.md) selects v2
using a single `version=2` query parameter on execution discovery, preparation,
submission and reconciliation. Missing or explicit `version=1` keeps the existing
protocol. Separate SDK `execute.conditional` methods always opt in. Immutable
`paramsSnapshot` generation evidence and complete original compilation are
verified independently of binary support; a hash or schema parse never identifies
an instance generation by itself.

One-send exact-envelope verification and original-hash reconciliation apply to
both branches and mutations. Recheck verified complete terms before first send;
on-chain checks close later races. Unknown signing/submission/finality preserves
original request/key/intent/hash, capability and reservation. Reconcile original
before offering a fresh review; neither timeout, NOT_FOUND, expiry without required
proof, branch inactivity, access loss nor hosted opt-out permits replacement.
Use existing bounded RPC deadlines, explicit non-admission proofs and authoritative
expiry/finality recovery. Source completion does not complete predecessor gates,
artifact/network/hosted/wallet acceptance, or authorize upload/deploy/publication.

## Concrete handoff vectors

[Machine-readable vectors](conditional-v2-vectors.json) contain a complete normalized
current definition, complete synthetic artifact/revision bindings, a selected Split
execution intent, a mutable threshold patch and adversarial full intent packets.
`tests/unit/conditional-v2-vectors.test.ts` validates these examples directly. The
addresses and hashes are deterministic fixture values, never trusted artifacts.

The example funds 111 stroops, pays a fixed prefix fee of 10, then tests 101 > 100:
True sends 10%/90% to platform/worker with existing last-row rounding. Funding 110
instead tests equality and sends the remaining 100 to the immutable owner, who
is distinct from payer. Supplying the worker input for that False route fails.
The table in the JSON covers below/equal/above for both comparisons, max threshold
without overflow and zero threshold. Domain tests additionally cover sequential
fixed/percentage deductions, selected fixed Split exact funding vs constant-only
accumulation, duplicate/constant inputs, row conservation and grouped mutation.
No vector is an actual signed envelope or network execution proof.

V2 mutation preparation retains exact admin source, transaction sequence, finite
180-second envelope timebound and host authorization nonces/expirations. Full
bindings and expected revisions additionally make a successful state-changing
group unreplayable against its prior revision. Reconcile the same original hash;
do not add an independent auto-retry sender. The contract does not need a second
application payment nonce for token-free mutation; host auth and checked expected
revisions cover replay while existing durable admission protects preparation.
