# Reusable flows: version 1 domain and ABI contract

Foundation for [#1158](https://github.com/webnxt-2030/pinkraft/issues/1158), under
[#848](https://github.com/webnxt-2030/pinkraft/issues/848). This is the shared handoff
for execution parameters, private templates/isolated instances, then stored mutations.
The schemas in `lib/flows/field-policies.ts` are the wire authority. No contract
artifacts or public endpoints are activated by the foundation. #1159 implements
the contract/compiler execution lane described in [execution-v1.md](execution-v1.md).
Its local builds are not artifact activation. Existing deployed contracts are unchanged.

## Availability and compatibility

An absent `graph.fieldPolicies` means the existing configured behavior: no execution
inputs or new stored mutation authority. Do not retrofit legacy deployments or
claim their old setter/routing semantics satisfy v1 lifetime guarantees. Explicit
`fieldPolicies: { version: 1, nodes: [...] }` is preserved on save. Supported
immediate-path tables can be validated and compiled; deployment requires the exact
reviewed policy-capable hashes for every participating contract, including all-constant
and empty tables. Legacy artifacts cannot enforce that table. #1159 implements this
check against the pinned manifest; an env flag or graph declaration is insufficient.
Unsupported paths continue to fail closed. #1168 implements guarded stored mutation
for new reviewed-artifact immediate paths; see [mutation v1](mutation-v1.md). API/history
and owner editing remain subsequent work. No existing contract is upgraded automatically.

Unknown version, keys, modes, policy node kinds and input keys are errors; strict
new objects never silently strip declarations into constant behavior. Existing
legacy graph normalization remains intact. Duplicate graph/policy/input node IDs
are refused. Missing mode on a valid v1 field normalizes to `constant`; absent node
policy means all its fields are constant. No setter changes a mode or permanently
locks/unlocks a field. No separate Dev contract family or retired API is restored.

## Field and group matrix

| Field/group                                                    | Constant          | Execution      | Mutable stored          |
| -------------------------------------------------------------- | ----------------- | -------------- | ----------------------- |
| Pay recipient                                                  | default           | yes            | yes                     |
| Pay configured fixed amount or percentage                      | default           | no             | yes, same payout mode   |
| Pay full-amount payout rule                                    | lifetime          | no             | no stored value to edit |
| Split configured row recipient                                 | default           | yes            | yes                     |
| Split configured row allocation                                | default           | yes            | yes                     |
| Split additional recipient roster + each allocation            | absent by default | yes, one group | yes, one group          |
| Split allocation mode (percentage/fixed)                       | lifetime          | no             | no                      |
| Asset, routing/parent/next steps, admin, payout kind           | lifetime          | no             | no                      |
| Trigger, schedule, subscription, conditions, swap/yield config | lifetime          | no             | no                      |

Modes are selected before deployment and enforced by the standard contract family.
Creation bindings may vary explicitly declared template leaves before construction,
including fields of other currently deployable standard blocks; this does not give
those fields execution/mutation authority. Template/version management remains private
to its owning developer. The developer signs, pays for, owns and administers each
isolated deployment. Network selection follows [CLAUDE.md §7.5](../CLAUDE.md#75-networks).

Pay keeps its configured payout mode/value during each execution. Percentage is
integer bps in domain/ABI interfaces; the existing builder's percentage display
is converted once by the compiler. Full amount is a separate immutable rule,
never a zero-valued fixed payment or a mutable allocation mode.

Split rows acquire `config.recipients[].rowId` in policy-aware definitions. IDs are
stable, case-sensitive identifiers; they do not depend on address or array index.
When a Split policy is present, its `rows` must identify **every** configured row
in the same order, once each, with the same allocation mode. Once deployed, configured rows cannot
be removed/reordered/replaced, even when some of their fields are mutable. An
additional roster is always appended after configured rows. Replacing its list
never touches configured rows; additional IDs cannot collide with configured IDs.

Before deployment, ordinary draft authoring may remove nodes/rows or change the
Split allocation mode. Builder edits synchronize graph and policy metadata atomically:
remove only the deleted target's policy, preserve surviving row IDs/modes, and give
new configured rows fresh identity with constant fields. Mode switching preserves
row identity and notification metadata; cached values follow row IDs. An empty
policy-aware Split retains its selected allocation mode and requires adding a row
before changing that mode. These draft edits grant no mutation authority to a
deployed contract.

There is no additional roster when its mode is constant. Inputs for undeclared
rows, fields, constant fields or mutable fields during execution are refused.

An execution/mutable additional roster controls its membership, recipients and
allocations together. A Split's nonconstant allocation fields and additional roster
must share one authority (execution **or** mutable), so two callers cannot independently
invalidate the total. Recipient-only authority can differ because it cannot change
the allocation total; revision binding still applies.

Example: platform row `platform` fixes its recipient and 1,000 bps allocation;
`additionalRecipients: "execution"` takes the remaining 9,000 bps across a variable
list of workers. Another example fixes platform's 100 stroops; a fixed execution
worker roster must total exactly the entering amount minus 100. Neither request
may replace the platform row, change assets/allocation mode, or change routing.

## Units, validation and payout order

Structural ceilings: 40 policy/input nodes, 20 **combined** configured and additional recipients
per Split; these are not a promise that every combination fits execution or deployment
resources. Exact RPC simulation must pass before an unsigned transaction is returned.
The [readiness evidence](execution-readiness.md#artifacts-resources-and-structural-bounds)
includes a 40-node/20-recipient local memory refusal and distinguishes that bound from
network-qualified layouts. IDs match `[A-Za-z0-9_-]{1,64}`. Positive monetary values are canonical
decimal strings (`1` through signed i128 max), never JS numbers, signs, exponents,
leading zeros, decimals or zero. Revisions are canonical decimal strings from `0`
through u64 max; increment overflow fails. Bps are positive integers through 10,000.
Expiry is a positive u32 ledger, at most 720 ledgers ahead of the current ledger
(enforced during preparation and on chain). Nonces and passphrase hashes are 32-byte lowercase
hex; on chain these are `BytesN<32>`. Wallet inputs are complete G-addresses,
never secrets, pending labels or contract addresses; contract bindings are C-addresses.
Creation binding values have separate tagged scalar types and declaration-specific
constraints. No developer-defined allowlist or custom payment limits are added.

Every declared execution field/node is required, even when the saved draft has a
value. `executionArgumentsSchema(policies)` checks that exact field set and its
fixed allocation mode. It deliberately does **not** prove amounts, revision truth,
asset consistency or ownership. After merging constants/current stored fields with
execution fields, the compiler/API **and contract** must check all of the following
atomically before any funds move:

- Final recipients are nonempty and unique by address, including constants.
- Combined row count is 1–20. Additional IDs are unique and cannot shadow configured IDs.
- Percentage allocations sum to exactly 10,000. Compute `floor(amount*bps/10000)`
  in canonical configured-then-additional order with checked math. Assign the integer
  remainder to the **last row in that same order**, matching the existing splitter.
  Constant allocation means fixed bps, including this documented rounding rule;
  it does not promise a fixed absolute payment independent of the entering amount.
- If any execution allocation/roster is declared in a fixed Split, the final fixed
  amounts sum **exactly** to the funds entering that Split: reject both deficit and
  surplus, no retained remainder or partial batch. Constant-only fixed Split behavior
  stays unchanged; introducing parameterization must not rewrite legacy semantics.
- For recipient-only execution in fixed mode, use the same exact-total rule: any
  execution-aware fixed Split consumes precisely its entering amount. #1159 must
  enforce this even if only the address varies.

Schema failures use existing 422 `VALIDATION`/field paths. Deployment gating uses
`FIELD_POLICY_UNSUPPORTED` at `fieldPolicies`. Future runtime ABI errors distinguish
invalid policy/input, amount, unauthorized caller, stale revision, unsupported
capability, obligation conflict, expired/replayed execution and arithmetic overflow;
#1159 owns stable contract numeric discriminants. Validation never logs raw inputs.

## Execution intent and initial forwarding subset

`ExecutionArguments` contains only node-addressed Pay/Split input values. The
prepared `ExecutionIntent` adds the deployment UUID, environment passphrase hash,
root and asset contract, payer, positive funded amount, nonce/expiry, plus each
participating node's contract address and expected revision. #1160 resolves bindings
from the durable pipeline snapshot and verified capabilities; it freezes the exact
transaction/hash, signer, intent and artifacts for retry/unknown-finality recovery.
Inputs cannot substitute arbitrary contract addresses or choose the network.
Each input needs a node/contract/revision binding; the preparation service additionally
requires exactly the full participating path, not only nodes with variable fields.

Initial supported topology for execution: `on_receive` deposit root → zero or more
Pay nodes → terminal Pay or Split, with exactly one money edge at each hop and no
outgoing money edge from terminal Split. All participating contracts must implement
v1, even when their own fields are constant. A chain of Pay nodes forwards only its
incoming amount less its configured payout. Refuse conditions/routers (including
amount branches), schedules, subscriptions, relayer/webhook/oracle triggers,
swap/yield, holds, joins/fan-out and any prefunded/delayed path for v1 execution.
This restriction does not reduce standard constant-flow/template support. Later
compatible immediate paths require explicit capability/validation work.

The root authenticates the payer for the **entire** intent and pulls exactly the
funded amount in the same invocation. Network passphrase is bound by the signed
transaction; root/address, nonce/expiry, amounts, nodes, revisions and input values
are contract/auth arguments. Consume the nonce atomically, retaining replay state
through its ledger expiry and checking that explicit expiry independently of storage TTL; retries use the same tx hash and never invent new funds.
Children require their stored parent's auth for the full forwarded context. Never
use a shared `lastRecipient`, pending arguments slot or total token balance to
select the execution's inputs/funds. Forward only that call's conserved amount;
unsolicited balances and another invocation's funds are outside its budget. Even a
constant-only child must check the payer/context/revision binding before transfer.
A direct call cannot bypass checks through old `execute_step`, deposit, charge,
release or setter entry points: unsupported legacy paths on a v1 deployment must
reject rather than execute without the context. Direct external calls get the same
on-chain enforcement as hosted/API calls. Hosted payment visibility requires owner
opt-in; visibility is not contract authorization.

## Rust ABI / compiler handoff (#1159)

Use versioned contract structs/enums, with ordered `Vec`s instead of unordered maps:

- `FieldMode = Constant | Execution | Mutable`. Constructor policy payload begins
  with `version: u32 = 1`, includes stable `node_id: String`, immutable Pay payout
  rule or Split allocation mode, ordered configured row policies and additional
  roster mode. Pass _all_ resolved policy/configuration values and stored parent/
  next-step addresses atomically through factory constructors. No placeholder
  defaults become execution inputs. Constructor ABI/hashes change.
- `Allocation = Percentage(u32) | Fixed(i128)`; `RowInput` contains row ID and
  optional recipient/allocation exactly as declared. `NodeInput = Pay(...) | Split(...)`
  identifies node ID; input vectors reject duplicates/unknowns, even on chain.
- Root `execute_v1(payer, asset, amount, nonce, expires_at_ledger, bindings, inputs)`;
  `bindings` contains ordered `{node_id, contract_address, expected_revision: u64}`
  for the complete path, root first. Root is bound by the invoked address. Children use
  `execute_step_v1(context, asset, amount)` with the same original payer, root,
  nonce/expiry, full bindings/inputs and the per-hop amount. Parent auth binds all
  these values. Child finds its own row by immutable ID/address and rejects ambiguity.
- `capabilities()` returns policy/ABI version plus execution, mutation,
  immutable-policy and revision-binding enforcement; `field_policy()` returns the
  immutable constructor policy; `config_revision()` returns u64; `current_config()`
  returns revision plus resolved stored values and fixed policy. Revision starts 0.
  Read getters together at one confirmed ledger before constructing reviewed intent.
- Stale expected revision fails on chain **before** pulling or paying funds. Verify
  every participating revision, including upstream affected configuration, against
  live storage. No retained-old-config execution or server-only freshness check.

`ConfirmedNodeConfigurationSchema` defines the backend read envelope and resolved
Pay/Split values. It checks policy/node identity, configured row identity/order,
roster/asset-independent allocation mode and percentage totals; it is not evidence
that a caller-supplied revision or constant value came from chain. The trusted reader
compares immutable policy and constant values to original deployment evidence,
records the confirmed ledger and refuses inconsistent results. Execution placeholders
are never treated as saved default recipients: v1 constructors use a tagged absence
for execution fields; the read adapter returns only resolved stored fields for those
rows, with input requirements supplied by `field_policy()`. #1159 must add the ABI
representation for that absence without materializing fallback values.

#1159 owns real constructors/compiler ScVal encoding/error discriminants and resource
proof; this foundation defines no fictitious deployed ABI. #1160 owns API/SDK exact
intent, capability discovery and replay recovery. #1161 owns builder/English review
and must reuse these schemas; #1162 reuses the same execution/signature flow.
#1163 records cross-layer acceptance, resource evidence and artifact rollout plans.

## Mutation, templates and persistence handoff

The #1164 persistence/binding implementation and concrete field/lifecycle/API matrix
are documented in [private template versions](flow-templates.md). It does not enable
instantiation or broaden existing partner credential grants.

`CreationBindings` names declared typed inputs of one immutable template version.
#1164 owns concrete supported-field declarations, value-type matching, private
version persistence and exact binding validation; #1165 pins the version/bindings/
policies/network/artifacts and exact developer signer/admin/fee payer. Never accept
arbitrary JSON paths, bind a runtime mode through a creation input, modify undeclared
leaves or let publishing a version change pending/existing instances. All standard
deployable flow types remain eligible, including scheduled/conditional agreements.
Separate deployments supply their independent contracts, balances and lifecycle.

`MutationArguments` describes admin-signed changes with expected per-node revisions,
never execution arguments. It is a structural interface only at this phase: #1168/
#1169 must check every changed field against mutable policy, merge atomically, reject
constant/execution overrides, require the on-chain admin's auth and expected revision,
and increment each changed revision once. Partial mutable updates need not resupply
unmodified mutable fields. Group updates cannot delete/reorder configured rows,
change payout/allocation mode/asset/routing, or rewrite constant amounts/shares.
No empty, duplicate, unknown or irrelevant mutation may succeed. No delegated editors.

Mutation admission must reject affected held/earmarked funds and unsettled obligations,
including upstream holdings, concurrent payment admission and failed/unknown settlement.
A zero raw token balance is not proof of safety. Define obligation accounting plus
unsolicited-fund disposition before enabling a path; refuse unsupported unsafe paths.
Inspect and close every bypass: Pay/Split `set_next_steps`, subscription `set_relayer`,
legacy execution methods, refunds/cancel, routing/asset changes, upgrade hooks. The
new family must expose no arbitrary WASM upgrade that can defeat a constant. Existing
legacy artifacts retain their historical semantics, never silently gain these guarantees.

Preserve `pipelineSnapshot`, preparation and original deployment graph evidence.
Store confirmed current configuration/revisions and append-only mutation history
separately, with contract/ledger/tx/event evidence; reconcile direct on-chain updates
and monotonic event cursors before API/UI/worker reads. #1169 owns this persistence
and migration, #1170 the owner editor/history. Deployment work admission, retirement,
unknown finality and retention rules apply to all three workstreams. API credentials
never replace required payer/admin/developer on-chain authorization.

## Release gate

Phases ship execution, instances, then mutation. Future mode schemas do not advertise
available runtime features. Capability discovery uses pinned WASM hash plus verified
getters and enforced semantics; legacy/missing/unknown/failed discovery grants no new
capability. Registry entries, snapshots and every prepare operation bind the exact
artifacts. Actual artifact activation, production deployment, mainnet writes or funded
wallet acceptance need separate authorization. Follow [releasing.md](releasing.md);
no app/API/SDK release bump or endpoint publication occurs in this foundation.
