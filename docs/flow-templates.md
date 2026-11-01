# Private flow template versions

Flow templates are private reusable definitions, separate from `ContractTemplate`
(the WASM registry). Their owner publishes immutable versions; each future instance
is a separate developer-owned deployment. Publication and binding endpoints implement
#1164; [developer-signed instance lifecycle and SDK](api/template-instances.md)
implement #1165. Hosted instance UI remains #1166. Publication endpoints do not
deploy or submit transactions.

## Owner API

All endpoints require an owner session, reject sandbox users, and return
`{ data: ... }` with `Cache-Control: no-store`. Bearer deployment/developer tokens
cannot manage templates. The normal session middleware remains in force. Writes
share a per-owner limit of 30/minute. Foreign or missing resources return the same
404; new resources cannot choose another owner or a network.

| Method and path under `/api/flow-templates` | Request / result                                                                                                                                                 |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /`                                    | `{ name, description?, definition }`; returns the saved draft                                                                                                    |
| `GET /`                                     | `?limit=20&cursor=<id>`; private metadata list and `nextCursor`                                                                                                  |
| `GET /:id`                                  | Draft, metadata and its `draftRevision`                                                                                                                          |
| `PATCH /:id`                                | `{ expectedRevision, name?, description?, definition? }`; replaces the whole definition when supplied; increments draft revision                                 |
| `POST /:id/versions`                        | `{ expectedRevision, expiresAt? }`; publishes the current draft as the next immutable version                                                                    |
| `GET /:id/versions`                         | Cursor-paginated version metadata                                                                                                                                |
| `GET /:id/versions/:versionId`              | Immutable definition, network, artifact pins, content hash and lifecycle metadata                                                                                |
| `POST /:id/versions/:versionId/bindings`    | `CreationBindings`; returns a validated bound graph, resolved bindings (including explicit defaults), pins and version evidence; creates no deployment/admission |
| `POST /:id/retire`                          | `{ confirm: "retire" }`; irreversibly stops new publication/preparation                                                                                          |
| `POST /:id/versions/:versionId/retire`      | `{ confirm: "retire" }`; irreversibly stops new preparations using that version                                                                                  |

Draft revision mismatches return 409 so parallel edits cannot silently overwrite
another tab's work. Publishing takes a row lock and allocates a monotonically
increasing version number. A new publication neither replaces nor retires earlier
versions. Draft edits never rewrite a published version. There is no delete,
unretire, sharing or public gallery endpoint. Retired definitions remain readable
by their owner. All sensitive writes and their audit rows commit together.

## Definitions and bindings

A definition has `{ schemaVersion: 1, graph, inputs: [...] }`. Drafts may retain
ordinary incomplete graph configuration. Publication requires a **deployable
configured exemplar**, including values at required input targets. The exemplar
lets the normal graph validator/compiler check every standard flow type. Its
values are **not fallback defaults**: every declared input is required at binding
unless the author explicitly supplies its typed `defaultValue`.

```json
{
  "inputId": "customer",
  "label": "Customer wallet",
  "target": { "nodeId": "payment", "field": "recipient" },
  "type": "wallet"
}
```

Bindings use the shared `CreationBindings` wire schema, independently of payment
execution arguments or stored mutations:

```json
{
  "version": 1,
  "templateVersionId": "d0b34837-d091-40ad-9112-2219d57188cc",
  "values": [{ "inputId": "customer", "value": { "type": "wallet", "value": "G..." } }]
}
```

Unknown, duplicate, missing, wrong-type and wrong-version bindings fail before
preparation. Only the finite declared leaves below can change. Runtime-only
execution recipients/allocations cannot receive a creation binding. The binder
copies the graph, applies declared replacements before time-sensitive checks,
and reruns graph/schema/compiler validation, including aggregate
percentage totals, supported paths, addresses and schedule rules. Resolved money
values remain canonical decimal strings with the shared i128 bound.

| Configured node                     | Eligible leaves and scalar type                                                                                                                                                                                                               |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Receive                             | `minAmountStroops` (`stroops`) only for policy-aware Receive roots with reviewed execution artifacts                                                                                                                                          |
| Pay                                 | `recipient` (`wallet`); `amountStroops` (`stroops`) only for configured fixed partial Pay; `percentageBps` (`bps`) only for configured percentage partial Pay                                                                                 |
| Split                               | `splitRecipient` (`wallet`), `splitBps` (`bps`, percentage rows), `splitAmountStroops` (`stroops`, fixed rows), each with an explicit zero-based `target.index`; `amountPerIntervalStroops` (`stroops`) only for scheduled percentage rosters |
| Schedule                            | `intervalAmount`, `occurrences` (`integer`); `intervalUnit` (`text`); `startsAt`, `endsAt` (`timestamp`); `pauseAllowed`, `retrieveAllowed` (`boolean`)                                                                                       |
| Subscription                        | `subscriber` (`wallet`), `amountPerPeriodStroops` (`stroops`); `intervalAmount`, `occurrences` (`integer`); `intervalUnit` (`text`); `endsAt` (`timestamp`)                                                                                   |
| Classic webhook                     | `relayer` (`wallet`), the explicitly configured webhook operator; never the deployment owner/admin or Paiflow's server signing key                                                                                                            |
| Oracle trigger                      | `threshold` (`text` containing a canonical nonnegative i128 decimal; this is an oracle value, not money)                                                                                                                                      |
| Amount condition                    | `amountStroops` (`stroops`)                                                                                                                                                                                                                   |
| Oracle condition                    | `oracle` (`wallet`), `oracleKey` (`text`, underlying key length limit applies), `threshold` (oracle decimal `text`)                                                                                                                           |
| Time condition                      | `at` (`timestamp`)                                                                                                                                                                                                                            |
| Multisig condition                  | `signer` (`wallet`) with an explicit immutable `target.index`; `threshold` (`integer`)                                                                                                                                                        |
| Swap                                | `slippageBps` (`bps`), `deadlineSecs` (`integer`)                                                                                                                                                                                             |
| Yield                               | `vault` (`wallet`, matching the current standard address rule)                                                                                                                                                                                |
| HTTP webhook, Hold, Return to owner | No configurable creation leaf; these standard blocks remain supported in valid templates                                                                                                                                                      |

The typed enum permits no JSON paths, mode switches, asset replacement, node/edge
replacement, roster insertion/deletion/reordering, owner/admin substitution or
field-policy changes. Index identity is safe because each published roster and its
ordering are immutable; legacy rows need no runtime row-ID retrofit. Supplying a
creation value leaves that instance's published field mode unchanged, including
`constant`. Full-amount Pay has no creation-configurable payout value. Pay percentage inputs
require an actual Payer constructor; absorbed conditional/streamer percentage
leaves are refused. A subscription's pull amount cannot be declared when it is
derived from an immediately downstream fixed Split. Termination remains one fixed
method: `occurrences` is refused when an end date is configured, and creation
bindings cannot switch a configured occurrence-based agreement to end-date mode.
UI-only timezone metadata is not a creation input. Receive minimum bindings require
a policy-aware Receive root and the reviewed execution artifact manifest. Its
`execute_v1` path checks the configured minimum before moving funds. All legacy
Receive minimum declarations are refused, including Receive → Split: the legacy
pipeline takes `deposit` → `execute_step`, which does not enforce the Splitter's
stored minimum. A changed constructor value alone is not evidence of enforcement.
Existing configured graphs retain ordinary compilation; declaration validation
does not change legacy contract semantics.

Each declaration may supply `defaultValue` and `constraints`:
`min`/`max` are tagged values of the same ordered scalar type (`stroops`, `bps`,
`integer`, `timestamp`); `minLength`/`maxLength` apply only to text. Defaults must
satisfy their constraints and, together, the ordinary graph schema/validation.
Constraints do not replace target-specific checks (e.g. permitted interval units,
positive intervals, signer threshold, slippage bounds). No number/string coercion
is performed for creation values. The underlying graph is validated again after
binding; individually valid inputs that form an invalid agreement are rejected.

## Artifact evidence and cutover

Publication is environment-pinned; see [the canonical network model](../CLAUDE.md#75-networks).
It requires synchronized DB registry rows for all compiled nodes and a factory row
with its WASM hash. Env-only or missing entries are insufficient publication
evidence. The immutable snapshot records the factory address/hash, each pipeline
node's kind/hash/ABI digest/policy version, and compiler ABI version 1. Policy-aware
graphs additionally require the reviewed execution artifact manifest. No artifact
is uploaded or activated by these APIs.

Binding admission compares the exact pins with the environment's current DB
registry/factory/ABI evidence. A changed, missing or incompatible entry fails
closed with 409; publish a new version after reviewing the cutover. An old version
is never silently rebound to a newer artifact. DB registry presence alone is not
proof that a WASM/factory is available on chain: instance preparation checks
executable availability during normal deployment simulation and preserves failure/recovery
evidence. The content hash covers definition, network, artifacts and publication
expiry. Database triggers prohibit changing or deleting published contents and
reversing retirement. Foreign-key restrictions retain owners and template evidence.

## Instantiation handoff (#1165)

`lockAndResolveTemplateForPreparation(tx, ownerId, templateId, versionId, bindings)`
is the authoritative admission helper. It locks the owned template `FOR SHARE`,
then checks active template/version, optional version expiry, pinned environment,
exact bindings and artifact evidence. All publication/edit/retirement writers use
`FOR UPDATE` on that same template. The lock order is **template, then instance or
deployment admission**; do not acquire these in reverse order.

The caller must persist its instance admission and exact version ID/content hash,
bound graph, resolved values/defaults, policy table, network, artifact pins and
signer/admin/fee payer in that **same transaction**, and release before RPC or
wallet interaction. The HTTP binding endpoint and `resolveTemplateForPreparation`
are read-only previews; repeat admission instead of trusting a previous preview.
The developer remains signer, fee payer and instance owner/admin. Explicit template
credential grants, exact signing/submission and durable deployment workers are
implemented in [the instance lifecycle API and SDK](api/template-instances.md)
(#1165); deployment-bound `pfk_` credentials gain no template access here.

A version's optional `expiresAt` stops new admission. The instantiation transaction's
validity must be bounded by the earlier of normal 180-second transaction validity
and that version cutoff. An edit/new publication does not alter a pending intent.
Explicit retirement stops new admissions; already-admitted intent evidence remains
immutable and may complete according to its original signed transaction validity.
Neither retirement nor an expired clock proves finality: unknown/crashed submission
must retain its reservation and use authoritative recovery, never timeout deletion
or blind resubmission. Existing instances never migrate automatically.
