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

## Node runtime requirement

The app requires Node `>=22.23.4 <23` (#1096, tracked by #1113).
`nixpacks.toml` pins the Nixpkgs archive to
[`fb7f563bfe8c946201d132e50c9b0f526f983890`](https://github.com/NixOS/nixpkgs/commit/fb7f563bfe8c946201d132e50c9b0f526f983890),
whose `nodejs_22` package is 22.23.4. That package uses **shared Brotli**; the
archive's unpatched Brotli 1.2.0 would retain CVE-2026-111497 despite the Node
version. [`nix/node-runtime.nix`](../nix/node-runtime.nix) appends the exact
[upstream decoder fix](https://github.com/google/brotli/commit/0ed4268a4401abcb4472096340477cf4af7d1a2b)
with a fixed SHA-256 and preserves the existing architecture patch. The override
applies to the package fixed point, covering both Node and Corepack's Node
interpreter with matching patched Brotli headers/library.

Nixpacks copies this expression before installing Nix packages. The provider's
mutable npm overlay is explicitly disabled; the runtime uses only the pinned
archive plus the checksum-pinned security patch. `corepack_22` honors the existing
`pnpm@10.4.1` package-manager pin, and OpenSSL remains available for Prisma.
Nixpacks supports an explicit
[archive override](https://nixpacks.com/docs/configuration/file#nixpkgs-archive);
Node major-version selectors alone do not establish decoder safety.

Strict pnpm engine checking rejects unsupported Node versions during installation.
The dependency-free lifecycle/startup check also requires the expected Brotli
block-switch error marker before migrations or job execution. That is an API/header
sanity check, **not proof of the linked decoder implementation**; the pinned patch
and effective package graph establish provenance. The daily-report image uses
Node 22.23.4 with its bundled patched decoder and runs the same checks.

These source changes do not upgrade running services. After an authorized
promotion/deployment, record the deployed commit, Node version, effective linked
Brotli library/patch provenance and successful runtime checks for every affected
replica/job. Brotli's version string alone is insufficient for this backport. The
snapshot above sources `staging`; merging a PR into `develop` does not deploy that
service.

The root README already points to `.railway/railway.ts`; the historical
`railway.toml` documentation finding in #529 was already resolved on `testing`.

Railway reference: [Infrastructure as Code](https://docs.railway.com/infrastructure-as-code/reference).
