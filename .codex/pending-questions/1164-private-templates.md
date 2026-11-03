# #1164 non-blocking product question

- 2026-11-01: Should publication support unresolved declared input leaves rather than
  a configured exemplar? Current assumption: publication requires an ordinary
  deployable configured exemplar, while actual instance binding still requires
  every declared value unless an explicit default exists. This preserves validation
  for all standard flow types without inventing placeholder compiler semantics.
  Documented in docs/flow-templates.md; no implicit exemplar fallback is permitted.
