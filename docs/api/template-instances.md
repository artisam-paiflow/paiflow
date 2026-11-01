# Developer-signed private-template instances

See [instance readiness](../instance-readiness.md) for local cross-layer evidence,
deployment-cost and admission guidance, confirmed Multisig compatibility blockers
and the remaining release acceptance. Source support is not a phase-release claim.

API specification revision 1.5 adds instance lifecycle operations to private owned
flow templates (#1165). Each instance is an ordinary independent Deployment with
its own separately deployed Soroban contracts. The developer is transaction source,
fee payer and initial contract admin. Paiflow prepares and submits transactions;
it never receives a developer private key. Network selection follows
[CLAUDE.md §7.5](../../CLAUDE.md#75-networks).

## Credentials and routes

Owner sessions use `/api/flow-templates/{id}`. Machine calls use
`/api/v1/flow-templates/{id}` and require an explicit owned-template grant on an
existing `pfd_` developer credential. Existing deployment selections and `pfk_`
credentials grant no template access. Template grants do not grant ordinary
instance deployment API access; select a confirmed active deployment separately
for those APIs. Template publication, version creation, retirement and credential
management remain owner-session operations. Sandbox callers are refused.

| Method | Suffix under the template path            | Permission           |
| ------ | ----------------------------------------- | -------------------- |
| POST   | `/versions/{versionId}/instances/prepare` | Read and operate     |
| GET    | `/instances`                              | Read only or operate |
| GET    | `/instances/{instanceId}`                 | Read only or operate |
| POST   | `/instances/{instanceId}/submit`          | Read and operate     |
| POST   | `/instances/{instanceId}/reconcile`       | Read and operate     |
| GET    | `/instances/{instanceId}/events`          | Read only or operate |

All responses use `{data: ...}`. Instance IDs are Deployment IDs. List accepts
`limit` (default 20, maximum 100) and an opaque cursor. Events use the existing
paginated event shape and retained indexed history. No SSE endpoint is added.
See [OpenAPI](openapi.json) and the [permission matrix](developer-token-permissions.md).

## Prepare, sign, submit, reconcile

Prepare accepts only `{sourceAccount, idempotencyKey, bindings}`. Bindings use
`{version:1, templateVersionId, values:[{inputId,value:{type,value}}]}` with declared
creation-input types. Stroops are canonical decimal strings. Missing required
inputs never fall back to the published exemplar. Wallet source is a valid Stellar
account; an API credential is not proof of its on-chain authority.

Use one persistent idempotency key for the intended instance. Its scope is the
owner across all templates and versions. Reuse with a different parsed original
bindings request,
source, template or version returns conflict. Keep the original values array and
default omissions: reordering values or explicitly supplying an omitted default
changes request identity even when the resolved graph would be equivalent. UUIDs
are canonicalized; request identity is calculated before resolving defaults.
Concurrent identical prepares admit
one deployment. Admission locks and pins the immutable version/content hash,
resolved graph/bindings/policies, network, factory and node artifacts, developer,
compiled parameters and exact unsigned transaction/hash. Retries return that
preparation; registry updates and template/version retirement never repin it.
New admissions require an active deployable version and current approved artifacts.
The transaction expires after at most 180 seconds, bounded by version expiry.

Preparation returns instance state with `prepared` containing `xdr`,
`networkPassphrase`, `txHash`, `expiresAt` and `feeStroops`. Sign exactly this envelope
with the developer source account and submit `{signedXdr}`. Bearer authorization
does not replace source/admin authorization. Changed source, network, factory,
constructor arguments, operations or transaction body are refused. Paiflow stores
unsigned intent and hashes, never the signed envelope. The caller should retain
the signed envelope privately when managing external signing/broadcast recovery.

`prepared` is null once the instance no longer awaits signature. A successful
receipt includes status, serviceState, network, source, transaction hash, contract
address and the independently deployed pipeline. An uncertain send remains
SUBMITTED. RPC ingestion ERROR or TRY_AGAIN_LATER does not prove non-inclusion
of the hash: another correctly decorated envelope may already have been broadcast.
Instances retain their original hash, unresolved admission and financial evidence;
submit retries return the retained state without another send. Reconcile polls
the original hash; it never prepares, signs, resends or
replaces the transaction. Direct external broadcast can be recovered only when
RPC proves the actual exact source-signed envelope and complete factory result.
Missing/partial evidence and unknown finality remain unresolved. Expiry alone
cannot clear reservations: authoritative recovery coverage is required.

The same owner may have at most 1,000 non-retired non-failed template instances and ten
unresolved instance preparations, with one unresolved deployment per owner/source.
Admission does not reserve another owner's wallet globally. Existing deployment
work admission, retirement, event polling, automation and TTL workers serve
confirmed instances; see [deployment retirement](../deployment-retirement.md).

## Retirement and access changes

Template retirement stops new admissions. An admitted preparation retains its
original pins and may finish after template/version retirement. Deployment
retirement separately stops new first sends; obligated reconciliation can finish
while RETIRING. Revocation, expiry, role changes and grant removal are rechecked
for new work; they do not erase admitted work, finality, audit or financial history.
Owners retain history through the existing deployment lifecycle.

## SDK and authenticated UI

The source SDK exposes `client.flowTemplate(templateId).instances` with `prepare`,
`list`, `get`, `sign`, `submit`, `reconcile` and `events`. Release/publication follows
[the release policy](../releasing.md); source support does not imply the published
0.2.0 package or a deployed backend already includes this feature.

`sign(preparationResponse, signer, options)` calls the developer's signer once and
returns the submission body/options without sending it. No lifecycle method
silently retries uncertain submission or creates a replacement preparation.
Consumers should retain the instance ID, original preparation and hash, display
pending/unknown state and offer explicit reconciliation. The authenticated
`/flow-templates` workspace (#1166) shows the environment network chip before signing and distinguishes initial bound
terms from runtime mutation capabilities. Immutable template definitions and
creation bindings do not retrofit legacy mode-less contracts with v1 lifetime
policy guarantees; absent runtime policies retain existing contract behavior.
Creation bindings grant no new mutation authority. See
[reusable-flow policies](../reusable-flows.md).

The owner workspace also uses `GET /api/flow-templates/{id}/instances/{instanceId}/review`
to read the immutable initial admission graph, resolved bindings, artifact pins,
validated prepared terms from `paramsSnapshot` and the exact original unsigned
factory envelope (including actual agreement windows and final router/relayer
constructor bindings),
content hash and current ordinary instance receipt. This owner-session-only read
refuses sandbox/foreign identities and never changes public SDK state responses.
It remains readable after template/version retirement. Read the
[workspace recovery behavior](../flow-templates.md#authenticated-template-workspace)
before integrating signing/reload flows. Developer API token management now offers
explicit private-template selections as well as deployment selections; template
grants do not grant publication or ordinary deployment operation access.
