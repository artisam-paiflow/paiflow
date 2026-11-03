[**@paiflow/sdk — method and type reference**](../README.md)

---

[@paiflow/sdk — method and type reference](../README.md) / MutationChange

# Type Alias: MutationChange

> **MutationChange** = \{ `expectedRevision`: `string`; `kind`: `"pay"`; `nodeId`: `string`; `payoutValue?`: [`ExecutionAllocation`](ExecutionAllocation.md); `recipient?`: `string`; \} \| \{ `additionalRecipients?`: [`ExecutionAdditionalRecipient`](../interfaces/ExecutionAdditionalRecipient.md)[]; `expectedRevision`: `string`; `kind`: `"split"`; `nodeId`: `string`; `rows`: [`ExecutionRowInput`](../interfaces/ExecutionRowInput.md)[]; \}
