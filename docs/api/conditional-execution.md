# Conditional execution protocol v2

[#1225](https://github.com/webnxt-2030/pinkraft/issues/1225) adds explicit
conditional payment discovery, preparation and original recovery within API v1.
OpenAPI revision `1.8.0` describes this source change. SDK conditional methods are
unreleased source additions; no SDK publication, artifact upload/activation or
hosted deployment is performed here. Verify actual target support first. Ordinary
conditional deployment/authoring integration remains #1227 work.

## Explicit selection and compatibility

Use one `version=2` query parameter on each conditional operation:

| Operation           | Request                                                    |
| ------------------- | ---------------------------------------------------------- |
| Read verified terms | `GET /api/v1/deployments/:id/execution?version=2`          |
| Prepare             | `POST /api/v1/deployments/:id/execute?version=2`           |
| Submit original     | `POST /api/v1/deployments/:id/execute/submit?version=2`    |
| Reconcile original  | `POST /api/v1/deployments/:id/execute/reconcile?version=2` |

Missing or explicit `version=1` retains existing legacy/v1 request and receipt
shapes. Unknown/duplicate selectors, mixed argument versions and saved-intent
generation mismatches are refused. Default execution and legacy public/owner
entry points refuse explicit conditional deployments before falling back to a
legacy invocation. Generic capabilities remain hints and point conditional
callers to verified v2 discovery; they do not grant support from snapshot labels.
Credentials, permission checks, deployment admission and rate allowances are
shared across versions. There is one payment sender and one unresolved-payer
reservation across both generations.

`GET /api/v1/deployments/:id/transactions/:txHash` remains generation-neutral.
It reports the original attributed transaction; it returns no execution receipt
and needs no version selector. Existing v1 artifact manifests, pending originals,
template formats and immutable evidence remain unchanged.

## Verified whole-graph terms

Supported discovery is a separate strict v2 shape: `version:2`, `supported:true`,
deployment/network identity, `policyVersion:2`, confirmed ledger, current
`definition`, complete `nodes` and `statuses`. Nodes bind root, prefix, condition,
True and False terminal in that order with exact hashes and revisions. Statuses
carry full current state and accounted obligations. The definition includes both
terminal policies, prefix deductions, comparison/threshold and immutable owner
destination. Unsupported responses explicitly say `supported:false`; errors and
missing observations never become zero balances or permissive default terms.

The reader requires strict original construction evidence in `paramsSnapshot`:

```text
{ version:2, generation:"conditional-v2",
  definition:originalConditionalDefinition,
  manifest:completeOriginalRevisionZeroManifest,
  nodes:originalConditionalCompiledNodes }
```

It recompiles and compares the complete definition, manifest and semantic nodes,
including Return lowered to the Pay family. Ordered `pipelineSnapshot` entries
retain durable addresses, family/implementation, exact hash/capability pins and
required canonical lowercase 32-byte hex salts. CAP-46 addresses are checked with
the immutable owner and server-selected passphrase; deployment source must equal
owner/admin. No old snapshot is rewritten or inferred to be conditional.

The #1227 writer must validate canvas-to-envelope correspondence and teach
confirmation/recovery the explicit object format before enabling real conditional
deployment. #1225 reads do not expose authored graph/contact metadata or substitute
that graph for deployment evidence. Private templates retain their existing
generation/pin formats and do not acquire conditional declarations.

For every node, actual executable hashes, immutable generation/policies, current
values and revisions must agree with exact reviewed guarded artifacts. The
four getter calls per node are `capabilities_v2`, `graph_manifest_v2`,
`initial_config_v2` and `mutation_status_v2`; the last returns authoritative
current state/revision plus accounting. Reviewed source proves the other getter
aliases add no independent state dependency. Future hashes require renewed review.
Complete instance XDR and last-modified witnesses bracket all reads, including the
inactive branch. A changed-and-reverted entry still invalidates the observation.
Four concurrent getter requests, bounded whole-read retries and the shared
interactive deadline apply. Post-admission review refresh is request-local and
uses protected original observations; callers cannot turn edited data into proof.

## Amount, inputs and preparation

Prepare with a funded payer wallet, positive canonical i128-bounded amount and
explicit v2 arguments. Include `inputs:[]` when nothing is declared:

```json
{
  "from": "G...",
  "amount": "111",
  "arguments": { "version": 2, "inputs": [] }
}
```

The real request uses a valid wallet address and every declared input. Preparation
computes the strict comparison from the amount left after prefix Pay deductions.
Equality takes False for both comparisons. Supply declared inputs only for the
prefix and selected branch; inactive, unknown, constant and mutable overrides are
refused. Threshold is never a per-payment input. Return pays the immutable
deployment owner/admin; its destination is independent of the payer.

Preserve fixed Pay underfunding refusal and terminal remainder refund, percentage
conservation/last-row rounding, execution-aware fixed Split exact funding and
constant-only fixed Split accumulation. Accounted holdings do not become another
invocation's budget. Simulation validates actual selected transfers and trustline
requirements; inactive recipients are not executed. Accumulation does not promise
an immediate payout from every deposit.

Use a stable `Idempotency-Key` for recovery. An identical keyed retry returns the
same original before new live reads; a different request/generation conflicts.
Even an unkeyed conflicting preparation retains and reports the prior intent/hash
through the existing reservation guard. Keep the validated request/key with the
entire prepared response before signing. The durable original includes the full
graph/pins/revisions, route/inputs, payer/network/amount, nonce/finite expiry and
exact unsigned envelope/hash.

## Sign, submit and recover the original

Conditional prepared responses require `intent`, `txHash`, `walletAddress`,
`xdr`, `expiresAt`, `network`, `networkPassphrase` and `execution.version:2`.
They use a separate strict parser; old clients never receive v2 through default
operations. Wallet and network/passphrase/hash evidence must agree. SDK canonical
validation also compares the receipt with the request, computed route, selected
inputs and complete graph evidence. Parsing structured evidence does not replace
server verification of exact XDR, auth/resources, source signature or actual
on-chain provenance.

Sign the unchanged envelope with the payer wallet and submit using the same
version selector, intent and signed XDR. The server derives the method/arity from
strict persisted generation and reuses the existing single sender. Before first
send, it checks current complete pins/revisions and route; a revision change on
any node, including the inactive branch, invalidates an old payment before
funding. Contracts independently close later read/send races.

After an admitted send, recovery uses original evidence even when configuration,
time or a new current read has changed. Duplicate submits, response loss, signing
interruptions, RPC deadlines, missing history, service retirement and lost access
never authorize a replacement. Preserve original request/key/intent/hash and
reservation through UNKNOWN, held/refused or uncertain finality. Expiry recovery
requires authoritative closing-ledger/history proof. A late error after durable
preparation is not proof that nothing was admitted.

The SDK exposes `deployment.execute.conditional.state/prepare/submit/reconcile`;
its methods set the selector and use separate types/parsers. Existing generic
`signPrepared` retains sign-only behavior and the original preparation; it neither
submits nor retries. Source examples and Postman v2 requests are separate from
retained v1 requests. No private keys, automatic replacement sender or private
contact metadata is introduced.

## Acceptance boundaries

Source tests cover both comparisons and equality, prefix deductions, every
terminal family, inactive inputs/revisions, immutable owner return, consistent
observations, canonical receipt substitutions, real authentication/permission
guards, one-send races, original recovery and legacy compatibility. Storage-backed
tests require verified task-owned scratch resources and retain immutable refusal
evidence; they do not clear uncertain financial state to make cleanup pass.

Current/history persistence and guarded mutation APIs are #1226; owner/builder UI
is #1227; wallet-only hosted integration is #1228. These consumers reuse the
reader and original lifecycle. #1229 must join their local evidence and a
separately authorized artifact/network/hosted/wallet rollout plan. Source success
does not close predecessor gates or establish live acceptance.
