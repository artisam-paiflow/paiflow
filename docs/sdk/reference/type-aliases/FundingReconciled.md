[**@paiflow/sdk — method and type reference**](../README.md)

---

[@paiflow/sdk — method and type reference](../README.md) / FundingReconciled

# Type Alias: FundingReconciled

> **FundingReconciled** = \{ `action`: `"schedule.fund"` \| `"webhook.fund"`; `expiresAt`: `string`; `intent`: `string`; `network`: `"testnet"` \| `"mainnet"`; `state`: `"SUCCESS"` \| `"FAILED"` \| `"PREPARED"` \| `"SUBMITTING"` \| `"EXPIRED"`; `txHash`: `string`; \}

Original funding reservation state; only terminal ledger evidence releases it.

## Properties

### action

> **action**: `"schedule.fund"` \| `"webhook.fund"`

---

### expiresAt

> **expiresAt**: `string`

---

### intent

> **intent**: `string`

---

### network

> **network**: `"testnet"` \| `"mainnet"`

---

### state

> **state**: `"SUCCESS"` \| `"FAILED"` \| `"PREPARED"` \| `"SUBMITTING"` \| `"EXPIRED"`

---

### txHash

> **txHash**: `string`
