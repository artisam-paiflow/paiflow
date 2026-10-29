# Release and versioning policy

This document is the source of truth for Paiflow release versioning. It applies to
the app, public API, and SDKs. [CHANGELOG.md](../CHANGELOG.md) records app
release changes; [CLAUDE.md](../CLAUDE.md) describes the contribution workflow.

## Version ownership

| Surface           | Source of truth                          | Meaning                                                                                                                                                            |
| ----------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| App release       | Root `package.json` → `version`          | A release of the Paiflow application, including its UI, backend, and bundled code. Currently `0.1.0`.                                                              |
| Public API major  | URL prefix, currently `/api/v1`          | The compatibility contract for API consumers.                                                                                                                      |
| API specification | `lib/api/v1/openapi.ts` → `info.version` | A revision of the documented API contract. Currently `1.2.0`. `openapi: "3.1.0"` identifies the specification format, not the Paiflow API version.                 |
| SDK release       | Each SDK package's own version metadata  | A release of that SDK. `packages/sdk` contains the published Node SDK beta `0.2.0`; see the [SDK release record](sdk/release-checklist.md) for publication status. |

These versions advance independently. A dashboard feature can bump the app version
without changing the API contract or SDK. An SDK fix can ship without an app release.
An app version bump does not require a new API URL prefix.

## Choosing an app version

Use `MAJOR.MINOR.PATCH` numbers. While the app is in beta:

- Bump the minor version for new features or breaking app behavior: `0.1.0` → `0.2.0`.
- Bump the patch version for compatible fixes: `0.2.0` → `0.2.1`.
- Reset the patch number to zero when bumping the minor version.
- Move to `1.0.0` only through an explicit release decision that defines the app's
  supported behavior and stability commitment.

From `1.0.0`, bump the major version for breaking supported behavior, the minor
version for compatible features, and the patch version for compatible fixes. If a
release contains several types of changes, choose the highest required bump.
Describe breaking changes and migration steps in the changelog, including during beta.

Ordinary commits, PRs, and development or preview deployments do not require a
version bump. Collect their changes under `Unreleased`; bump once when preparing a
named app release. Documentation-only work can stay unreleased until the next app
release.

## Public API compatibility

Keep existing consumers working within `/api/v1`, even while the app is in beta.
Breaking changes include removing or renaming endpoints or fields, making optional
inputs required, or changing response types or authentication requirements in ways
that require consumers to change their code.

- Add compatible functionality within the current API major. Consumers must tolerate
  additional response fields; assess new enum values against existing consumers.
- Publish breaking contracts under a new prefix such as `/api/v2`. Document the
  migration and support/deprecation timeline before retiring the previous major.
- Bump OpenAPI `info.version` for published contract revisions: minor for compatible
  additions, patch for corrections that preserve the contract, and major for a new
  API major. Keep the document's major aligned with its URL prefix.
- Edit the TypeScript OpenAPI source and run `pnpm api:openapi` to regenerate the
  committed JSON. Run `pnpm test tests/unit/api/v1/openapi.test.ts` when changing
  the v1 specification or published routes.

Changing the app version alone never permits breaking the current API contract.

The maintainer-approved dev-mode removal in [#1138](dev-mode-removal.md) is an explicit
exception for the removed mutable-flow APIs, legacy dev credentials and affected SDK types:
existing-client compatibility for those surfaces is discontinued. Document their removal in
Unreleased and named release notes. This exception does not relax compatibility requirements
for the retained standard API or authorize removing historical financial evidence.

## SDK releases

Each SDK has its own package version, changelog, and documented
API-major and runtime compatibility. Apply the same beta version rules above while
it is below `1.0.0`; after `1.0.0`, use major/minor/patch for breaking changes,
compatible features, and compatible fixes respectively.

SDK package repository metadata points to the public source mirror. Before
publishing a release, ensure that mirror contains the matching SDK source and
release tag. Metadata corrections require a new package version; changing the
source manifest does not update an already-published npm artifact.

Do not match SDK numbers to app numbers. For example, SDK `0.2.0` can still target
API v1. In a shared repository, use distinct SDK tags such as
`sdk-js-v0.2.0` or `sdk-python-v0.1.0`; a dedicated SDK repository can use `vX.Y.Z`.

## Changelog rules

Keep the newest release first, with `Unreleased` at the top. Use `Added`, `Changed`,
`Fixed`, `Removed`, or `Security` subsections as needed; omit empty categories.
Entries describe user or integration impact. Link issues or PRs when available.

Do not invent historical release dates or infer shipped features from the current
package version. The app’s `0.1.0` is its starting metadata value; SDK publication
has a separate record in the [SDK release checklist](sdk/release-checklist.md).
This policy does not establish a historical app release or a deployment claim.

## App release checklist

1. Identify the candidate commit and changes since the last app release. Choose the
   version using this policy and assess API and SDK compatibility separately.
2. Update root `package.json` to the chosen version. Synchronize any metadata that
   embeds that version, if present; dependency changes are not required for a bump.
3. Move the selected `Unreleased` entries into `## [X.Y.Z] - YYYY-MM-DD`, using the
   actual release date, and retain `Unreleased` for future work. Include migration
   steps, configuration changes, and relevant database or contract rollout details.
   Bundled contract code does not prove existing on-chain deployments were upgraded;
   record affected networks, hashes, and addresses when a rollout occurs.
4. Complete the repository's applicable checks and review. Follow the existing
   branch and promotion workflow; this policy does not change branch targets.
5. Once the release is approved, create an annotated app tag `vX.Y.Z` on the exact
   reviewed release commit. The tag version must match its root package version.
   Publish release notes from the changelog. Never move or reuse a published tag.
6. Deploy that release through the authorized deployment process. Record the app
   version, full commit SHA, environment, deployment time, and verification results
   in the deployment record. Tagging, deploying, and SDK publishing are separate
   actions; a tag alone does not show what is live.

For a rollback, record the version and commit restored. Ship a correction under a
new version rather than replacing an existing release. Development deployments can
share a package version, so always use the commit SHA to identify their exact code.

This policy documents release requirements; automated tag/version enforcement and
an in-app version display are not implemented by it.
