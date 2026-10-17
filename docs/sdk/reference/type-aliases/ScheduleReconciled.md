[**@paiflow/sdk — method and type reference**](../README.md)

---

[@paiflow/sdk — method and type reference](../README.md) / ScheduleReconciled

# Type Alias: ScheduleReconciled\<A _extends_ [`ScheduleAction`](ScheduleAction.md) = [`ScheduleAction`](ScheduleAction.md)\>

> **ScheduleReconciled**\<`A` _extends_ [`ScheduleAction`](ScheduleAction.md) = [`ScheduleAction`](ScheduleAction.md)\> = \{ `action`: `A`; `intent`: `string`; `network`: `"testnet"` \| `"mainnet"`; `replacementAllowed`: `boolean`; `state`: `"SUCCESS"` \| `"FAILED"` \| `"PREPARED"` \| `"SUBMITTING"` \| `"EXPIRED"`; `txHash`: `string`; \}

Original wallet-control evidence. Preserve the intent and server replacement permission.

## Type Parameters

### A

`A` _extends_ [`ScheduleAction`](ScheduleAction.md) = [`ScheduleAction`](ScheduleAction.md)

## Properties

### action

> **action**: `A`

---

### intent

> **intent**: `string`

---

### network

> **network**: `"testnet"` \| `"mainnet"`

---

### replacementAllowed

> **replacementAllowed**: `boolean`

---

### state

> **state**: `"SUCCESS"` \| `"FAILED"` \| `"PREPARED"` \| `"SUBMITTING"` \| `"EXPIRED"`

---

### txHash

> **txHash**: `string`
