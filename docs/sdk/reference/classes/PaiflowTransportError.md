[**@paiflow/sdk — method and type reference**](../README.md)

---

[@paiflow/sdk — method and type reference](../README.md) / PaiflowTransportError

# Class: PaiflowTransportError

Network/transport failure with no raw response body or cause attached.

## Extends

- `Error`

## Extended by

- [`PaiflowTimeoutError`](PaiflowTimeoutError.md)
- [`PaiflowAbortError`](PaiflowAbortError.md)
- [`PaiflowMalformedResponseError`](PaiflowMalformedResponseError.md)

## Constructors

### Constructor

> **new PaiflowTransportError**(`message?`: `string`): `PaiflowTransportError`

#### Parameters

##### message?

`string` = `"Paiflow request failed"`

#### Returns

`PaiflowTransportError`

#### Overrides

`Error.constructor`

## Properties

### cause?

> `optional` **cause?**: `unknown`

#### Inherited from

`Error.cause`

---

### message

> **message**: `string`

#### Inherited from

`Error.message`

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
