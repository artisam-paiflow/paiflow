[**@paiflow/sdk — method and type reference**](../README.md)

---

[@paiflow/sdk — method and type reference](../README.md) / DeploymentBalances

# Type Alias: DeploymentBalances

> **DeploymentBalances** = \{ `deploymentId`: `string`; `freshness`: \{ `attemptedAt`: `string`; `cached`: `boolean`; `status`: `"stale"` \| `"fresh"` \| `"partial"`; `totalsComplete`: `boolean`; \}; `network`: `"testnet"` \| `"mainnet"`; `nodes`: \{ `balanceStroops`: `string` \| `null`; `contractAddress`: `string`; `error?`: `string`; `nodeId`: `string`; `readAt`: `string` \| `null`; `stale`: `boolean`; `templateKind`: `string`; `tokenContract`: `string` \| `null`; \}[]; `totals`: \{ `balanceStroops`: `string`; `tokenContract`: `string`; \}[]; \}

Node balances, asset totals and explicit freshness/completeness information.

## Properties

### deploymentId

> **deploymentId**: `string`

---

### freshness

> **freshness**: \{ `attemptedAt`: `string`; `cached`: `boolean`; `status`: `"stale"` \| `"fresh"` \| `"partial"`; `totalsComplete`: `boolean`; \}

#### attemptedAt

> **attemptedAt**: `string`

#### cached

> **cached**: `boolean`

#### status

> **status**: `"stale"` \| `"fresh"` \| `"partial"`

#### totalsComplete

> **totalsComplete**: `boolean`

---

### network

> **network**: `"testnet"` \| `"mainnet"`

---

### nodes

> **nodes**: \{ `balanceStroops`: `string` \| `null`; `contractAddress`: `string`; `error?`: `string`; `nodeId`: `string`; `readAt`: `string` \| `null`; `stale`: `boolean`; `templateKind`: `string`; `tokenContract`: `string` \| `null`; \}[]

#### balanceStroops

> **balanceStroops**: `string` \| `null`

#### contractAddress

> **contractAddress**: `string`

#### error?

> `optional` **error?**: `string`

#### nodeId

> **nodeId**: `string`

#### readAt

> **readAt**: `string` \| `null`

#### stale

> **stale**: `boolean`

#### templateKind

> **templateKind**: `string`

#### tokenContract

> **tokenContract**: `string` \| `null`

---

### totals

> **totals**: \{ `balanceStroops`: `string`; `tokenContract`: `string`; \}[]

#### balanceStroops

> **balanceStroops**: `string`

#### tokenContract

> **tokenContract**: `string`
