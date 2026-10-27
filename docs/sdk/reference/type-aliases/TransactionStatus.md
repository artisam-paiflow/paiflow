[**@paiflow/sdk — method and type reference**](../README.md)

---

[@paiflow/sdk — method and type reference](../README.md) / TransactionStatus

# Type Alias: TransactionStatus

> **TransactionStatus** = \{ `error?`: \{ `code`: `string`; `message`: `string`; \}; `ledger?`: `number`; `network`: `"testnet"` \| `"mainnet"`; `status`: `"SUCCESS"` \| `"FAILED"` \| `"PENDING"` \| `"UNKNOWN"` \| `"REJECTED"`; `txHash`: `string`; \}

Attributable transaction result; UNKNOWN/REJECTED never authorize replacement.

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
