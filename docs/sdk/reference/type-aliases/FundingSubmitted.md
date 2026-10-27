[**@paiflow/sdk — method and type reference**](../README.md)

---

[@paiflow/sdk — method and type reference](../README.md) / FundingSubmitted

# Type Alias: FundingSubmitted

> **FundingSubmitted** = \{ `error?`: \{ `code`: `string`; `message`: `string`; \}; `ledger?`: `number`; `network`: `"testnet"` \| `"mainnet"`; `status`: `"SUCCESS"` \| `"FAILED"` \| `"PENDING"` \| `"UNKNOWN"` \| `"REJECTED"`; `txHash`: `string`; \}

Funding transaction status, including unresolved UNKNOWN/REJECTED outcomes.

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
