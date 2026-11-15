[**@paiflow/sdk — method and type reference**](../README.md)

---

[@paiflow/sdk — method and type reference](../README.md) / ConditionalDefinition

# Interface: ConditionalDefinition

## Properties

### assetContract

> **assetContract**: `string`

---

### condition

> **condition**: \{ `kind`: `"amount_gt"` \| `"amount_lt"`; `nodeId`: `string`; `thresholdMode`: `"constant"` \| `"mutable"`; `thresholdStroops`: `string`; \}

#### kind

> **kind**: `"amount_gt"` \| `"amount_lt"`

#### nodeId

> **nodeId**: `string`

#### thresholdMode

> **thresholdMode**: `"constant"` \| `"mutable"`

#### thresholdStroops

> **thresholdStroops**: `string`

---

### falseBranch

> **falseBranch**: [`ConditionalTerminal`](../type-aliases/ConditionalTerminal.md)

---

### owner

> **owner**: `string`

---

### prefix

> **prefix**: [`ConditionalPayNode`](ConditionalPayNode.md)[]

---

### root

> **root**: \{ `minAmountStroops`: `string`; `nodeId`: `string`; \}

#### minAmountStroops

> **minAmountStroops**: `string`

#### nodeId

> **nodeId**: `string`

---

### trueBranch

> **trueBranch**: [`ConditionalTerminal`](../type-aliases/ConditionalTerminal.md)

---

### version

> **version**: `2`
