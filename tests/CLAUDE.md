# Testing

Loaded when working under `tests/`. The root [`CLAUDE.md`](../CLAUDE.md) §1 has the commands and §12
what must be tested.

## Vitest projects

`node` picks up `tests/unit/**/*.test.ts`; `dom` picks up `tests/unit/**/*.test.tsx` under jsdom
(plus `tests/unit/setup-dom.ts`). A file matching neither is skipped without a warning, which
`tests/unit/test-config.test.ts` guards against.

## Env isolation

`vitest.config.ts` aliases `server-only` and `dotenv` to stubs in `tests/stubs/` — **there is no
`@/lib/env` stub; code under test gets the real schema.** Isolation comes from `tests/unit/setup.ts`
instead: before each test **file** it deletes every variable `EnvSchema` knows (`ENV_VAR_NAMES`),
then sets `AUTH_SECRET`, pins `NODE_ENV=test` (vitest only does `??=`, so a shell `production` would
otherwise leak), and puts back `DATABASE_URL` and `LOG_LEVEL` from your shell — falling back to the
local Postgres and `silent` — so you can still point the suite's `deleteMany()` wipes at a scratch
DB or turn logging up. No other **schema-backed** variable reaches the suite from your shell; the
`process.env` reads that bypass `lib/env.ts` ([`docs/known-gaps.md`](../docs/known-gaps.md)) are
not covered.

Nothing re-scrubs between cases in a file, so a test that mutates `process.env` cleans up after
itself; one that needs a specific value sets it and calls `vi.resetModules()` to clear `env()`'s
memoized parse.

## Component tests (`dom` project)

Rendered under jsdom with `@testing-library/react` and `user-event`; query with `getByRole` and
plain DOM (no jest-dom), and scan with `axe-core` where accessibility is the claim. Test the
extracted component, **never `ConfigPanel`**: its `<style jsx>` needs Next's SWC styled-jsx
transform, which vitest does not run. Pure logic still belongs in a `*.utils.ts` tested in the
`node` project.

## E2E (Playwright)

Required full happy-path acceptance remains: log in as the seeded admin, build a splitter flow,
deploy through a working browser wallet harness, assert `CONFIRMED` plus a contract address, then
fund and assert the event feed animates the fan-out. This acceptance is still open under
[#1003](https://github.com/webnxt-2030/pinkraft/issues/1003).

`happy-path.spec.ts` actively checks draft creation, the deployment review's English preview,
network chip and available deploy control, stopping before wallet access. Its separate wallet
signing/deployment/funding test is explicitly skipped until a working browser harness exists;
neither that skip nor Playwright test collection counts as wallet or deployment acceptance.
Component tests cover signing and reconciliation separately; they do not establish browser or
real handset acceptance. Do not hide an unexercised signing path behind a caught timeout or an
early successful return.

E2E runs locally only; it is not wired into CI. Playwright reuses an existing dev server if one is
up and needs `tests/e2e/.auth/admin.json` from its global setup. Collection-only checks should use
an isolated config with no global setup, web server, or storage state so they do not overwrite
shared authentication files or connect to an application.

## CI

The `node-tests` CI job runs the full, unsharded `pnpm test:ci` suite for both Vitest
projects against dedicated Postgres and Redis services. It uploads the junit report
as the `vitest-junit` artifact and writes a per-project job summary, including after
test failure unless cancelled. Test setup and its per-file environment isolation
are unchanged. Static/SDK checks and host build/SSE checks run in separate parallel
jobs; the required `node` aggregate passes only when all three workers succeed.
Contracts: each crate carries its own `#[test]` module using `soroban-sdk`'s test env;
CI runs `cargo test --workspace`.
