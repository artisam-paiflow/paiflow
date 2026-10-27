[**@paiflow/sdk — method and type reference**](../README.md)

---

[@paiflow/sdk — method and type reference](../README.md) / PaiflowTransport

# Class: PaiflowTransport

Shared JSON/SSE transport. No automatic retries, redirects or ambient cookies.

## Constructors

### Constructor

> **new PaiflowTransport**(`options`: [`PaiflowOptions`](../interfaces/PaiflowOptions.md)): `PaiflowTransport`

#### Parameters

##### options

[`PaiflowOptions`](../interfaces/PaiflowOptions.md)

#### Returns

`PaiflowTransport`

## Properties

### origin

> `readonly` **origin**: `string`

## Methods

### request()

> **request**\<`T`\>(`request`: [`JsonRequest`](../interfaces/JsonRequest.md)\<`T`\>, `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)): `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<`T`\>\>

Send one explicit JSON request and parse its response.

#### Type Parameters

##### T

`T`

#### Parameters

##### request

[`JsonRequest`](../interfaces/JsonRequest.md)\<`T`\>

Canonical API path, explicit auth and parser from unknown.

##### options?

[`RequestOptions`](../interfaces/RequestOptions.md) = `{}`

Cancellation, timeout and diagnostic/history correlation.

#### Returns

`Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<`T`\>\>

Parsed data and HTTP metadata; success does not establish finality.

---

### stream()

> **stream**\<`T`\>(`path`: `string`, `parse`: (`event`: `string`, `value`: `unknown`) => `T` \| `undefined`, `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)): `AsyncGenerator`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<`T`\>\>

One public SSE connection; no retries or automatic reconnection.

#### Type Parameters

##### T

`T`

#### Parameters

##### path

`string`

##### parse

(`event`: `string`, `value`: `unknown`) => `T` \| `undefined`

##### options?

[`RequestOptions`](../interfaces/RequestOptions.md) = `{}`

#### Returns

`AsyncGenerator`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<`T`\>\>
