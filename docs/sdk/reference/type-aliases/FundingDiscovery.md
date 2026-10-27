[**@paiflow/sdk — method and type reference**](../README.md)

---

[@paiflow/sdk — method and type reference](../README.md) / FundingDiscovery

# Type Alias: FundingDiscovery

> **FundingDiscovery** = \{ `deploymentId`: `string`; `network`: `"testnet"` \| `"mainnet"`; `nodes`: \{ `action`: `"schedule.fund"` \| `"webhook.fund"`; `authorization`: `"funding_wallet"`; `contractAddress`: `string`; `effect`: `string`; `nodeId`: `string`; `templateKind`: `"STREAMER"` \| `"WEBHOOK"`; `tokenContractAddress`: `string`; \}[]; \}

Eligible deployed funding nodes and assets; choose the node explicitly.

## Properties

### deploymentId

> **deploymentId**: `string`

---

### network

> **network**: `"testnet"` \| `"mainnet"`

---

### nodes

> **nodes**: \{ `action`: `"schedule.fund"` \| `"webhook.fund"`; `authorization`: `"funding_wallet"`; `contractAddress`: `string`; `effect`: `string`; `nodeId`: `string`; `templateKind`: `"STREAMER"` \| `"WEBHOOK"`; `tokenContractAddress`: `string`; \}[]

#### action

> **action**: `"schedule.fund"` \| `"webhook.fund"`

#### authorization

> **authorization**: `"funding_wallet"`

#### contractAddress

> **contractAddress**: `string`

#### effect

> **effect**: `string`

#### nodeId

> **nodeId**: `string`

#### templateKind

> **templateKind**: `"STREAMER"` \| `"WEBHOOK"`

#### tokenContractAddress

> **tokenContractAddress**: `string`
