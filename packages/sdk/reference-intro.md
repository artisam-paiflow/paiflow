# SDK method and type reference

Generated from the public `@paiflow/sdk` entry point. Start with the
[SDK README](https://github.com/artisam-paiflow/paiflow/blob/develop/packages/sdk/README.md) for installation, configuration,
credential permissions, typed errors and workflow/recovery rules. The
[coverage matrix](https://github.com/artisam-paiflow/paiflow/blob/develop/docs/sdk/contract.md#endpoint-matrix) maps methods to HTTP routes;
[OpenAPI and Postman](https://github.com/artisam-paiflow/paiflow/blob/develop/docs/api/README.md) remain the direct HTTP references.

Use `Paiflow` to create a Node client, then `client.deployment(id)` to access
`PaiflowDeployment` namespaces. Namespace properties below expand into individual
methods with parameters and return types. Public methods omit the configured bearer
credential; webhook methods require their own explicit secret. A credential grants
API access, never wallet consent or application order ownership.

HTTP methods return `ApiResponse<T>`. Persist preparation metadata and the original
signed envelope before submission. No method retries automatically. Unknown finality,
local expiry and missing events never permit a replacement payment. See the README
for each workflow's explicit reconciliation protocol and bounded testnet evidence.

This reference describes the source tree; package versions and hosted capabilities
advance separately. Regenerate with `pnpm sdk:docs`; CI runs the read-only
`pnpm sdk:docs:check`. Do not edit generated files directly.
