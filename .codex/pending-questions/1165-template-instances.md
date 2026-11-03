# #1165 non-blocking implementation assumptions

- 2026-11-01: No product-specific instance quota was prescribed. Use a conservative per-owner cap of 1,000 non-retired non-failed template instances, ten unresolved template preparations, and one unresolved deployment per owner/source account. No global wallet reservation is introduced. These limits are documented and concurrency tested; raising them later requires capacity evidence.
- 2026-11-01: The retained token management API accepts explicit templateIds now; adding template selection controls to the existing developer panel belongs to #1166. Existing deployment-only panel submissions preserve omitted template grants. Template publication remains owner-session only.
- 2026-11-01: Instance events expose retained indexed event history. Existing confirmed-deployment pollers ingest events; no additional SSE or resource family is needed.
