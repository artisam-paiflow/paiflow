[**@paiflow/sdk — method and type reference**](../README.md)

---

[@paiflow/sdk — method and type reference](../README.md) / JsonRequest

# Interface: JsonRequest\<T\>

Low-level JSON request; prefer typed deployment workflow methods.

## Type Parameters

### T

`T`

## Properties

### auth

> **auth**: [`RequestAuth`](../type-aliases/RequestAuth.md)

---

### body?

> `optional` **body?**: `unknown`

---

### maxResponseBytes?

> `optional` **maxResponseBytes?**: `number`

Response body byte limit; defaults to 4 MiB.

---

### method

> **method**: `"GET"` \| `"POST"`

---

### parse

> **parse**: (`value`: `unknown`) => `T`

#### Parameters

##### value

`unknown`

#### Returns

`T`

---

### path

> **path**: `string`

---

### query?

> `optional` **query?**: `Readonly`\<`Record`\<`string`, `string`\>\>

---

### raw?

> `optional` **raw?**: `boolean`
