[**@paiflow/sdk — method and type reference**](../README.md)

---

[@paiflow/sdk — method and type reference](../README.md) / ExecuteSubmitted

# Type Alias: ExecuteSubmitted

> **ExecuteSubmitted** = \{ `error?`: \{ `code`: `string`; `message`: `string`; \}; `ledger?`: `number`; `status`: `"SUCCESS"` \| `"FAILED"` \| `"PENDING"`; `txHash`: `string`; \}

Execute submission result; inspect status rather than relying on HTTP success.

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

### status

> **status**: `"SUCCESS"` \| `"FAILED"` \| `"PENDING"`

---

### txHash

> **txHash**: `string`
