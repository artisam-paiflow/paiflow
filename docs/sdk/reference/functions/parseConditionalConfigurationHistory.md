[**@paiflow/sdk — method and type reference**](../README.md)

---

[@paiflow/sdk — method and type reference](../README.md) / parseConditionalConfigurationHistory

# Function: parseConditionalConfigurationHistory()

> **parseConditionalConfigurationHistory**(`value`: `unknown`): \{ `coverage`: `"observed-revisions-only"`; `deploymentId`: `string`; `historyComplete`: `false`; `items`: \{ `configuration`: [`ConditionalNodeState`](../interfaces/ConditionalNodeState.md); `eventId`: `string` \| `null`; `eventLedger`: `number` \| `null`; `id`: `string`; `observedLedger`: `number`; `txHash`: `string` \| `null`; \}[]; `network`: `"testnet"` \| `"mainnet"`; `nextCursor`: `string` \| `null`; `revisionCoverage`: \{ `highestObservedRevision`: `string`; `missingRevisionCount`: `string`; `nodeId`: `string`; `observedRevisionCount`: `string`; \}[]; `version`: `2`; \}

## Parameters

### value

`unknown`

## Returns

\{ `coverage`: `"observed-revisions-only"`; `deploymentId`: `string`; `historyComplete`: `false`; `items`: \{ `configuration`: [`ConditionalNodeState`](../interfaces/ConditionalNodeState.md); `eventId`: `string` \| `null`; `eventLedger`: `number` \| `null`; `id`: `string`; `observedLedger`: `number`; `txHash`: `string` \| `null`; \}[]; `network`: `"testnet"` \| `"mainnet"`; `nextCursor`: `string` \| `null`; `revisionCoverage`: \{ `highestObservedRevision`: `string`; `missingRevisionCount`: `string`; `nodeId`: `string`; `observedRevisionCount`: `string`; \}[]; `version`: `2`; \}

### coverage

> **coverage**: `"observed-revisions-only"`

### deploymentId

> **deploymentId**: `string`

### historyComplete

> **historyComplete**: `false`

### items

> **items**: \{ `configuration`: [`ConditionalNodeState`](../interfaces/ConditionalNodeState.md); `eventId`: `string` \| `null`; `eventLedger`: `number` \| `null`; `id`: `string`; `observedLedger`: `number`; `txHash`: `string` \| `null`; \}[]

### network

> **network**: `"testnet"` \| `"mainnet"`

### nextCursor

> **nextCursor**: `string` \| `null`

### revisionCoverage

> **revisionCoverage**: \{ `highestObservedRevision`: `string`; `missingRevisionCount`: `string`; `nodeId`: `string`; `observedRevisionCount`: `string`; \}[]

### version

> **version**: `2`
