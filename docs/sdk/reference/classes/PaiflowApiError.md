[**@paiflow/sdk — method and type reference**](../README.md)

---

[@paiflow/sdk — method and type reference](../README.md) / PaiflowApiError

# Class: PaiflowApiError

HTTP API refusal with open-ended code and sanitised fields/details.

## Extends

- `Error`

## Constructors

### Constructor

> **new PaiflowApiError**(`status`: `number`, `code`: `string`, `message`: `string`, `fields`: `unknown`, `details`: `unknown`, `metadata`: [`ResponseMetadata`](../interfaces/ResponseMetadata.md)): `PaiflowApiError`

#### Parameters

##### status

`number`

##### code

`string`

##### message

`string`

##### fields

`unknown`

##### details

`unknown`

##### metadata

[`ResponseMetadata`](../interfaces/ResponseMetadata.md)

#### Returns

`PaiflowApiError`

#### Overrides

`Error.constructor`

## Properties

### cause?

> `optional` **cause?**: `unknown`

#### Inherited from

`Error.cause`

---

### code

> `readonly` **code**: `string`

---

### details

> `readonly` **details**: `unknown`

---

### fields

> `readonly` **fields**: `unknown`

---

### message

> **message**: `string`

#### Inherited from

`Error.message`

---

### metadata

> `readonly` **metadata**: [`ResponseMetadata`](../interfaces/ResponseMetadata.md)

---

### name

> **name**: `string`

#### Inherited from

`Error.name`

---

### stack?

> `optional` **stack?**: `string`

#### Inherited from

`Error.stack`

---

### status

> `readonly` **status**: `number`
