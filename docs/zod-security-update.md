# Zod security update

The runtime uses Zod 4.6.6 or later for the collection-size fix described in
[GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).
Oversized constrained arrays, maps and sets reject before validating their
elements. This prevents allocation of one issue per element before reporting an
already-exceeded upper size bound. There is no new audit exception or import of
the package's legacy `zod/v3` implementation.

The form resolver moves to its compatible 5.x release. Only Split's form generic
needs separate input and parsed-output types: the input may omit `payoutMode`,
while the parsed request supplies the existing `crypto` default. Pay and Split
keep the same field errors, stroop strings and submission behavior.

Compatibility adaptations preserve existing contracts:

- Prior UUID checks accepted the hexadecimal 8-4-4-4-12 shape without imposing
  UUID version/variant bits. Zod 4's `guid` check matches that old pattern; the
  existing `Invalid uuid` error text and grant lowercase normalization remain.
- Previously unbounded number integer checks retain `Number.isInteger` behavior
  through a shared helper. Existing sign/range and downstream domain checks are
  unchanged. Already bounded integer fields retain their limits. Money remains
  integer strings and is never converted through these number helpers.
- AI edge transforms keep omitted handles absent and normalize explicit `null`
  to `undefined`. Arbitrary AI configuration records have explicit string keys.
- Event payload data retains its previous optional/null/unknown behavior.
- Existing query/environment defaults and transformations retain their parsed
  values. No validation policy is intentionally tightened by the dependency
  update.

The regression suite exercises the collection-size behavior, both real form
resolvers, identifier boundaries, input defaults, optional transformed fields,
and the WalletConnect-to-ABI-parser dependency path. The transitive ABI parser
already supports Zod 4; no unrelated wallet package upgrade is required.

## Browser CSP

`instrumentation-client.ts` configures Zod's interpreter before browser object
schemas are constructed. Zod's optional code-generation probe would otherwise
produce a CSP violation even when its blocked operation is caught internally.
Next 15.5 loads this hook before application hydration; see its
[startup timing](https://nextjs.org/docs/15/app/api-reference/file-conventions/instrumentation-client#execution-timing).
The application's production policy keeps `unsafe-eval` disabled.

Run `node tests/zod-csp.mjs` for a local production Next/Chromium rehearsal using
the actual startup hook, policy, Dev schemas and form resolvers. It checks
module-level object construction, later parsing and form validation with no
browser errors or `securitypolicyviolation` events. The fixture uses a fresh
browser context and no wallet profile, database or hosted service. The ordinary
unit suite also verifies interpreter startup without any code-generation probe.
