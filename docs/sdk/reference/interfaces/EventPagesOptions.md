[**@paiflow/sdk — method and type reference**](../README.md)

---

[@paiflow/sdk — method and type reference](../README.md) / EventPagesOptions

# Interface: EventPagesOptions

Bounded event iteration; retain the last cursor for explicit continuation.

## Extends

- [`RequestOptions`](RequestOptions.md)

## Properties

### maxPages?

> `optional` **maxPages?**: `number`

Stop after this many pages (1–10000, default 100); a cap is not completeness.

---

### preparationRequestId?

> `optional` **preparationRequestId?**: `string`

Original preparation history UUID. Preserve it for explicit submit correlation.

#### Inherited from

[`RequestOptions`](RequestOptions.md).[`preparationRequestId`](RequestOptions.md#preparationrequestid)

---

### requestId?

> `optional` **requestId?**: `string`

Caller diagnostic ID: 1–128 letters, digits, dots, underscores, colons or hyphens.

#### Inherited from

[`RequestOptions`](RequestOptions.md).[`requestId`](RequestOptions.md#requestid)

---

### signal?

> `optional` **signal?**: `AbortSignal`

Cancels the local request; cancellation does not establish transaction failure.

#### Inherited from

[`RequestOptions`](RequestOptions.md).[`signal`](RequestOptions.md#signal)

---

### timeoutMs?

> `optional` **timeoutMs?**: `number`

Positive timeout in milliseconds, covering fetch and response parsing; default 30000.

#### Inherited from

[`RequestOptions`](RequestOptions.md).[`timeoutMs`](RequestOptions.md#timeoutms)
