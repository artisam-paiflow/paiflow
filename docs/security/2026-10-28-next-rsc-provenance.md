# Next bundled RSC DoS provenance — 28 October 2026

Investigation: [#1117](https://github.com/webnxt-2030/pinkraft/issues/1117),
[#1096 Unknown 8](https://github.com/webnxt-2030/pinkraft/issues/1096).

## Conclusion

The inspected staging deployment contains the patched Next.js 15.5.28 release,
including its bundled React Server Components implementation. Its installed RSC
server files match the authoritative release source, and its precompiled Next
app-page runtimes match the integrity-verified official npm release. No dependency
upgrade or application change is required to resolve this finding for that
deployment.

Separately, the deployed build's Server Action manifest has no Node or Edge
actions. The framework's action handler rejects action requests before entering
the decoder when this manifest is empty. This removes the advisory's action
endpoint precondition in this build; it is supporting reachability evidence,
independent of the demonstrated patch provenance.

This conclusion is limited to the service, deployment and observation below. It
does not close the broader audit, establish historical absence of exploitation,
or attest to other environments or future deployments.

## Observed deployment

Read-only SSH observations on **2026-10-28, 11:25–11:30 UTC**:

| Field                           | Value                                                                              |
| ------------------------------- | ---------------------------------------------------------------------------------- |
| Project / environment / service | `paiflow` / `staging` / `paiflow-app`                                              |
| Deployment                      | `7457b26e-b03c-4fa2-85a3-a60002acb5f9`                                             |
| App commit                      | `3c2e5a5f2da5fda4ae09b1d08e78e389939c547e`                                         |
| Installed Next                  | `15.5.28`                                                                          |
| Inspected replica / Node        | `3e3aa3c5-6379-4c9c-a757-e57ceeb31ede` / `22.23.4`                                 |
| Public health                   | `paiflow.xyz` and `beta.app.paiflow.xyz`: HTTP 200, commit `3c2e5a5`               |
| Built Server Actions            | `.next/server/server-reference-manifest.json`: zero `node` and zero `edge` entries |

The sanitized [artifact comparison record](evidence/1117-next-rsc-2026-10-28.json)
contains observation timestamps, paths, sizes, hashes and comparison results. Only
sanitized deployment and artifact metadata were retained; the manifest's encryption key
was not printed or retained. The staging observation supersedes the older
deployment/version observation cited in #1117 for this narrow question.

## Advisory and patch chain

1. The primary [React advisory GHSA-h3gv-c5rc-p453](https://github.com/react/react/security/advisories/GHSA-h3gv-c5rc-p453)
   describes Server Functions denial of service through excessive resource use.
   Its patched package versions include `19.0.9`, `19.1.10`, `19.2.9` and `19.3.1`.
   The [React 19.2.8 → 19.2.9 comparison](https://github.com/react/react/compare/v19.2.8...v19.2.9)
   contains [patch `3d06b400`](https://github.com/react/react/commit/3d06b4005ac0cf9dec37267f26174adfe6d83611).
   That patch changes backing FormData handling into separate stores for string,
   stream, blob and referenced entries, with a distinct stream namespace.
2. The primary [Next advisory GHSA-p3m5-59mp-jv5r](https://github.com/vercel/next.js/security/advisories/GHSA-p3m5-59mp-jv5r)
   identifies the App Router Server Actions DoS and names **15.5.28** as the fixed
   15.x release. Its precondition is an App Router application containing at least
   one Server Action. The [15.5.28 release](https://github.com/vercel/next.js/releases/tag/v15.5.28)
   explicitly links this advisory.
3. [Next patch `a2021b3e`](https://github.com/vercel/next.js/commit/a2021b3e50527eb3d324c21455faabbd813066e9),
   included in [15.5.27 → 15.5.28](https://github.com/vercel/next.js/compare/v15.5.27...v15.5.28),
   updates the bundled Webpack/Turbopack RSC implementations with the corresponding
   backing-store/stream changes. This source correspondence and the framework's
   explicit fixed-release advisory establish the mapping; a canary version string
   or the root `react` version does not establish it.
4. All **28 installed RSC server JavaScript artifacts** matched SHA-256 hashes of
   the corresponding files under `packages/next/src/compiled/` in the authoritative
   Next release commit [`195cd6a7`](https://github.com/vercel/next.js/tree/195cd6a714086ee0e442cb551da376ad71f37035/packages/next/src/compiled).
   The comparison includes Webpack/Turbopack, experimental/default, Node/Edge/browser
   and the available Node unbundled variants, across production/development builds.
5. Production Next also has precompiled framework runtimes, so checking the
   standalone RSC files alone would leave a gap. All **eight installed app-page
   runtimes**, plus `action-handler.js` and `react-server.node.js`, matched the
   official [`next@15.5.28` npm tarball](https://registry.npmjs.org/next/-/next-15.5.28.tgz).
   Before extracting files, its SHA-512 was checked against the `dist.integrity`
   value in [npm's release metadata](https://registry.npmjs.org/next/15.5.28).
   The evidence record retains that integrity value and all ten comparisons.

## Endpoint reachability and practical impact

Paiflow uses App Router and server rendering, so React's client-only exemption
does not apply. The relevant Next precondition is more specific: at least one
Server Action must exist. The built manifest, checked on the actual deployment,
has zero action entries in both runtime sections.

The authoritative release's [`action-handler.ts`](https://github.com/vercel/next.js/blob/195cd6a714086ee0e442cb551da376ad71f37035/packages/next/src/server/app-render/action-handler.ts#L574)
checks `hasServerActions(serverActionsManifest)` before the multipart/body decoder
paths. That helper tests whether either manifest section has entries. The deployed
handler bytes match the official release, as recorded above. Thus the described
Server Action decoder path is unavailable in this build. No hostile or synthetic
action request was sent to the service to reach this conclusion.

The outcome is **patched**, with an independently absent endpoint precondition.
The advisory concerns availability; this investigation does not establish remote
code execution, data access or unauthorized blockchain activity. Empty audit
output and the absence of authored `"use server"` modules were not used as patch
proof. Adding Server Actions or changing the framework/build requires reassessing
reachability, while retaining a patched supported release.

## Verification scope and repeatability

The live probe read the installed Next package version, hashed files using Node's
`crypto.createHash("sha256")`, and counted only the manifest's `node`/`edge` keys.
It printed an allowlist of public deployment metadata; no environment dump,
credential read, transaction signing, database mutation or deployment occurred.

For an independent comparison, download the exact release-source paths listed in
the evidence record and compare their SHA-256 hashes. Download the official npm
tarball, verify its SHA-512 integrity, then hash its `package/<path>` members for
the ten runtime comparisons. A later live observation must recapture deployment,
commit, artifacts and action counts rather than assuming this snapshot remains
current. No exploit or runtime regression test is needed for this documentation-
only resolution; application behavior and framework versions remain unchanged.
