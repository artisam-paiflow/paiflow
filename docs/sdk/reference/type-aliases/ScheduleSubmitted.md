[**@paiflow/sdk — method and type reference**](../README.md)

---

[@paiflow/sdk — method and type reference](../README.md) / ScheduleSubmitted

# Type Alias: ScheduleSubmitted

> **ScheduleSubmitted** = \{ `error?`: \{ `code`: `string`; `message`: `string`; \}; `ledger?`: `number`; `network`: `"testnet"` \| `"mainnet"`; `status`: `"SUCCESS"` \| `"FAILED"` \| `"PENDING"` \| `"UNKNOWN"` \| `"REJECTED"`; `txHash`: `string`; \}

Schedule control transaction status, not an automatic payout guarantee.

## Properties

### error?

> `optional` **error?**: \{ `code`: `string`; `message`: `string`; \}

#### code

> **code**: `string`

#### message

> **message**: `string`

---

### ledger?

> `optional` **ledger?**: `number`

---

### network

> **network**: `"testnet"` \| `"mainnet"`

---

### status

> **status**: `"SUCCESS"` \| `"FAILED"` \| `"PENDING"` \| `"UNKNOWN"` \| `"REJECTED"`

---

### txHash

> **txHash**: `string`
