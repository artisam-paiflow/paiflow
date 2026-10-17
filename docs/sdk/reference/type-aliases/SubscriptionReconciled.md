[**@paiflow/sdk — method and type reference**](../README.md)

---

[@paiflow/sdk — method and type reference](../README.md) / SubscriptionReconciled

# Type Alias: SubscriptionReconciled\<A _extends_ [`SubscriptionAction`](SubscriptionAction.md) = [`SubscriptionAction`](SubscriptionAction.md)\>

> **SubscriptionReconciled**\<`A` _extends_ [`SubscriptionAction`](SubscriptionAction.md) = [`SubscriptionAction`](SubscriptionAction.md)\> = \{ `action`: `A`; `intent`: `string`; `ledger`: `number` \| `null`; `replacementAllowed`: `boolean`; `state`: `"SUCCESS"` \| `"FAILED"` \| `"PREPARED"` \| `"SUBMITTING"` \| `"EXPIRED"`; `txHash`: `string`; \}

Original wallet-control evidence. Preserve the intent and server replacement permission.

## Type Parameters

### A

`A` _extends_ [`SubscriptionAction`](SubscriptionAction.md) = [`SubscriptionAction`](SubscriptionAction.md)

## Properties

### action

> **action**: `A`

---

### intent

> **intent**: `string`

---

### ledger

> **ledger**: `number` \| `null`

---

### replacementAllowed

> **replacementAllowed**: `boolean`

---

### state

> **state**: `"SUCCESS"` \| `"FAILED"` \| `"PREPARED"` \| `"SUBMITTING"` \| `"EXPIRED"`

---

### txHash

> **txHash**: `string`
