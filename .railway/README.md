# Railway staging configuration

`.railway/railway.ts` describes the existing **paiflow / staging** environment only.
It refuses other project/environment IDs so this staging snapshot cannot be used
against production or testing. A Git pull request's base branch does not change
the pinned Railway target or the existing services' `staging` source branches.

This reconciliation addresses [#529](https://github.com/webnxt-2030/pinkraft/issues/529).
**Do not apply it.** The issue's apply restriction remains until review is complete;
merging this change does not authorize an infrastructure apply.

## Read-only validation

Use Railway CLI 5.42.1 or newer (validated with 5.64.1) and the pinned `railway/iac`
SDK installed by `pnpm install --frozen-lockfile`. Link locally to the existing project:

```bash
railway link --project 576ef2f5-16ec-4778-bdef-dca18f14d04b --environment 11e4c7d9-7b4c-43bd-ab93-50ff894bbb0b
railway config plan --environment 11e4c7d9-7b4c-43bd-ab93-50ff894bbb0b --detailed-exit-code
```

`config plan` does not apply configuration. Exit 0 means no pending changes; exit 2
means changes need review. Always re-plan after code or live configuration changes.
Do not use `--decrypt-variables`, `--show-values`, or import with `--include-variables`.
Existing application variable values stay on Railway via `preserve()`.

## Reconciled inventory

Read-only `config pull` and `config plan` on 15 October 2026 confirmed:

| Resource                   | Existing staging identity                                                   |
| -------------------------- | --------------------------------------------------------------------------- |
| Live `Postgres`            | Private endpoint `postgres-jgix`; volume `postgres-volume-_yQd`             |
| `postgres-staging-archive` | Private endpoint `postgres`; volume `postgres-volume`                       |
| `Redis`                    | Private endpoint `redis`; volume `redis-volume`                             |
| `paiflow-app`              | GitHub branch `staging`; NIXPACKS; existing domains and variables preserved |
| `paiflow-homepage`         | GitHub branch `staging`; `/homepage`; domain `beta.paiflow.xyz`             |
| `homepage`                 | Absent in staging; excluded from this staging-only snapshot                 |

Both Postgres volumes are declared separately. Railway's managed database helpers
retain their existing mounts; this file does not detach, reattach or copy them.
Neither Postgres service exposes a TCP proxy. The archive is retained for evidence;
this change does not inspect database contents or authorize its deletion.

The importer omitted the app's explicit NIXPACKS builder. Restoring that existing
setting prevented an otherwise proposed app build-setting update.

Final read-only plan summary (CLI 5.64.1; explicit staging environment):

```text
Exit code: 0
No changes.
Changes: []
Diagnostics: []
applyResult: null
deploymentId: null
stagedPatchId: null
```

No changes were planned for the app, homepage, databases, archive, Redis or volumes.
No apply, deployment, restart, database mutation or ownership change was performed.
Raw imported metadata and plan JSON are not committed.

## App image and Node runtime requirement

The app requires Node `>=22.23.4 <23` (#1096, tracked by #1113). The root
[`Dockerfile`](../Dockerfile) uses the official `node:22.23.4-bookworm-slim` image,
pinned to multi-platform index digest
`sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d`.
The [official release](https://nodejs.org/en/blog/release/v22.23.4) includes the
Brotli decoder correction. This uses the prebuilt Node distribution instead of
rebuilding Node and its Nix dependency closure inside Railway.

The image installs OpenSSL/CA certificates and pnpm 10.4.1, retains the generated
Prisma client and migration CLI, and runs the existing migration-first startup
script as UID 1000 (`node`). The shell still replaces itself with Next.js for
SIGTERM handling. The default `/app/.docker/files` path is writable; externally
mounted storage must grant UID 1000 write access before rollout.

[`railway.json`](../railway.json) explicitly selects `DOCKERFILE`, clears the old
provider build command, and retains the startup command, 30-second drain and
healthcheck path. Railway [config as code](https://docs.railway.com/config-as-code/reference)
overrides dashboard settings for the deployment; it does not mutate the dashboard.
The historical staging IaC snapshot above still describes the earlier NIXPACKS
service and **must not be applied** to reconcile this image rollout. Updating or
applying that snapshot remains separate work under #529. The app's obsolete
`nixpacks.toml`/custom Nix runtime expression are removed. The homepage and
`.railway/api-daily-report.json` keep their separate build configurations.

Only public `NEXT_PUBLIC_*` values and `RAILWAY_GIT_COMMIT_SHA` are declared build
arguments. Railway [injects declared build variables](https://docs.railway.com/builds/dockerfiles#using-variables-at-build-time).
Browser configuration is frozen by Next.js at build time; runtime changes to
those values require a rebuild. The commit argument tags health/API/analytics
with the actual source revision. Build-time schema parsing uses fixed synthetic
AUTH_SECRET/DATABASE_URL values scoped to the build command. No deployment secret
is supplied to the build, persisted as a default runtime value, or copied from a
local `.env` file. `.dockerignore` allowlists required source and then excludes
credential/private/generated paths within those source directories too.

Strict engine checks and the dependency-free runtime/startup check remain. The
Brotli error marker is API sanity only; the pinned official release supplies
provenance. After an authorized rollout, verify the deployed commit and actual
runtime on every affected replica; passing CI alone is not a deployment claim.
The separate daily-report image remains outside this app-image change.

## Local image validation

Build without hosted credentials or environment files:

```bash
docker build --build-arg RAILWAY_GIT_COMMIT_SHA=0123456789abcdef0123456789abcdef01234567 --tag paiflow-image:local .
```

The `app-image` CI job builds the actual deployment image with synthetic secret-file
canaries in its context, then runs [`scripts/container-smoke.mjs`](../scripts/container-smoke.mjs)
against disposable PostgreSQL/Redis services. It verifies canaries/private checkout
paths are absent, Node/Brotli API/native argon2 and Prisma modules load, pnpm is
available to the non-root user, default storage is writable, a migration failure
blocks startup, successful migration/startup exposes HTTP with the baked commit,
DB/Redis reads work, owner routes remain guarded, and SIGTERM exits cleanly.

To run the same smoke on Linux, provide disposable local PostgreSQL with
user/password/database `paiflow_image` and Redis (no hosted connection). Optional
arguments after the image and commit specify loopback DB, Redis and app ports:

```bash
node scripts/container-smoke.mjs paiflow-image:local 0123456789abcdef0123456789abcdef01234567 5432 6379 4321
```

The smoke deliberately points Stellar RPC/Horizon to an unavailable loopback port,
asserts RPC `down`/overall `degraded`, and never calls a hosted blockchain service.
It removes only its own named app containers. It does not prove wallet signing,
full application acceptance, runtime upgrade of existing services, mounted-volume
permissions, or active-SSE draining; the existing `test:sse-shutdown` remains a
separate required CI check, and hosted replacement acceptance remains separate.

The root README already points to `.railway/railway.ts`; the historical
`railway.toml` documentation finding in #529 was already resolved on `testing`.

Railway reference: [Infrastructure as Code](https://docs.railway.com/infrastructure-as-code/reference).
