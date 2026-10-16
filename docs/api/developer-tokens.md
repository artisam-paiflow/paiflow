# One credential for selected existing deployments

Developer-token support is implemented on the `dev-token` integration branch (#1028),
including **Unreleased** changes in the local `@paiflow/sdk` 0.1.0 source.
This work does not publish those changes; registry 0.1.0 support must not be assumed. OpenAPI revision
1.1.0 describes this compatible addition to API v1. These files do not establish
hosted availability, npm publication or upgrades to external starter repositories.
Check the deployed service's specification and panel before relying on support.
The [release policy](../releasing.md) governs publication separately.

## Choose and create a credential

| Credential                           | Scope and setup                                                                                                                                     |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pfd_` + 64 lowercase hex characters | One developer credential across explicitly selected existing deployments. Owner signs in at `/account/developer`.                                   |
| `pfk_` + 64 lowercase hex characters | Existing single-deployment token from that deployment's **API access** panel; existing behavior remains supported.                                  |
| `pkdev_`                             | Legacy Dev/payroll credential, unrelated to this feature and rejected by `/api/v1`. Retirement work #472/#985 is not completed by developer tokens. |

Use a full owner account; sandbox sessions cannot manage tokens. Deploy your flows
through the existing app/wallet workflow first. Choose a label, **Read only** or
**Read and operate**, and 1–100 existing **CONFIRMED**, **ACTIVE** deployments you own.
No future deployment inherits access. Tokens cannot create flows or deployments.

Read only permits capabilities, balances, events, transaction status, quotes and
supported funding, schedule and subscription discovery. Read and operate adds the
supported prepare, submit, reconcile and early-release operations. The exhaustive
[permission matrix](developer-token-permissions.md) is authoritative per operation.
Deployment capabilities still determine whether a workflow exists. Read and operate
can authorize supported relayer early release: protect it as a financial credential.
Required wallet consent and independent webhook callback secrets remain separate.

You can hold at most 10 unrevoked, unexpired developer credentials per owner. API
expiry is omitted for none, or an integer 1–365 days; the panel offers Never, 30,
90 or 365 days. Label, permission and expiry are immutable: create a replacement
credential to change them, switch your server secret, then revoke the old one.

Copy the one-time reveal into your server secret manager. It is excluded from
analytics capture (`ph-no-capture`), cleared on Done, pagehide or tab hiding and
never recoverable from metadata. A create response arriving after hiding retains
metadata only; revoke that uncopied credential and create a replacement. Never
put the credential in browser bundles, public environment variables, URLs, logs,
screenshots or repositories. No customer private key belongs in your application.

## Owner-session management, separate from bearer calls

These routes require the owner's signed-in browser session, **not** a bearer token.
The SDK intentionally does not wrap them. Successful responses are `no-store`.

| Method and path                          | Contract                                                                                             |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `GET /api/developer-tokens`              | Paginated safe metadata, including revoked/expired history.                                          |
| `POST /api/developer-tokens`             | `{label?, permission, deploymentIds, expiresInDays?}`; returns metadata plus one-time `token` (201). |
| `GET /api/developer-tokens/deployments`  | Eligible owned deployment choices `{id, flowName, network}`.                                         |
| `GET /api/developer-tokens/{tokenId}`    | Inspect safe metadata.                                                                               |
| `PATCH /api/developer-tokens/{tokenId}`  | Only `{deploymentIds}`; atomically replace the whole selection, including `[]` to suspend access.    |
| `DELETE /api/developer-tokens/{tokenId}` | Idempotently revoke; preserve metadata and financial history.                                        |

List routes use UUID `cursor` and integer `limit` (default 20, maximum 100),
returning `{data:{items,nextCursor}}`. Metadata contains only `id`, `tokenPrefix`,
`label`, `permission`, `createdAt`, `lastUsedAt`, `expiresAt`, `revokedAt` and
`deploymentIds`; no token hash or recoverable credential. PATCH cannot edit revoked
or expired credentials. Every retained/new grant must still be eligible; explicitly
remove retiring/retired deployments when replacing a selection. Management writes
share one allowance of 30 requests/minute per owner. Invalid bodies (including attempts to PATCH label/permission/expiry) return 422,
absent/foreign token resources 404, unavailable/foreign deployment selections 422, the active-token cap or editing revoked/expired tokens 409, forbidden sessions
403, missing sessions 401 and rate limits 429. See [OpenAPI](openapi.json).

## Discover, then use explicit deployment IDs

Configure a trusted HTTPS service origin and one credential on your server:

```sh
export PAIFLOW_BASE_URL=https://your-paiflow-service.example
# Set PAIFLOW_API_TOKEN privately through your secret manager.
export PAIFLOW_DEPLOYMENT_A=11111111-1111-4111-8111-111111111111
export PAIFLOW_DEPLOYMENT_B=22222222-2222-4222-8222-222222222222
curl "$PAIFLOW_BASE_URL/api/v1/deployments?limit=20" \
  -H "Authorization: Bearer $PAIFLOW_API_TOKEN"
```

Bearer `pfd_` and `pfk_` both support `GET /api/v1/deployments`, returning
`{data:{items:[{id,flowName,network}],nextCursor}}`. Only current eligible authorized
scope appears; `pfk_` returns at most its own deployment. The UUID cursor is an ID
bound, so its original row need not remain available. Default limit 20, maximum 100. No graph, wallet or private configuration is returned. Discovery never grants
new access; keep your application's intended IDs explicit even after discovering.

The [Node example](../../packages/sdk/examples/developer-server.ts) uses one client
for two explicit IDs, bounded/cancellable discovery, read-only capabilities and
balances, then optional operation with a separate wallet callback. See the
[SDK quickstart](../sdk/quickstart.md) for local tarball installation and offline
fixture execution. `client.deployment(id)` methods remain unchanged; discovery is
`client.deployments.list()` / `.pages()`. Exported types are `ListDeploymentsQuery`,
`DeploymentPagesOptions`, `DeploymentSummary`, `ListDeploymentsResponse`.

## Refusals, rate limits and recovery

API v1 has no session or `pkdev_` fallback. Missing/malformed/unknown/expired/revoked
credentials and missing grants produce generic 401 `UNAUTHENTICATED`; an authorized
Read only credential attempting an operate route gets 403 `FORBIDDEN`. Domain
validation/capability refusals remain 422; malformed deployment UUIDs are 404.
Rate limits are stable **per token and endpoint across all selected deployments**,
not multiplied by the selection count. Known live credentials spend that allowance
even on permission/grant refusals, which can therefore become 429. Live missing-grant
refusals are not negatively cached; subsequent requests recheck selection/liveness.

Revocation, expiry or grant removal stops subsequent access; it does not cancel an
already submitted transaction, undo a relayer action, erase pending/unknown work or
remove finality/settlement evidence. Preserve original preparation, deployment ID,
network, intent, hash and access-restricted signed envelope before submission.
Keep preparation/history request IDs for correlation. Attribution distinguishes the
developer credential, its owner/caller and actual wallet signer; a token is not the
signer. A hash from another deployment/network cannot be reused for recovery.

After timeout, abort, lost response, PENDING or UNKNOWN, use the original hash with
`transactions.get` through a still-authorized credential for that same deployment,
or the owner's supported dashboard recovery path. If access was revoked, have the
owner explicitly grant a replacement credential rather than deleting local evidence.
Use the workflow's reconcile/status protocol when applicable; do not blindly submit
or prepare a second financial action. Time passing or a missing event is not failure.
Verify a final business receipt (deployment, hash, payer, token, amount and required
recipient payouts) before fulfilling an order; HTTP 200 or chain SUCCESS alone is
insufficient. The SDK does not automatically retry writes. Public and webhook
requests never inherit the configured bearer; webhooks require their separate secret.
