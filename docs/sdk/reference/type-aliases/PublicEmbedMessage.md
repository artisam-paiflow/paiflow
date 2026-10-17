[**@paiflow/sdk — method and type reference**](../README.md)

---

[@paiflow/sdk — method and type reference](../README.md) / PublicEmbedMessage

# Type Alias: PublicEmbedMessage

> **PublicEmbedMessage** = \{ `event`: `"connected"`; \} \| \{ `event`: `"snapshot"`; `snapshot`: [`PublicEmbedActivity`](PublicEmbedActivity.md); \}

Public connection or latest-50 snapshot; deduplicate snapshots by eventId.
