[**@paiflow/sdk — method and type reference**](../README.md)

---

[@paiflow/sdk — method and type reference](../README.md) / ConditionalSplitNode

# Interface: ConditionalSplitNode

## Properties

### configuration

> **configuration**: \{ `additionalRecipients`: [`ExecutionAdditionalRecipient`](ExecutionAdditionalRecipient.md)[]; `configuredRows`: \{ `allocation?`: [`ExecutionAllocation`](../type-aliases/ExecutionAllocation.md); `recipient?`: `string`; `rowId`: `string`; \}[]; `kind`: `"split"`; \}

#### additionalRecipients

> **additionalRecipients**: [`ExecutionAdditionalRecipient`](ExecutionAdditionalRecipient.md)[]

#### configuredRows

> **configuredRows**: \{ `allocation?`: [`ExecutionAllocation`](../type-aliases/ExecutionAllocation.md); `recipient?`: `string`; `rowId`: `string`; \}[]

#### kind

> **kind**: `"split"`

---

### kind

> **kind**: `"split"`

---

### nodeId

> **nodeId**: `string`

---

### policy

> **policy**: \{ `additionalRecipients`: `"constant"` \| `"execution"` \| `"mutable"`; `allocationMode`: `"fixed"` \| `"percentage"`; `kind`: `"split"`; `nodeId`: `string`; `payoutValue?`: `undefined`; `recipient?`: `undefined`; `rows`: \{ `allocation`: `"constant"` \| `"execution"` \| `"mutable"`; `recipient`: `"constant"` \| `"execution"` \| `"mutable"`; `rowId`: `string`; \}[]; \}

#### additionalRecipients

> **additionalRecipients**: `"constant"` \| `"execution"` \| `"mutable"`

#### allocationMode

> **allocationMode**: `"fixed"` \| `"percentage"`

#### kind

> **kind**: `"split"`

#### nodeId

> **nodeId**: `string`

#### payoutValue?

> `optional` **payoutValue?**: `undefined`

#### recipient?

> `optional` **recipient?**: `undefined`

#### rows

> **rows**: \{ `allocation`: `"constant"` \| `"execution"` \| `"mutable"`; `recipient`: `"constant"` \| `"execution"` \| `"mutable"`; `rowId`: `string`; \}[]
