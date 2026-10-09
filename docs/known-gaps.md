# Known gaps and doc drift

Moved out of [`CLAUDE.md`](../CLAUDE.md) §19–§20 so it isn't loaded into every agent session.
`CLAUDE.md` states the rules; this page records where the code and docs don't meet them yet.

## Rules not enforced yet

These are real rules the project wants, currently unbacked by tooling. Don't assume CI catches them,
and don't cite them as already-true when reviewing.

| Rule                                                                             | Reality                                                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No `any`; import ordering                                                        | `eslint.config.mjs` doesn't extend `next/core-web-vitals` and explicitly disables `no-explicit-any` and `no-unused-vars`. No import-order plugin is installed. `pnpm lint` is close to a no-op; 12 `any` sites exist, none justified.                                                          |
| Secrets only via `lib/env.ts`                                                    | 32 `process.env` reads sit outside it, of which only 14 are `NEXT_PUBLIC_*` and 6 are `NODE_ENV`. `GROQ_API_KEY` (`lib/ai/groq.ts`) and `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` (`lib/files/storage.ts`) are genuine violations; the rest is non-secret config that still bypasses the schema. |
| Re-parse signed XDR before submit ([§7.3](../CLAUDE.md#73-submitting))           | Partial. `lib/stellar/signer.ts` re-parses every submitted envelope for source and hash; the deploy route asserts the signed hash matches the prepared one. Nothing compares operations, and `submit-trigger` / `submit-invoke` accept any envelope (`assertDepositEnvelope` is the pattern).  |
| Branded Stellar types ([§6](../CLAUDE.md#6-validation))                          | `lib/stellar/strkey.ts` has two consumers, `lib/stellar/signer.ts` and `components/builder/inputs/address-picker.tsx`. Every other boundary still uses inline `StrKey` refinements.                                                                                                            |
| `safeRaw` tagged template                                                        | Doesn't exist. Raw SQL is plain `$queryRaw` in `app/api/health` and `lib/admin-stats.ts`.                                                                                                                                                                                                      |
| `app/` routes stay thin                                                          | Several are not: `cron/auto-charge-payroll` (946 lines), `cron/process-offramp-jobs` (560), `deployments/[id]/submit` (594).                                                                                                                                                                   |
| E2E in CI                                                                        | No Playwright job exists in `.github/workflows/ci.yml`.                                                                                                                                                                                                                                        |
| Mandatory unit tests ([§12](../CLAUDE.md#12-testing))                            | `lib/flows/validate.ts`, `to-params.ts` and `english.ts` are covered. `lib/stellar/deploy.ts` and the `lib/auth.ts` helpers are not, and "every Zod schema" is not met. Decide in [#376](https://github.com/webnxt-2030/pinkraft/issues/376).                                                  |
| `withErrorHandler` on every handler ([§13](../CLAUDE.md#13-errors--logging))     | 6 of 94 route files skip it, plus `GET files/[id]`. Five are defensible (SSE `events`, `[...nextauth]`, `qr`, `files`, `health`); `balances` and `poll-events` are unexplained and return a non-standard error shape. Tracked in [#376](https://github.com/webnxt-2030/pinkraft/issues/376).   |
| Rate-limit on write endpoints ([§10](../CLAUDE.md#10-security-checklist-per-pr)) | Every mutating `app/api/` handler is limited (`WRITE_RATE_LIMITS`, `lib/api/write-rate-limit.ts`) or a cron route; a guard test fails on a new one. Most `GET` routes are unlimited; without Redis, buckets are per process. See [#371](https://github.com/webnxt-2030/pinkraft/issues/371).   |
| Passkey add requires password re-auth ([§5](../CLAUDE.md#5-authentication))      | Not implemented; session alone is enough. Tracked in [#375](https://github.com/webnxt-2030/pinkraft/issues/375).                                                                                                                                                                               |

## Known doc drift

Being worked through; don't trust these yet:

- `homepage/about.html` claims mainnet is "gated behind a per-user allowlist", and
  `homepage/terms.html` that it is "gated by an allowlist and an explicit confirmation". No allowlist
  exists — the claim stands and the control is being built to match it in
  [#377](https://github.com/webnxt-2030/pinkraft/issues/377), which also rewrites
  [`CLAUDE.md` §7.5](../CLAUDE.md#75-networks).
- The generated changelog tables in `docs/instawards/changelog.md` and `week-2.md` stop at
  19 September, the extent of the public mirror, and omit the 20 September merges; the week-2 prose
  covers them. The rows are added the next time the mirror syncs; regenerate with
  `pnpm instawards:changelog --ref mirror/develop`, never from `origin/develop` (the SHAs differ).
