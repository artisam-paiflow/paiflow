[**@paiflow/sdk — method and type reference**](../README.md)

---

[@paiflow/sdk — method and type reference](../README.md) / WebhookTriggerOptions

# Interface: WebhookTriggerOptions

Per-request cancellation and correlation. No option enables automatic retries.

## Extends

- [`WebhookUnkeyedOptions`](WebhookUnkeyedOptions.md)

## Properties

### idempotencyKey

> **idempotencyKey**: `string`

Caller-persisted logical event identity; reuse with the same effective arguments.

---

### preparationRequestId?

> `optional` **preparationRequestId?**: `string`

Original preparation history UUID. Preserve it for explicit submit correlation.

#### Inherited from

[`WebhookUnkeyedOptions`](WebhookUnkeyedOptions.md).[`preparationRequestId`](WebhookUnkeyedOptions.md#preparationrequestid)

---

### requestId?

> `optional` **requestId?**: `string`

Caller diagnostic ID: 1–128 letters, digits, dots, underscores, colons or hyphens.

#### Inherited from

[`WebhookUnkeyedOptions`](WebhookUnkeyedOptions.md).[`requestId`](WebhookUnkeyedOptions.md#requestid)

---

### signal?

> `optional` **signal?**: `AbortSignal`

Cancels the local request; cancellation does not establish transaction failure.

#### Inherited from

[`WebhookUnkeyedOptions`](WebhookUnkeyedOptions.md).[`signal`](WebhookUnkeyedOptions.md#signal)

---

### timeoutMs?

> `optional` **timeoutMs?**: `number`

Positive timeout in milliseconds, covering fetch and response parsing; default 30000.

#### Inherited from

[`WebhookUnkeyedOptions`](WebhookUnkeyedOptions.md).[`timeoutMs`](WebhookUnkeyedOptions.md#timeoutms)

---

### webhookSecret

> **webhookSecret**: `string`

#### Inherited from

[`WebhookUnkeyedOptions`](WebhookUnkeyedOptions.md).[`webhookSecret`](WebhookUnkeyedOptions.md#webhooksecret)
