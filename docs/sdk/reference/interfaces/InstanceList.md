[**@paiflow/sdk — method and type reference**](../README.md)

---

[@paiflow/sdk — method and type reference](../README.md) / InstanceList

# Interface: InstanceList

## Properties

### items

> **items**: \{ `contractAddress`: `string` \| `null`; `deploymentId`: `string`; `network`: `"testnet"` \| `"mainnet"`; `pipeline`: \{ `contractAddress`: `string`; `nodeId`: `string`; `templateKind`: `string`; \}[]; `prepared`: \{ `expiresAt`: `string`; `feeStroops`: `string`; `networkPassphrase`: `"Test SDF Network ; September 2015"` \| `"Public Global Stellar Network ; September 2015"`; `txHash`: `string`; `xdr`: `string`; \} \| `null`; `serviceState`: `"ACTIVE"` \| `"RETIRING"` \| `"RETIRED"`; `sourceAccount`: `string`; `status`: `"FAILED"` \| `"DRAFT"` \| `"BUILDING"` \| `"PENDING_SIGNATURE"` \| `"SUBMITTED"` \| `"CONFIRMED"`; `templateId`: `string`; `templateVersionId`: `string`; `txHash`: `string` \| `null`; \}[]

#### contractAddress

> **contractAddress**: `string` \| `null`

#### deploymentId

> **deploymentId**: `string`

#### network

> **network**: `"testnet"` \| `"mainnet"`

#### pipeline

> **pipeline**: \{ `contractAddress`: `string`; `nodeId`: `string`; `templateKind`: `string`; \}[]

#### prepared

> **prepared**: \{ `expiresAt`: `string`; `feeStroops`: `string`; `networkPassphrase`: `"Test SDF Network ; September 2015"` \| `"Public Global Stellar Network ; September 2015"`; `txHash`: `string`; `xdr`: `string`; \} \| `null`

#### serviceState

> **serviceState**: `"ACTIVE"` \| `"RETIRING"` \| `"RETIRED"`

#### sourceAccount

> **sourceAccount**: `string`

#### status

> **status**: `"FAILED"` \| `"DRAFT"` \| `"BUILDING"` \| `"PENDING_SIGNATURE"` \| `"SUBMITTED"` \| `"CONFIRMED"`

#### templateId

> **templateId**: `string`

#### templateVersionId

> **templateVersionId**: `string`

#### txHash

> **txHash**: `string` \| `null`

---

### nextCursor

> **nextCursor**: `string` \| `null`
