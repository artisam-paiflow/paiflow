[**@paiflow/sdk — method and type reference**](../README.md)

---

[@paiflow/sdk — method and type reference](../README.md) / RequestAuth

# Type Alias: RequestAuth

> **RequestAuth** = \{ `kind`: `"public"`; \} \| \{ `kind`: `"token"`; \} \| \{ `idempotencyKey?`: `string`; `kind`: `"webhook"`; `secret`: `string`; \}

Explicit authentication. Public requests omit configured bearer credentials.
