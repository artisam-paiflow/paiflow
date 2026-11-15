[**@paiflow/sdk — method and type reference**](../README.md)

---

[@paiflow/sdk — method and type reference](../README.md) / ConditionalNodeConfiguration

# Type Alias: ConditionalNodeConfiguration

> **ConditionalNodeConfiguration** = [`ConditionalPayNode`](../interfaces/ConditionalPayNode.md) \| [`ConditionalSplitNode`](../interfaces/ConditionalSplitNode.md) \| \{ `kind`: `"receive"`; `minAmountStroops`: `string`; \} \| \{ `comparison`: `"amount_gt"` \| `"amount_lt"`; `kind`: `"condition"`; `thresholdMode`: `"constant"` \| `"mutable"`; `thresholdStroops`: `string`; \} \| \{ `kind`: `"return_to_owner"`; `recipient`: `string`; \}
