# Google sign-in and registration

Google is an alternative to username/password authentication. New Google accounts receive the
existing `USER` role and `EXTERNAL` analytics audience, with ordinary user access. Audience never
changes permissions. Existing accounts keep their ID, role, audience, email and resources when
linking Google. No matching-email automatic account linking is allowed.

## Configuration

Create a Google Cloud OAuth client of type **Web application**. Configure the consent screen for
an external audience if participants use personal Google accounts. A consent screen in Testing
only admits its listed test users; publish it to the intended audience before opening signup.
Google's “external” consent audience is independent of Paiflow's analytics classification.

Set these server settings through the normal environment configuration:

- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`: the Web application's credentials.
- `AUTH_URL`: the canonical public origin, with HTTPS outside localhost. All Google callbacks and
  Auth.js redirects use this configured origin, including behind Railway's rewritten Host header.
- `GOOGLE_AUTH_ENABLED=true`: offer and accept Google sign-in and account linking.
- `ALLOW_GOOGLE_REGISTRATION=true`: permit creation of new Google accounts. Leaving this false
  permits previously linked accounts to sign in and existing password accounts to link Google.
- `ALLOW_PUBLIC_REGISTRATION`: independently controls existing username/password registration.
  Leave this false for a Google-only public opening.

Availability and registration default to false. Enabling Google without credentials fails
configuration validation. Enabling Google registration while Google is unavailable also fails.
Closing registration is enforced in the callback's database transaction, not only in the UI.
Validated Google callbacks are capped at 20 attempts per identity per ten minutes; account linking
initialization is capped at five per user per ten minutes. Google signup does not share the
password-registration IP bucket. Invitation validation uses ten attempts per browser and a
600-attempt backstop per IP per ten minutes, sized for shared event Wi-Fi.
Counters use the existing Redis limiter, with its usual per-process fallback when Redis is absent.

Register each exact redirect URI used by an environment in the Google Web client:

- Local: `http://localhost:3000/api/auth/callback/google`.
- Hosted: append `/api/auth/callback/google` to the exact configured `AUTH_URL` origin, for example
  `https://pinkraft-prod.up.railway.app/api/auth/callback/google` if that is the service's AUTH_URL.

Do not use wildcard callback URLs. If the service has several domains, use the canonical AUTH_URL
for Google login and linking; Google buttons first move visitors on aliases to that canonical
host so state cookies reach the callback. Linking initialization checks its exact Origin. Configure
`NEXT_PUBLIC_APP_URL` consistently. Changing canonical hosts requires the matching consent/client
configuration and a hosted redirect test. Existing passkey origin settings are independent.

