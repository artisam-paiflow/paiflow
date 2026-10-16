# Developer token implementation decisions

## 2026-10-16 — #1029 shared contract

- Use a new `DeveloperApiToken` credential: `pfd_` followed by 64 lowercase hex characters (32 cryptographically random bytes). It is distinct from `pfk_` and legacy `pkdev_`; it grants no legacy dev/payroll access.
- Permission enum is `READ_ONLY` or `READ_OPERATE`, immutable after creation. All selected deployments share that permission. API v1 enforcement is #1030.
- Owner-session management lives at `/api/developer-tokens`: GET lists, POST creates; `/[tokenId]`: GET inspects, PATCH atomically replaces `deploymentIds`, DELETE idempotently revokes. `/deployments` lists eligible selection candidates. Bearer credentials cannot manage tokens; sandbox sessions are explicitly refused.
- Create body: optional trimmed 1–64 character `label`, required `permission` and 1–100 unique UUID `deploymentIds` (normalized to lowercase before duplicate detection), optional integer `expiresInDays` 1–365 (omit for no expiry). PATCH accepts only `deploymentIds`, including an empty array to suspend all access. Permission, label and expiry are immutable; replace the credential to change them.
- Maximum 10 unrevoked, unexpired tokens per owner and 100 grants per token. Serialize management writes on the owner row; validate and lock eligible deployment rows inside the same transaction as the grant write. Owners may remove retiring/retired grants but cannot add or retain them in a replacement selection.
- Lists use UUID cursor pagination (default 20, maximum 100), ordered by immutable ID. Responses use `{ data: { items, nextCursor } }`; metadata is `{ id, tokenPrefix, label, permission, createdAt, lastUsedAt, expiresAt, revokedAt, deploymentIds }`. Only create additionally returns `token`. All successful responses set `Cache-Control: no-store`.
- Management writes share one owner bucket of 30 requests per minute; the static write-route guard recognizes only the explicit `requireDeveloperTokenManager(true)` call.
- Management audits are transactionally persisted with mutations, with IDs/permission only; no credential or hash. Revoked tokens and transaction attribution remain retained. Add nullable `SignedTransaction.developerApiTokenId` with a separate relation, leaving deployment attribution intact; runtime population is #1030.
- Add the user-authorized integration branch `dev-token` to existing CI branch triggers so child PRs receive the standard Node/Rust checks.

- API v1 bearer acceptance, mint-side `markTokenKnown`, cache correctness on grant/revocation changes, operation permissions and ApiRequestLog/reporting attribution remain #1030. This lifecycle change alone does not make `pfd_` usable against API v1.
