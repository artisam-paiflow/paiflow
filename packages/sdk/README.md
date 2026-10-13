# @paiflow/sdk

Unreleased package scaffold for the Paiflow TypeScript SDK. There is no HTTP
client or API method exported yet; do not install this scaffold for integrations.
Publishing requires separate authorization and control of the `@paiflow` npm scope.

The planned SDK covers existing-deployment user APIs: API v1 and the explicitly
listed unversioned routes in [the SDK contract](https://github.com/webnxt-2030/pinkraft/blob/testing/docs/sdk/contract.md).
It does not create or deploy flows.

Supported runtime: Node `>=22.22.2 <23`. Output is ESM with TypeScript declarations;
CommonJS consumers can use dynamic import. There are no runtime dependencies.
Package versions advance independently of the app and API versions.

From the repository root, after installing root development dependencies:

```sh
pnpm sdk:build
pnpm sdk:typecheck
pnpm sdk:test:package
```

The package uses the repository's existing TypeScript compiler without inheriting
its Next.js configuration. No pnpm workspace is introduced. Artifact validation
packs into a temporary directory, installs that tarball into a clean consumer,
checks ESM import and declarations, and rejects unexpected published files.
Generated output and tarballs are ignored by Git. The package's `prepack` script
builds declarations and JavaScript before normal packing.
