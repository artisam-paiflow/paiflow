[**@paiflow/sdk — method and type reference**](../README.md)

---

[@paiflow/sdk — method and type reference](../README.md) / ConditionalPayNode

# Interface: ConditionalPayNode

## Properties

### configuration

> **configuration**: \{ `additionalRecipients?`: `undefined`; `configuredRows?`: `undefined`; `kind`: `"pay"`; `payoutValue`: \{ `amountStroops`: `string`; `kind`: `"fixed"`; \} \| \{ `bps`: `number`; `kind`: `"percentage"`; \} \| \{ `kind`: `"full"`; \}; `recipient?`: `string`; \}

#### additionalRecipients?

> `optional` **additionalRecipients?**: `undefined`

#### configuredRows?

> `optional` **configuredRows?**: `undefined`

#### kind

> **kind**: `"pay"`

#### payoutValue

> **payoutValue**: \{ `amountStroops`: `string`; `kind`: `"fixed"`; \} \| \{ `bps`: `number`; `kind`: `"percentage"`; \} \| \{ `kind`: `"full"`; \}

#### recipient?

> `optional` **recipient?**: `string`

---

### kind

> **kind**: `"pay"`

---

### nodeId

> **nodeId**: `string`

---

### policy

> **policy**: \{ `additionalRecipients?`: `undefined`; `allocationMode?`: `undefined`; `kind`: `"pay"`; `nodeId`: `string`; `payoutValue`: `"constant"` \| `"mutable"`; `recipient`: `"constant"` \| `"execution"` \| `"mutable"`; `rows?`: `undefined`; \}

#### additionalRecipients?

> `optional` **additionalRecipients?**: `undefined`

#### allocationMode?

> `optional` **allocationMode?**: `undefined`

#### kind

> **kind**: `"pay"`

#### nodeId

> **nodeId**: `string`

#### payoutValue

> **payoutValue**: `"constant"` \| `"mutable"`

#### recipient

> **recipient**: `"constant"` \| `"execution"` \| `"mutable"`

#### rows?

> `optional` **rows?**: `undefined`
