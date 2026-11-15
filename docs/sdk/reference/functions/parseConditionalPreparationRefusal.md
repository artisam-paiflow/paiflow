[**@paiflow/sdk — method and type reference**](../README.md)

---

[@paiflow/sdk — method and type reference](../README.md) / parseConditionalPreparationRefusal

# Function: parseConditionalPreparationRefusal()

> **parseConditionalPreparationRefusal**(`value`: `unknown`): \{ `admin`: `string`; `deploymentId`: `string`; `idempotencyKeyHash`: `string`; `network`: `"testnet"` \| `"mainnet"`; `outcome`: `"NOT_ADMITTED"`; `reasonCode`: `"VALIDATION"` \| `"CONFLICT"` \| `"UPSTREAM_RPC"` \| `"INSUFFICIENT_FUNDS"`; `refusalId`: `string`; `refusedAt`: `string`; `requestDigest`: `string`; `version`: `2`; \}

A refusal is evidence of non-admission for one original keyed request only.
Generic failures, expiry and missing history never imply this proof.

## Parameters

### value

`unknown`

## Returns

\{ `admin`: `string`; `deploymentId`: `string`; `idempotencyKeyHash`: `string`; `network`: `"testnet"` \| `"mainnet"`; `outcome`: `"NOT_ADMITTED"`; `reasonCode`: `"VALIDATION"` \| `"CONFLICT"` \| `"UPSTREAM_RPC"` \| `"INSUFFICIENT_FUNDS"`; `refusalId`: `string`; `refusedAt`: `string`; `requestDigest`: `string`; `version`: `2`; \}

### admin

> **admin**: `string`

### deploymentId

> **deploymentId**: `string`

### idempotencyKeyHash

> **idempotencyKeyHash**: `string`

### network

> **network**: `"testnet"` \| `"mainnet"`

### outcome

> **outcome**: `"NOT_ADMITTED"`

### reasonCode

> **reasonCode**: `"VALIDATION"` \| `"CONFLICT"` \| `"UPSTREAM_RPC"` \| `"INSUFFICIENT_FUNDS"`

### refusalId

> **refusalId**: `string`

### refusedAt

> **refusedAt**: `string`

### requestDigest

> **requestDigest**: `string`

### version

> **version**: `2`
