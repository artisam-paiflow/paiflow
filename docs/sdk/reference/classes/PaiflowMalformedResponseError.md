[**@paiflow/sdk — method and type reference**](../README.md)

---

[@paiflow/sdk — method and type reference](../README.md) / PaiflowMalformedResponseError

# Class: PaiflowMalformedResponseError

Invalid or oversized success response, retaining safe HTTP metadata.

## Extends

- [`PaiflowTransportError`](PaiflowTransportError.md)

## Constructors

### Constructor

> **new PaiflowMalformedResponseError**(`metadata`: [`ResponseMetadata`](../interfaces/ResponseMetadata.md)): `PaiflowMalformedResponseError`

#### Parameters

##### metadata

[`ResponseMetadata`](../interfaces/ResponseMetadata.md)

#### Returns

`PaiflowMalformedResponseError`

#### Overrides

[`PaiflowTransportError`](PaiflowTransportError.md).[`constructor`](PaiflowTransportError.md#constructor)

## Properties

### cause?

> `optional` **cause?**: `unknown`

#### Inherited from

[`PaiflowTransportError`](PaiflowTransportError.md).[`cause`](PaiflowTransportError.md#cause)

---

### message

> **message**: `string`

#### Inherited from

[`PaiflowTransportError`](PaiflowTransportError.md).[`message`](PaiflowTransportError.md#message)

---

### metadata

> `readonly` **metadata**: [`ResponseMetadata`](../interfaces/ResponseMetadata.md)

---

### name

> **name**: `string`

#### Inherited from

[`PaiflowTransportError`](PaiflowTransportError.md).[`name`](PaiflowTransportError.md#name)

---

### stack?

> `optional` **stack?**: `string`

#### Inherited from

[`PaiflowTransportError`](PaiflowTransportError.md).[`stack`](PaiflowTransportError.md#stack)