The only requested scopes are `openid email`, with online access; no other Google APIs or offline
refresh access are needed. Auth.js validates OIDC issuer, response, state, PKCE and nonce. Persist
only the `google` provider and validated Google `sub`; never persist/log provider tokens or codes.
Refer to [Auth.js Google configuration](https://authjs.dev/getting-started/providers/google) and
[Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect).

## Invited Google signup

Apply migration `20261011120000_google_signup_codes` through `pnpm db:migrate:deploy` before
running this release. It adds invitation codes and browser signup intents; it does not enable
Google availability or registration.

Admins open **Admin → Google signup codes** (`/admin/google-signup-codes`) to create a code with
an event label and an expiry of **1, 7 or 30 days**. Expiry starts at creation, using elapsed 24-hour
days. Copy the generated code immediately: it is shown once, stored only as a hash, and cannot
be retrieved later. The admin list shows labels, expiry times and status in pages of 100 codes,
newest first. Use **Previous** and **Next** to reach older codes. **Disable**
immediately prevents that code from authorizing new or unfinished signups. It cannot be re-enabled;
create a replacement code instead. Creation and disable actions record IDs in the audit log,
never raw codes.

Participants use **Create account → Continue with Google → Enter code**. Validating an active
code automatically starts Google OAuth. A code is reusable by multiple participants until its
expiry or disable time. Each validation creates a separate, single-use browser grant valid for
at most ten minutes (and never beyond code expiry), carried in a protected HttpOnly cookie.
Auth.js still checks state, PKCE and nonce. The server rechecks the invitation in the account
creation transaction and consumes only that browser grant. OAuth cancellation clears the browser
cookie; retry starts with another code validation. Expired intents are pruned during validation.

Existing linked Google users sign in normally without a code, including while Google registration
is closed. The official light **Continue with Google** button appears beside password **Sign in**.
New identities entering through **Sign in** are directed to **Complete your signup** (`/auth/signup`),
with the access-code field immediately available and safe return navigation preserved. Validating
the code starts a fresh Google OAuth flow to finish account creation. Invalid, expired or disabled
codes show inline feedback. Older `signup-code-required` error links redirect to this screen.
New identities cannot create accounts without a valid browser grant. Codes do not override closed registration,
link accounts by email, change roles, or affect username/password registration.

## Linking and recovery

Sign in to an existing Paiflow account, then use **Account → Link Google** within five minutes.
The authentication timestamp is fixed at actual sign-in, not renewed by a rolling JWT refresh.
For an older session, explicitly sign out via the menu and sign in again before returning to
Account. A passkey sign-in also supplies recent authentication. Sandbox accounts cannot link.

Linking requires both a current session and a short-lived, hashed, single-use database intent.
The callback rechecks the account's activity, role and sessionVersion. Logging out, switching
accounts, revoking sessions or replaying the intent cannot transfer identity ownership. Only one
Google identity can be attached to a Paiflow user. Existing account email is preserved; a Google
email already owned by another Paiflow user requires resolving the conflict with that account.

Google-only users have no local password. Use Google's account recovery; local password change,
email reset and admin password reset cannot add a password. Password recovery for existing
password accounts continues unchanged. Passkeys can be added to either kind of account.
Unlinking and local-password enrollment are outside this release. Google login does not recover
a Stellar wallet.

## Hosted smoke test before public enablement

Apply the migration and deploy the code through the regular reviewed process. Use a testnet
service and a Google account permitted by its consent screen. This document does not authorize
changing live settings.

1. Enable Google availability with Google registration closed and password registration closed.
   Confirm Google is offered at login, no password-registration form is offered, and an unlinked
   identity cannot create an account (including calling the callback directly).
2. Temporarily enable Google registration on the controlled testnet service. From a fresh browser,
   create an invitation in Admin, open Create account, and enter its code to register with Google. Confirm the browser's outbound `redirect_uri` is the exact HTTPS public
   callback, not a Railway container origin. Confirm the callback returns to the public app and
   sets its normal protected session cookie.
3. Confirm one Paiflow user/identity exists with `USER`, `EXTERNAL`, no password, a valid unique
   username and registration/login audit rows. Verify the first authenticated analytics context
   is external and `login_succeeded.method` is `google`. Create a flow to check ordinary access.
4. Sign out, sign in with Google again, and confirm the same account, flow and audience. Close
   Google registration and repeat login; a different Google identity must now be refused.
5. Using an existing password account, explicitly link a different Google account with recent
   authentication. Confirm ID, role, audience, original email and resources are unchanged. Sign
   out and sign in via Google; then repeat password and passkey login.
6. Try stale linking, cancellation, wrong Google identity, matching-email conflict, callback replay
   and an external `redirectTo` value. Confirm fixed actionable messages, no partial account or
   identity changes, and return navigation remains on the configured origin. Browser back/retry
   must start a fresh OAuth flow. Do not copy codes/tokens into logs or tickets.
7. Deactivate a linked account and confirm Google login is refused. Revoke its sessions and confirm
   old cookies/unfinished link grants cannot retain access. Check passkeys for a Google-only user.
8. Confirm Google-only Account settings describe Google recovery, admin reset controls are hidden,
   and direct password change/reset/admin-reset requests cannot enroll a password. Existing
   password reset still works. Verify no provider codes/tokens appear in application error logs.

OAuth provider interaction and Railway redirects require this real hosted check; local unit and
scratch-database tests cannot certify a configured Google client or consent-screen rollout.
