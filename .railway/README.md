# Railway staging configuration

`.railway/railway.ts` describes the existing **paiflow / staging** environment only.
It refuses other project/environment IDs so this staging snapshot cannot be used
against production or testing. The PR target branch `testing` does not change the
Railway target or the existing services' `staging` source branches.

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

The root README already points to `.railway/railway.ts`; the historical
`railway.toml` documentation finding in #529 was already resolved on `testing`.

Railway reference: [Infrastructure as Code](https://docs.railway.com/infrastructure-as-code/reference).
