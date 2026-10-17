[**@paiflow/sdk — method and type reference**](../README.md)

---

[@paiflow/sdk — method and type reference](../README.md) / WebhookAttempt

# Type Alias: WebhookAttempt

> **WebhookAttempt** = \{ `attemptId`: `string`; `error?`: \{ `code`: `string`; `message`: `string`; \}; `ledger?`: `number`; `network`: `"testnet"` \| `"mainnet"`; `status`: `"SUCCESS"` \| `"FAILED"` \| `"PENDING"` \| `"UNKNOWN"` \| `"REJECTED"`; `txHash?`: `string`; \}

Durable keyed callback outcome; preserve the same event key and effective arguments.

## Properties

### attemptId

> **attemptId**: `string`

---

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

### txHash?

> `optional` **txHash?**: `string`
