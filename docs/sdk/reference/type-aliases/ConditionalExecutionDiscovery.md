[**@paiflow/sdk — method and type reference**](../README.md)

---

[@paiflow/sdk — method and type reference](../README.md) / ConditionalExecutionDiscovery

# Type Alias: ConditionalExecutionDiscovery

> **ConditionalExecutionDiscovery** = \{ `deploymentId`: `string`; `network`: `"testnet"` \| `"mainnet"`; `policyVersion`: `0`; `reason`: `string`; `supported`: `false`; `version`: `2`; \} \| \{ `confirmedLedger`: `number`; `definition`: [`ConditionalDefinition`](../interfaces/ConditionalDefinition.md); `deploymentId`: `string`; `network`: `"testnet"` \| `"mainnet"`; `nodes`: [`ConditionalNodeBinding`](../interfaces/ConditionalNodeBinding.md)[]; `policyVersion`: `2`; `statuses`: \{ `obligationsStroops`: `string`; `state`: [`ConditionalNodeState`](../interfaces/ConditionalNodeState.md); \}[]; `supported`: `true`; `version`: `2`; \}
