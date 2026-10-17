[**@paiflow/sdk — method and type reference**](../README.md)

---

[@paiflow/sdk — method and type reference](../README.md) / ResponseMetadata

# Interface: ResponseMetadata

HTTP diagnostics retained on responses and typed API errors.

## Properties

### historyRequestId?

> `optional` **historyRequestId?**: `string`

Server history UUID; persist it with the preparation before signing.

---

### requestId?

> `optional` **requestId?**: `string`

Server-returned diagnostic request ID.

---

### retryAfter?

> `optional` **retryAfter?**: `string`

Raw Retry-After header; no retry is performed automatically.

---

### status

> **status**: `number`

HTTP status, not transaction finality.
