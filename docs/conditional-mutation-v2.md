# Guarded conditional mutation v2

[#1224](https://github.com/webnxt-2030/pinkraft/issues/1224) adds guarded stored
updates to the [conditional v2 design](conditional-v2.md). This is a source and
local-verification change. Deployment admission, public API/SDK integration,
runtime discovery and artifact activation remain unavailable. Existing v1
contracts, payloads, trusted pins, template workflows and initial snapshots retain
their existing behavior; no deployment is retrofitted.

## Exact mutation ABI

```text
ConditionMutationV2 { node_id:String, expected_revision:u64, threshold:i128 }
NodeChangeV2 = Pay(PayMutation) | Split(SplitMutation) | Condition(ConditionMutationV2)
MutationContextV2 { root:Address, admin:Address,
                    bindings:Vec<GraphBindingV2>, changes:Vec<NodeChangeV2> }
mutate_v2(bindings, changes)
mutate_step_v2(context)
```

The root takes two arguments; a child takes one complete context. Existing Pay
and Split patch wire types are reused, including Void/bare-value Options and the
tagged Missing/Present allocation representation. V2 state merging and revision
checks use NodeStateV2; v1 storage routines are not an adapter for v2 state.

Complete ordered bindings cover Receive, every prefix Pay, condition, True and
False terminal, with exact declared artifacts and expected current revisions.
Changes form a nonempty, unique subsequence of that order. Each named node must
actually change. Thresholds range from zero through i128 max; only declared
mutable thresholds may change. Pay/Split patches preserve payout/allocation kind,
configured row identity/order, all constant/execution fields and every field mode.
Comparison kind, topology, asset, admin and owner return destination never change.
Every changed revision advances once with checked u64 arithmetic.
Split row patches may name their unique configured IDs in any order. Merging by
ID retains configured row order and therefore the original rounding order.

## Authorization, admission and atomicity

The immutable admin authorizes the full root invocation. Root preflight reads
every graph member's manifest and current mutation status before writing any
configuration. Identity, topology, immutable policies, pinned bindings and all
current revisions must agree. Any nonzero accounted obligation anywhere refuses
the whole group, including an inactive branch's accepted fixed Split accumulation
or debt after raw tokens disappear. Missing or invalid observations fail closed.

Forwarding traverses the full prefix and both terminals. Each child requires its
stored parent's authorization for the exact complete context; a changed child
also requires the admin's authorization. Parent authority alone cannot grant
configuration authority. Unchanged children still validate identity, binding and
obligation state. Mutation never chooses one payment branch to inspect.

Admin authorization entries contain the root and changed nodes that actually
require admin authority. Unchanged forwarding nodes are omitted from that admin
tree; their stored-parent authorization is checked separately. Use the exact
simulated authorization entries when signing, including the full context at each
changed child. A topology-derived admin tree with extra forwarding frames can
fail even when it names the right changed nodes.

All merges, local guards and writes execute in one atomic invocation. Empty,
duplicate, unordered, irrelevant, constant, no-op, invalid allocation or revision
overflow groups fail as a whole. A late child failure rolls back earlier state
and events. Mutation transfers no tokens, resets no obligations and preserves
unsolicited balances. Only actual settlement under accepted terms discharges
accounted debt; repair funding does not itself erase it.

## Current state, events and downstream readers

Initial state and full original manifest remain separate from current state.
Current-state validation permits only declared mutable leaves to differ from
their originals. In particular, a percentage Split reserves at least one basis
point for each configured missing execution allocation; optional additional
execution rosters may remain empty. Prefix Pay cannot consume the entire budget.
All nodes with no declared mutable fields retain revision zero, including
all-constant or execution-only Pay/Split nodes. Both decoded getter schemas and
on-chain current-state checks enforce this invariant.

Getters retain the documented `*_v2` shapes. Each changed node emits topics
`(config_v2, node_id)` with its full resulting NodeStateV2 and revision. Unchanged
nodes emit no configuration event. A downstream reader verifies emitter and
snapshot membership, actual executable hashes, immutable initial/current
relationships and one consistent whole-graph observation. Getter/schema labels
or history alone do not establish trust. Keep original construction evidence and
append-only event provenance; do not replace initial values with current ones.

Complete revisions are checked before payment funding, so a successful change on
the prefix, condition or inactive branch invalidates an old payment even if it
would select an unchanged branch. API/SDK preparation, exact-original recovery,
consistent RPC observation and history ingestion remain #1225/#1226 work.

## Compatibility and capability boundary

Execution-only #1223 binaries report mutation ABI0/false. The guarded source adds
the exact mutation ABI2/true tuple only after its enforcing implementation exists.
Pure decoders distinguish these tuples. Neither tuple is added to a production
trust manifest by this change. Same-family binary support does not establish an
instance's generation: retain immutable constructor/snapshot evidence plus
versioned getters and verified actual hashes. Unknown or mixed generations fail
closed. Old v1/legacy execution, mutation and setters remain unavailable on v2
instances; arbitrary upgrades and obligation-clearing shortcuts are absent.

The execution-only local build metadata remains historical evidence for #1223.
Guarded binaries need their own source/build identity and native/actual-WASM
verification. Local CPU/memory observations do not establish RPC fees, maximum
layout suitability, live artifact acceptance or genuine wallet/device behavior.
No registry writes, uploaded/activated artifacts, SDK publication or funded
transactions are part of this change.

## Local compiled evidence

[Guarded build identity](conditional-mutation-v2-artifacts.json) records the four
local Wasms, production source inputs and measured guest resources. These are
local evidence hashes, not registry trust entries. Production compiler/codec
packets with actual byte hashes cover grouped updates for both comparisons and
accepted fixed Split accumulation. The amount_lt packet deliberately reverses
row patches while checking unchanged configured order.

The mutation guest matrix exercised three successful groups and seven expected
refusals, including accounted debt, raw-zero debt, repair funding, subsequent
accumulation and stale mutation revisions. Ten payment attempts included eight
successes and two stale refusals. Mutation retained every token balance; accepted
settlement and later payments checked exact credits and preserved unsolicited
surplus. Source-account admin and payer authorization and default actual execution
budgets remained enforced. These are local host authorization checks, not genuine
wallet signatures or network submissions.

Successful mutations consumed 30,859,971–50,104,357 instructions and
20,068,256–26,689,855 metered memory bytes in the tested four/five-node graphs.
Fixture setup is unlimited before resetting the actual budget. As with #1223,
SDK26's diagnostic invocation observer is disabled because its separate shadow
budget can exhaust on complete contexts; actual budget and authorization checks
remain enabled. Structural maxima are not performance promises.

Native regressions additionally cover mutable percentage Pay/Split updates with
conservation and last-row rounding, invalid sums, revision overflow, immutable
revisions, authorization omissions, direct-child bypasses and grouped rollback.
The ordinary workspace command ignores guest tests; guest results count only
when their explicit build/generation/execution commands actually pass.

The 54 execution guest regressions also passed against these guarded binaries.
Their instruction range was 25,617,469–34,284,746 and metered memory range was
23,606,978–24,784,231 bytes under the same local-budget qualifications. These
measurements belong to the new guarded binaries; the execution-only #1223 record
retains its original identities and observations.
