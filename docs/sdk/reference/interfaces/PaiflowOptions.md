[**@paiflow/sdk — method and type reference**](../README.md)

---

[@paiflow/sdk — method and type reference](../README.md) / PaiflowOptions

# Interface: PaiflowOptions

Node client configuration. Tokens belong only on your trusted server.

## Properties

### baseUrl

> **baseUrl**: `string`

Trusted HTTPS origin, without path/query/credentials; HTTP loopback is allowed.

---

### fetch?

> `optional` **fetch?**: (`input`: `RequestInfo` \| `URL`, `init?`: `RequestInit`) => `Promise`\<`Response`\>

Optional fetch implementation; must honour redirect refusal and omitted cookies.

[MDN Reference](https://developer.mozilla.org/docs/Web/API/Window/fetch)

#### Parameters

##### input

`RequestInfo` \| `URL`

##### init?

`RequestInit`

#### Returns

`Promise`\<`Response`\>

---

### timeoutMs?

> `optional` **timeoutMs?**: `number`

Positive timeout in milliseconds, covering fetch and response parsing; default 30000.

---

### token?

> `optional` **token?**: `string`

Server-side developer (`pfd_`) or deployment (`pfk_`) credential.
