# Lantern embedded authentication assessment — #932

Assessment date: 2026-10-13. Paiflow baseline: `dc36334f9fac801b7cbdab12cf4a9fb745dc6785`
on `lantern-staging`. This is a design assessment, not authentication enablement or device acceptance.
The public testnet milestone remains independent. Production cookies, framing, wallet selection,
API authorization and feature flags are unchanged. Deployment and promotion are not authorized.

## Recommendation and decisions

Retain Paiflow's Auth.js identity, credentials/passkey exchange, database authorization and session
invalidation. First implement and review authenticated-write protections that remain valid when
cross-site cookies are sent. Then prototype an **isolated embedded Auth.js configuration/namespace**
on an approved test deployment, keeping the existing top-level `Lax` session. Prefer this to changing
the global session cookie or replacing Auth.js with Centient's wallet-challenge authentication.
This is conditional on a coherent server-side reader/writer design and actual browser evidence;
there is no approved production session design yet.

Use a candidate HTTPS embedded session cookie with `HttpOnly; Secure; Path=/; SameSite=None;
Partitioned` and a distinct `__Host-` name. Namespace CSRF/callback cookies as well. Issue and refresh
only through authenticated Paiflow ceremonies; never treat a wallet address, trusted parent,
`session: true`, query flag, `Referer`, or client-supplied embedded mode as Paiflow authentication.
The configuration selector chooses transport only and must not confer privileges.

Start the prototype with existing username/password accounts. Defer Google inside Lantern, passkey
login/enrollment and microphone until their separate gates below pass. Google-only users would have
no supported embedded login until a verified alternative exists; do not silently enroll passwords
or substitute wallet identity. Offer ordinary browser use with its existing browser wallets;
opening a tab does not make Lantern an external wallet provider.

Before implementing the prototype, decide the canonical HTTPS app/QA host, desired cross-context
logout behavior, Android/extension minimum builds, and whether the product accepts that restricted
first authenticated milestone. Keep authenticated framing/signing disabled until security review
and per-platform tests pass. Record decisions in root `temp-memory.md` via the orchestrator.

## Evidence and scope

Repository facts below are from this baseline, using relative source links. Installed source was
checked for `next-auth@5.0.0-beta.32`, resolved `@auth/core@0.41.3` (package override
`>=0.41.3 <0.42`), and `@simplewebauthn/server@14.0.1`. These resolved versions, not current upstream
defaults, govern the mechanics described here. `pnpm-lock.yaml` and `package.json` pin the evidence.

