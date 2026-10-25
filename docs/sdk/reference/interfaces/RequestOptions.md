[**@paiflow/sdk — method and type reference**](../README.md)

---

[@paiflow/sdk — method and type reference](../README.md) / RequestOptions

# Interface: RequestOptions

Per-request cancellation and correlation. No option enables automatic retries.

## Extended by

- [`DeploymentPagesOptions`](DeploymentPagesOptions.md)
- [`EventPagesOptions`](EventPagesOptions.md)
- [`ExecuteSubmitOptions`](ExecuteSubmitOptions.md)
- [`WebhookUnkeyedOptions`](WebhookUnkeyedOptions.md)

## Properties

### preparationRequestId?

> `optional` **preparationRequestId?**: `string`

Original preparation history UUID. Preserve it for explicit submit correlation.

---

### requestId?

> `optional` **requestId?**: `string`

Caller diagnostic ID: 1–128 letters, digits, dots, underscores, colons or hyphens.

---

### signal?

> `optional` **signal?**: `AbortSignal`

Cancels the local request; cancellation does not establish transaction failure.

---

### timeoutMs?

> `optional` **timeoutMs?**: `number`

Positive timeout in milliseconds, covering fetch and response parsing; default 30000.
