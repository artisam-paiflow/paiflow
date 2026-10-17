[**@paiflow/sdk — method and type reference**](../README.md)

---

[@paiflow/sdk — method and type reference](../README.md) / ListEventsResponse

# Type Alias: ListEventsResponse

> **ListEventsResponse** = \{ `hasMore`: `boolean`; `items`: \{ `data`: `unknown`; `eventId`: `string`; `id`: `string`; `kind`: `string`; `ledger`: `number`; `occurredAt`: `string`; `topic`: `string` \| `null`; `txHash`: `string`; \}[]; `nextCursor`: `string` \| `null`; \}

One indexed event page with continuation and hasMore state.

## Properties

### hasMore

> **hasMore**: `boolean`

---

### items

> **items**: \{ `data`: `unknown`; `eventId`: `string`; `id`: `string`; `kind`: `string`; `ledger`: `number`; `occurredAt`: `string`; `topic`: `string` \| `null`; `txHash`: `string`; \}[]

#### data

> **data**: `unknown`

#### eventId

> **eventId**: `string`

#### id

> **id**: `string`

#### kind

> **kind**: `string`

#### ledger

> **ledger**: `number`

#### occurredAt

> **occurredAt**: `string`

#### topic

> **topic**: `string` \| `null`

#### txHash

> **txHash**: `string`

---

### nextCursor

> **nextCursor**: `string` \| `null`
