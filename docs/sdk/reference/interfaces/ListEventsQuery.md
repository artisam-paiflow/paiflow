[**@paiflow/sdk — method and type reference**](../README.md)

---

[@paiflow/sdk — method and type reference](../README.md) / ListEventsQuery

# Interface: ListEventsQuery

Indexed event filters. Event absence does not establish payment failure.

## Properties

### cursor?

> `optional` **cursor?**: `string`

Continue from the previous response cursor; omit for the first page.

---

### limit?

> `optional` **limit?**: `number`

Page size 1–100; server default 20.

---

### txHash?

> `optional` **txHash?**: `string`
