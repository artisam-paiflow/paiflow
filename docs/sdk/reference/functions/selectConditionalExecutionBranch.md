[**@paiflow/sdk — method and type reference**](../README.md)

---

[@paiflow/sdk — method and type reference](../README.md) / selectConditionalExecutionBranch

# Function: selectConditionalExecutionBranch()

> **selectConditionalExecutionBranch**(`raw`: [`ConditionalDefinition`](../interfaces/ConditionalDefinition.md), `funded`: `string`): \{ `amountAtConditionStroops`: `string`; `selectedBranch`: `"false"` \| `"true"`; \}

Preview one verified snapshot only. Preparation rechecks current terms and
computes the authoritative route; never send this branch as a request input.

## Parameters

### raw

[`ConditionalDefinition`](../interfaces/ConditionalDefinition.md)

### funded

`string`

## Returns

\{ `amountAtConditionStroops`: `string`; `selectedBranch`: `"false"` \| `"true"`; \}

### amountAtConditionStroops

> **amountAtConditionStroops**: `string`

### selectedBranch

> **selectedBranch**: `"false"` \| `"true"`
