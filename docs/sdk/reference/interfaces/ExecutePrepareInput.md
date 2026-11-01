[**@paiflow/sdk — method and type reference**](../README.md)

---

[@paiflow/sdk — method and type reference](../README.md) / ExecutePrepareInput

# Interface: ExecutePrepareInput

Prepare a caller-signed deposit into this existing deployment.

## Properties

### amount

> **amount**: `string`

Positive integer stroop string bounded to i128, never a floating-point amount.

---

### arguments?

> `optional` **arguments?**: [`ExecutionArguments`](ExecutionArguments.md)

All declared node inputs; never stored-configuration overrides.

---

### from

> **from**: `string`