Read-only comparisons: Centient develop `58cf9c04fbcf8c02b239fa1577d32230d7b8d4cf` and Lantern
develop `ed512f6d3a478e4fc9eaab498627a6d0f8165d30`. Neither repository was modified. Centient's
[custom cookie writer/clearer](https://github.com/webnxt-2030/Centient/blob/58cf9c04fbcf8c02b239fa1577d32230d7b8d4cf/lib/labeler-auth.ts)
uses embedded partitioned cookies and expires both partitioned and ordinary forms. Its existing
wallet-challenge session system is comparison evidence, not a drop-in for Paiflow's account model.
Screenshot framing fixes do not certify either app's session/device support.

## Current identity and cookie inventory

[`auth.config.ts`](../../../auth.config.ts) supplies an Edge-compatible JWT session and callbacks;
[`lib/auth.ts`](../../../lib/auth.ts) spreads that configuration for Node handlers, adds credentials
and optional Google, and uses the same session name. Seven-day JWTs include ID, role, username,
fixed sign-in `authenticatedAt`, and frozen `sessionVersion`. Middleware checks cryptographic
session identity; `getSessionUser` additionally checks database activity/current version and reads
role from the database. Preserve that distinction, ownership filters and SANDBOX restrictions.

All application cookies below are host-only, `Path=/`, HttpOnly and `SameSite=Lax`, with Secure in
production. `__Host-` names omit that prefix in development. Framework defaults instead derive
Secure/prefixes from `useSecureCookies` or the effective HTTPS URL.

| Cookie family             | Actual names/options and lifetime                                                                              | Readers, writers and cleanup touchpoints                                                                                                                                 |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Paiflow session           | Production `__Host-paiflow.session`; development `paiflow.session`; JWT maxAge seven days                      | Shared Edge/Node Auth.js config; handlers and server `auth()`; rolling framework session responses; client `SessionProvider`; client/server signOut; stale-session route |
| Framework CSRF            | HTTPS `__Host-authjs.csrf-token`, otherwise `authjs.csrf-token`; framework double-submit token/hash            | Auth.js `/csrf`, client `getCsrfToken`, credentials/signin/signout/session-update framework actions                                                                      |
| Framework callback        | HTTPS `__Secure-authjs.callback-url`, otherwise `authjs.callback-url`                                          | Auth.js callbacks; `lib/auth.ts` explicitly reads this exact name for Google signup return, so a namespace change needs that reader changed                              |
| Google state/PKCE         | HTTPS `__Secure-authjs.state` and `__Secure-authjs.pkce.code_verifier` (unprefixed on HTTP), maxAge 15 minutes | Auth.js OAuth checks create/consume/clear; Paiflow explicitly enables PKCE, state, nonce                                                                                 |
| Google nonce              | HTTPS `__Secure-authjs.nonce` (unprefixed on HTTP)                                                             | Auth.js check creation uses 15-minute check lifetime; consumption clears the configured cookie                                                                           |
| Framework WebAuthn        | HTTPS `__Secure-authjs.challenge`, maxAge 15 minutes                                                           | Default exists in core, but Paiflow uses custom SimpleWebAuthn routes, not an Auth.js WebAuthn provider                                                                  |
| Google link intent        | `__Host-paiflow.google-link`, five minutes                                                                     | `api/account/google/link` sets; Node signIn reads/clears; hashed single-use DB intent checks account, recent auth and sessionVersion                                     |
| Google signup intent      | `__Host-paiflow.google-signup`, ten minutes                                                                    | `api/auth/google/signup` reads/replaces/clears; Node signIn consumes/clears; nextauth GET callback also appends a literal Lax deletion on OAuth cancellation/errors      |
| Google code attempt       | `__Host-paiflow.google-code-attempt`, one hour                                                                 | Signup endpoint reads/sets browser budget even on errors; independent IP backstop                                                                                        |
| Google suggested username | `__Host-paiflow.google-username`, ten minutes                                                                  | Node signIn sets/clears; `app/auth/signup/page.tsx` reads; no authentication authority                                                                                   |

Sources: [Google intent logic](../../../lib/auth/google.ts),
[signup intent](../../../lib/auth/google-signup.ts), [username cookie](../../../lib/auth/google-username.ts),
[signup writer](../../../app/api/auth/google/signup/route.ts),
[nextauth route](../../../app/api/auth/[...nextauth]/route.ts),
[link writer](../../../app/api/account/google/link/route.ts).

Installed core `lib/init.js` merges custom options; `lib/utils/cookie.js`, chunks large sessions into `.0`, `.1`,
etc., reconstructs using names starting with the configured prefix, and applies configured options
when refreshing or deleting every observed chunk. Choose non-overlapping ordinary/embedded names;
do not pick an embedded name beginning with the complete ordinary session name. Core
`lib/actions/session.js`, `lib/actions/callback/index.js` and `jwt.js` use the session cookie name as
the encryption derivation salt. A rename needs matching issuance and decoding; moving cookie bytes
to a new name is not a valid migration. The vendored cookie serializer supports `partitioned`.

Verify actual Set-Cookie output through Next's response adapters, middleware and server helpers;
supported serialization in core does not prove every platform retains an attribute. Clear cookies
with matching partition/path/domain and chunk options. Ordinary and partitioned cookies are
distinct; request Cookie headers do not report their attributes/partition keys. Prefer distinct
names and explicit precedence instead of trying to infer partition from duplicate values.

## Platform behavior and remaining hypotheses

CHIPS scopes a cookie to the top-level site plus its cookie host; it does not scope it to the remote
dApp that initiated a request. A first-party Paiflow tab and a Lantern frame do not generally share
the same partition, and a Google popup/redirect can change that key. Other apps under the same
Lantern parent must be included in CSRF tests. These are design implications, not a reproduction of
a current exploit. [Official CHIPS documentation](https://privacysandbox.google.com/cookies/chips).

Android: record OS and Android System WebView version, Lantern APK/build, native CookieManager
settings and cookie persistence on app kill/restart. Third-party cookie acceptance is configurable
per WebView and defaults depend on the target SDK. Do not infer WebView CHIPS behavior from desktop
Chrome. [Android CookieManager](https://developer.android.com/reference/android/webkit/CookieManager).

Extension: Paiflow HTTPS cookies belong to Paiflow, not to the `chrome-extension://` origin. Chrome's
extension rules include exceptions to third-party blocking and host-permission-dependent same-site
request treatment; storage and cookie partition behavior are not interchangeable. Record actual
manifest/permissions, browser version, tab/popup/side-panel context, privacy policy settings and
incognito behavior. Do not conclude a global None cookie is needed for the extension merely because
Android is cross-site, or assume an exemption fixes OAuth.
[Chrome extension storage/cookie rules](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies).

Lantern's pinned [frame sandbox](https://github.com/kimerran/stellar-lantern/blob/ed512f6d3a478e4fc9eaab498627a6d0f8165d30/src/core/miniapps/frame.ts)
uses `allow-scripts allow-forms allow-popups`, adding `allow-same-origin` for registered session apps.
That restores the app's origin for APIs/storage; it does not override SameSite, permission policy or
Google restrictions. Its [iframe](https://github.com/kimerran/stellar-lantern/blob/ed512f6d3a478e4fc9eaab498627a6d0f8165d30/src/popup/screens/Apps.tsx)
has no feature `allow` attribute. Sandbox lacks top-navigation and popup-escape tokens. Actual
shipped builds remain unverified. Any future parent-side permission/navigation work goes into a
Paiflow handoff for the user to forward, not an external issue write.

## Authenticated writes and CSRF design prerequisite

[`auth-write-inventory.csv`](./auth-write-inventory.csv) inventories all 99 API route files exporting
POST/PUT/PATCH/DELETE at this baseline, including non-session endpoints. It records literal guard,
body-reader and Origin-check signals **at file level**, not proof that every method invokes them.
Imported handlers/wrappers require tracing; GET handlers with side effects, server actions and
middleware responses require additional review. The next implementation must annotate every
session-accepting method with its actual guard and negative-test result before changing cookies.

Source review finds literal application-Origin checks in Google linking/signup. Shared
`requireSession`, middleware, `withErrorHandler` and
[`deploymentServiceRoute`](../../../lib/deployments/service-route.ts) check identity/ownership or
wrap errors/work admission, but do not provide a general application-Origin/CSRF gate. Examples:
flow creation reads `req.json()` after requireSession; revoke-all POST accepts no body; transcription
accepts multipart form data. A client's `Content-Type: application/json` is not a server requirement
and `Request.json()` can parse valid JSON sent as `text/plain`. CORS protects reading responses and
preflighted fetches, not all form-compatible mutations. No exploit frequency or current
cross-wallet vulnerability is established by this source inventory.

Before cookies can ride cross-site requests, protect every cookie-authenticated mutation with an
explicit exact **Paiflow application Origin** check and/or validated anti-CSRF token. The valid
iframe fetch Origin is Paiflow, not Lantern; never add the parent origin to an application-write
allowlist. Reject opaque `null`, unrelated origins and missing-origin browser writes according to
an explicit policy; use configured canonical/approved app origins, not arbitrary Host headers.
Validate expected body types/limits as a supplementary control. Include login/signup, session
management, passkey enrollment, uploads/transcription, account/admin/flow mutations and deployment
prepare/submit/management. Preserve owner/admin/SANDBOX guards after CSRF validation.

Machine paths stay separate: `/api/v1` deployment bearer tokens, cron secrets, webhook secrets and
developer API tokens must retain their explicit token authorization and intended request formats.
`requireDevAuth` permits a cookie-session fallback; that branch needs the same browser-write gate.
Public signed trigger/Subscription routes retain existing signature, intent and rate limits; do not
make them private or add permissive CORS to compensate for frame auth.

Auth.js HTTP credentials/signin/signout/session-update actions have their own double-submit checks.
Its client fetches `/csrf` before posting; adapting only the session cookie leaves the CSRF cookie
blocked in a cross-site frame. Server `signIn`/`signOut` helpers use framework `skipCSRFCheck` because
they are internal helpers; a Paiflow route calling them must itself be protected. Do not globally
disable Auth.js CSRF checks. [Auth.js configuration reference](https://authjs.dev/reference/core).

## Google login, linking, signup and return navigation

Google availability and registration are independently gated. Existing code uses OIDC PKCE/state/
nonce, validated Google subject/email, no automatic matching-email linking, no persisted provider
tokens, single-use hashed database link/signup intents, recent authentication and sessionVersion.
Preserve all of them. Canonical AUTH_URL rewrites in the nextauth route address Railway host
rewrites; `trustHost: true` is not a public-host allowlist or a license to derive targets from
arbitrary headers. Verify deployment proxy trust and exact canonical callbacks without changing
proxy/security behavior in this assessment.

[`GoogleButton`](../../../components/auth/google-button.tsx) uses `window.location.assign` for
canonical-host changes then client `signIn("google")`; this redirects the current browsing context,
not a completed external-browser authentication/return protocol. Current login/error/account
redirect destinations remain frame-denied. [Google's OAuth policies](https://developers.google.com/identity/protocols/oauth2/policies)
prohibit directing authorization into developer-controlled embedded user agents; Android WebView
must use a supported external browser flow. Extension provider navigation must also be verified
against framing/sandbox restrictions, not assumed to work.

A popup can lose access to state/PKCE/nonce/link/signup cookies created under the Lantern partition;
a first-party callback may mint a session unavailable back in that partition. `allow-popups` alone
does not establish escape, opener communication or Android external-browser return; current
`Cross-Origin-Opener-Policy: same-origin` is another return-channel consideration. Partitioned
cookies do not solve that transfer. Keep embedded Google/link/signup unavailable pending a separate
design. If later using an exchange, bind a short-lived single-use server grant to the initiating
browser transaction and intended user/return target, protect completion against CSRF/replay/account
switching, and never pass session JWTs/provider tokens in URLs or bridge messages. That requires
its own review rather than an improvised query flag. Ordinary Google use stays unchanged; see
[existing Google requirements](../../google-sign-in.md).

## Passkeys, voice and authenticated signing inventory

| Surface                                     | Existing behavior                                                                                                                | Embedded prerequisite / proposed initial limit                                                                           |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Passkey login                               | `components/auth/passkey-login.tsx` calls options/verify routes then exchanges ticket with Auth.js Credentials                   | Browser feature delegation and verifier top-origin handling; defer until verified                                        |
| Passkey enrollment/deletion                 | Account `passkeys.tsx`; requireSession, user-scoped registration challenge and DB credential ownership                           | Parent delegation/activation, current session, application write protections; defer enrollment until verified            |
| Password recovery / invalidation            | New-password, change-password, admin changes and revoke-all bump sessionVersion; stale-session route clears invalid cookies only | Test both contexts/partitions, stale redirects, chunk deletion and current DB checks; retain Google-only recovery limits |
| Voice builder input                         | `raft-log.tsx`: getUserMedia audio, MediaRecorder, multipart `/api/transcribe` under requireSession                              | Parent microphone delegation, OS/runtime permission, compatible recording and consent; defer, text input stays available |
| Deploy review                               | `deploy-review.tsx` initializes its own Freighter wallet kit and uses prepare/submit, not shared getWalletKit                    | Separate owned Lantern attempt integration; test envelopes, cancellation, submit/reconcile and source identity           |
| Contract management                         | `contract-call-button.tsx` uses shared getWalletKit, callbacks prepare/submit and poll status                                    | Shared kit currently rejects authenticated Lantern calls; enable only supported reviewed action set                      |
| Payroll recipients                          | `payroll/employee-manager.tsx`: getWalletKit(testnet), unsigned update then submit-invoke                                        | Preserve owner/dev authorization and network/signer validation; separate supported-action evidence                       |
| Payroll allowance and owner trigger/actions | `allowance` Payroll needs session; trigger-button denies authenticated Lantern paths; dashboard calls use protected APIs         | Keep denied until session, action ownership, cancellation and reconciliation are verified                                |

The shared contract-button consumers are `deployment-view.tsx` (Subscription charge/subscribe/
unsubscribe and Streamer unpause/pause/retrieve-unvested), `payroll-panel.tsx` (Payroll allowance,
charge/run bookkeeping, subscribe/unsubscribe) and `subscription-relayer-panel.tsx` (Subscription
relayer authorization). Trace each preparation/submit callback separately; adapting the shared
button does not certify all operations. Retirement/release panels and other relayer-backed
management writes also need session/CSRF review even when they do not prompt a user wallet.

[`rp()`](../../../lib/passkey/rp.ts) uses the configured Paiflow RP ID and AUTH_ORIGINS (or AUTH_URL)
for **ceremony origin**; do not replace those with Lantern's origin. Installed SimpleWebAuthn 14.0.1
authentication verifier additionally requires `expectedTopOrigin` for `crossOrigin: true` responses
that include `topOrigin`. Paiflow's login verifier currently omits it; its registration verifier in
this installed version has no equivalent argument check. Decide server validation for cross-origin
ceremonies and legacy absent-topOrigin responses; retain challenge, RP, origin, counter and user
verification checks. [`Cross-origin guidance`](https://simplewebauthn.dev/docs/advanced/server/cross-origin-support).

The [WebAuthn specification](https://www.w3.org/TR/webauthn-3/) requires appropriate Permissions Policy
for cross-origin authentication/enrollment, with transient activation for cross-origin creation.
Paiflow's `microphone=(self)` and `publickey-credentials-*= (self)` policies in
[`next.config.ts`](../../../next.config.ts) constrain its document but cannot grant permissions denied
by the ancestor/container. Coordinate exact delegated features with Lantern, not wildcard
permissions. Android native WebView credential/OS integrations still require device evidence.

Voice additionally needs effective microphone policy and device permission;
[Media Capture specification](https://www.w3.org/TR/mediacapture-streams/) covers that browser gate.
Do not broaden camera, geolocation or payment permissions. Do not assume `navigator.permissions`
or a successful page load establishes recording support.

## Alternatives and implementation sequencing

| Approach                                 | Benefit                                                                                 | Cost / decision                                                                                                                                            |
| ---------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Global existing-session None/Partitioned | Small configuration diff                                                                | Alters standalone session partition semantics and every issuance/cleanup path; still leaves CSRF/OAuth cookies; not recommended                            |
| Global unpartitioned None                | Potentially shares browser login where third-party cookies are allowed                  | Broadens cross-site cookie exposure and depends on policy/browser exceptions; unsuitable default                                                           |
| Distinct embedded Auth.js config         | Retains Paiflow identity/security callbacks and separates first-party session namespace | Additional auth endpoint/basePath/client configuration and deterministic server session readers; recommended prototype, not yet approved production design |
| Custom Centient-style session auth       | Direct control over cookies                                                             | Parallel authentication, middleware, invalidation/recovery and identity semantics; unnecessary replacement risk                                            |
| Continue browser-only authenticated use  | No unverified session change                                                            | No authenticated Lantern signing; safe fallback until the prototype and QA pass                                                                            |

For separate Auth.js configuration, implement one shared configuration factory with Edge-compatible
session parameters and full Node callbacks; do not duplicate account policy. Choose a fixed embedded
auth endpoint/basePath and corresponding client provider so write/refresh/CSRF/callback/signout use
the same namespace. Define server `auth()`/requireSession and middleware readers for both names,
including a deterministic ambiguity policy when both identities exist. Reject conflicting identities
rather than silently picking whichever cookie appears first; a selector flag cannot authenticate.
Existing top-level entry routes and legacy readers must retain coherent behavior. Device evidence
must confirm whether each platform exposes one or both namespaces. Do not scatter option choices
based on attacker-controlled parent hints across issuance and cleanup.

Sequence focused reviewed PRs: (1) authenticated-write protections and negative route tests;
(2) session configuration prototype with namespace/chunk/refresh/logout/middleware consistency
tests, no authenticated framing enablement; (3) approved auth entry/redirect framing plan and
limited credential-flow UI on a controlled candidate; (4) supported authenticated wallet actions
with existing server checks and durable uncertainty protection; (5) separate passkey, microphone
and external Google-return work if agreed. These are future implementation touchpoints, not work
authorized or performed by this documentation change.

Full-app framing must cover intentional login/dashboard/builder/account/error/stale-session
destinations and redirects without exposing admin/other routes by accident. Existing root `/` is
frame-denied, so directory entry readiness is already tracked in the QA runbook. Frame and session
changes need a reviewed route list, CSP/X-Frame-Options agreement and exact parent origins.

## Required evidence before enablement

Use [the rollout runbook](./public-testnet-runbook.md) and [evidence template](./evidence-template.md)
for canonical host, candidate commit, APK/extension/browser versions and redacted observations.
This assessment ran source and documentation checks only; every test below is **pending**.

1. On Android and extension independently, record actual session/CSRF cookie attributes and
   partition keys; credential login, reload, app close/reopen, expiry and rolling refresh; no
   unexpected top-level session changes. Cover third-party-blocked/default/allowed settings and
   privacy modes explicitly; unsupported settings must fail safely with guidance.
2. Test chunked/unfragmented transitions, both namespaces present (including different accounts),
   signOut in each context, revoke-all, password recovery/change, role changes/deactivation and
   stale-session redirects. Version bumps must end both contexts even when a cookie cannot be
   cleared from the current partition. Decide whether ordinary logout ends only the current
   context or all contexts; do not claim a partition's deletion clears other partitions.
3. For every session-accepting write in the inventory, test valid Paiflow Origin plus absent/wrong/
   opaque Origin, missing/wrong CSRF where applicable, `text/plain` JSON, urlencoded and multipart
   form-compatible attacks and preflighted requests. Include authenticated app B and opaque app B
   inside the **same Lantern parent**, unrelated top-level sites, aliases and untrusted extensions.
   Assert no DB/chain side effect, not merely an unreadable response. Machine token and public
   signed-payment regressions must retain their intended behavior.
4. Keep Google deferred unless supported external authorization and return succeeds with correct
   canonical callback/state/PKCE/nonce and invitation/link identity, cancellation/replay/account
   switch protection, opener/COOP handling and no leaked session/provider tokens.
5. For any enabled passkey path, test get/create delegation, click activation, RP/origin/topOrigin,
   user verification, challenge/ticket consumption, permission refusal and unrecognized parent;
   record Android native/WebView support. Current challenge storage uses Redis get then del and a
   300-second TTL (some route comments describe shorter/atomic behavior); before expanding support,
   verify concurrent consumption/expiry and document actual guarantees. This observation is not
   evidence of an exploited vulnerability and does not authorize a passkey rewrite here.
6. For any enabled voice flow, test initial grant/deny/revoke, recording format, transcription
   authorization, cancellation and text fallback on both platforms without granting other features.
7. For each enabled wallet action, assert Paiflow session/owner/role checks independently of wallet
   connection, correct testnet/account source/envelope, rejection/scope change/unmount, single
   submission and hash-based recovery. Standalone Freighter/WalletConnect must remain functional.

No installed-build login, live OAuth, passkey, microphone, transaction or exploit probe was performed.
Known handoff/build/deployment/device gates remain pending under #933 and Paiflow handoff #945;
they do not prevent this assessment but prevent authenticated support claims.
