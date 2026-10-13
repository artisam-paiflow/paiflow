# @paiflow/sdk

Unreleased shared HTTP foundation for the Paiflow TypeScript SDK.
`PaiflowTransport` is exported; deployment workflow methods are not implemented yet.
This foundation is not a complete integration SDK.
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
pnpm sdk:test
pnpm sdk:test:package
```

The package uses the repository's existing TypeScript compiler without inheriting
its Next.js configuration. No pnpm workspace is introduced. Artifact validation
packs into a temporary directory, installs that tarball into a clean consumer,
checks ESM import and declarations, and rejects unexpected published files.
Generated output and tarballs are ignored by Git. The package's `prepack` script
builds declarations and JavaScript before normal packing.

## Transport foundation

Configure a trusted HTTPS service origin, a server-side deployment token when
needed, and optionally an injected standards-compliant fetch implementation.
HTTP is accepted only for `localhost`, `127.0.0.1`, or `[::1]` development origins.
Base URLs cannot contain credentials, query strings or path prefixes. Requests
never follow redirects and use `credentials: "omit"`; public and webhook requests
never inherit the deployment token. An injected fetch must honor these options.

`request()` requires explicit public, token or webhook authentication and a
parser from `unknown` to the desired result. It unwraps `{data}` once, or accepts
an explicitly raw response, retaining HTTP status, request/history IDs and
Retry-After. API errors preserve safe structured fields/details and future error
codes; known sensitive keys and supplied credentials are redacted. Control-intent
UUIDs, transaction hashes and node identifiers remain available for recovery. Transport,
malformed-response, timeout and abort errors never include raw bodies or causes.

Requests default to a 30-second timeout covering fetching and body parsing.
Caller cancellation is supported. There are no retries, including for POST:
a timeout or abort after sending does not prove financial failure. Retain the
original transaction and use the workflow's status/reconciliation protocol.
HTTP success alone does not establish transaction success.

Paths must be canonical API paths. Query parameters cannot contain credentials;
the opaque `intent` parameter is permitted only for the documented public
subscription-allowance status protocol. Do not log that URL. Request options
allow validated caller request IDs and UUID preparation-history correlation IDs,
not arbitrary header overrides. Endpoint-specific methods and shape validation
arrive in subsequent SDK issues.
