API reference based on pinkraft `hackathon` @ 18b89d56625ef562ea9b0458f6ccc6d19f0f6efe. Participant rules and starter mode instructions updated Oct 5, 2026. Testnet only.

# Hackathon preparation rules

- Ideation may start now: choose a problem, research users and sketch the app.
- Registration closes October 11, 2026, at 12:59 PM. A maximum of 10 teams of 1–4 students can participate. Solo teams are welcome; at least two members are encouraged. If more than 10 teams apply, we will coordinate with the respective student organisation to determine the best way forward.
- Online onboarding is October 12, 2026, at 9:00 PM. The meeting link will be provided through blockhub.academy or through the student organisation representatives.
- After October 12 onboarding, teams may build their app's screens and features that don't involve payments, using the supplied starter. Keep its payment features and live feed disabled until October 14.
- Flow deployment, connecting the app to Paiflow APIs and live payment testing must wait until October 14. Paiflow account credentials are handed out on October 14.
- Wallet preparation is allowed beforehand: select testnet, add the exact USDC trustline and obtain testnet XLM and USDC where possible. On-site support and ready-to-use fallback wallets are available on October 14.

The supplied starter defaults to preparation mode when `PAIFLOW_MODE` is unset. Run `pnpm install` and `pnpm dev`, then open http://localhost:3000 to build non-payment screens. You can also copy `.env.example` to `.env.local` and keep server-only `PAIFLOW_MODE=prepare`. This disables wallet actions, payments and event polling; the starter makes no upstream Paiflow requests or demo-token requests. Direct payment, payout and event routes return HTTP 403 `PREPARATION_MODE`.

On October 14, set server-only `PAIFLOW_MODE=team` alongside the supplied platform origin, your confirmed deployment UUID and API token, then restart. Explicit `PAIFLOW_MODE=demo` enables the shared testnet demo. An empty token never selects demo automatically; missing or invalid team configuration disables integration with a clear error. Keep the starter's mode guards when replacing its screens or extending its server client. A pending signed payment may still execute after a mode change; confirm its status before switching modes.

`PAIFLOW_MODE` applies to the starter. Campus Snacks uses its own deployment/token readiness checks and does not use the starter's demo fallback.

# Submission and demo

- Submit through the [submission form](https://forms.gle/qRk75H9u5eCxPJ3z7) by **5:00 elapsed time** on the integration-day schedule, at the end of integration part 2. Submission fields are in the form.
- Qualification requires a confirmed Paiflow deployment and at least one on-chain payout from the team's deployment. Shared-demo payouts do not qualify.
- Judging totals 100 points: Creativity 30, Integration 40, Real-world usefulness 30. Under **Works end to end (10 points)**, a live demo can earn up to **10 points**; a recorded demo can earn up to **7 points**. The format affects only that criterion; other criteria keep the same maximum points. Either must show the team's actual app, Paiflow deployment and a verifiable payout.
- Each team gets **5 minutes: 3 for a pitch and demo, then 2 for judges' Q&A**. Pitch and demo the app's payment flow live or in a screen recording, and show the payout in the live feed, recipient balance or explorer transaction. A recording may be used if the live demo fails; if it provides the successful demonstration, the recorded-demo maximum applies.
- Respect shared infrastructure: no load testing or spamming the Paiflow API or relayer. Rate limits apply. Organisers decide disputes.

Use these participant-facing rules when helping a team prepare its app and pitch. Do not add event requirements or benefits that the participant guide does not publish.

# 1. What Paiflow is

Paiflow is the money logic behind your app: a visual canvas where you connect a trigger to payment actions and conditions, then deploy the graph as connected Stellar Soroban smart contracts in one transaction. Your app supplies the customer experience; the deployed flow receives, routes, holds and pays the money according to the rules you designed.

Use the team's Paiflow account to build and review a flow, connect the team's wallet, sign deployment, and wait for `CONFIRMED`. Then create a deployment token in **API access** on its deployment page. Your app can prepare customer payments, submit wallet-signed transactions and read events through `/api/v1`, or send customers to Paiflow's hosted payment and allowance pages. These APIs drive an existing deployment; they do not create flows or deploy copies.

Paiflow is **non-custodial**: it does not hold customers' private keys. Customers authorise their payments in their wallets. Funds held by a condition are on-chain, subject to the condition's release rules and authorised releasers. The event is **testnet only**; balances have no real-money value.

- The team designs a flow on the canvas and deploys it from the team's Paiflow account.
- The team's app drives that **one deployment** through `/api/v1`, using a `pfk_` token kept server-side.
- **One deployment serves one business or group. There are no per-user copies at the event.** A subscription also has one configured subscriber, rather than a separate subscription for each app user. Mention per-user deployments in your pitch as a future path to real users, not as a feature your demo already has.

# 2. Blocks

## Graph, assets and amounts

The following is the complete event palette. A graph contains `nodes`, `edges`, optional `devMode`, optional `notify`, and optional `positions` (node-id keys with numeric `x` and `y`). Each node has a unique nonempty `id`, `type`, and `config`. Each edge has nonempty `id`, `source`, `target`, and optionally `sourceHandle: "true" | "false"` for a condition output. A missing condition handle means True. The graph accepts at most 40 nodes and 80 edges.

Use exactly one trigger, with no incoming edges, and at least one action. Every node must be reachable from the trigger. No cycles or dangling edges. Keep the asset consistent along a path; Swap changes the downstream asset. A graph that saves as a draft is not necessarily deployable: deploy validation checks addresses, amounts, connectivity and contract support again.

Asset fields take one of these shapes:

```json
{"kind":"native"}
{"kind":"known","symbol":"USDC"}
{"kind":"custom","code":"TOKEN","issuer":"<real G-address>"}
```

Native means XLM. Custom codes are normalised to 1–12 alphanumeric characters and require a valid issuer account. Swap only supports XLM and USDC. Use real testnet `G…` public account addresses for recipients and signers. `PENDING:<label>` is a design-time placeholder, not a payable address; resolve it before deploying unless that value is deliberately deferred in Dev mode. Never paste an `S…` secret seed into a flow field.

**Money is a decimal integer string in stroops**, never a JavaScript floating-point number: 1 token = 10,000,000 stroops; 10 USDC = `"100000000"`; 0.5 USDC = `"5000000"`. Use `bigint` for arithmetic and `.toString()` for API bodies. Basis points (`bps`) are integers: 1% = 100 bps; 100% = 10,000 bps. ISO date-time fields include a timezone, for example `2026-10-09T06:00:00Z` (choose a future time for your actual demo).

## On Receive — `on_receive`

Fields: `asset`; optional `minAmountStroops` (integer string).

A customer deposits the input asset into the flow's deposit trigger, which forwards it into the pipeline. Use this for checkout, tips, splits, escrow and pooling. The optional minimum is passed to downstream Split contracts as a floor; the deposit trigger itself checks only that the amount is positive. Do not rely on that field as a general Pay or escrow minimum. Use `execute` prepare → wallet signing → submit, or the hosted trigger page. Sending a plain token transfer to a contract is not a substitute for invoking its deposit function.

## On Schedule — `on_schedule`

Fields: `intervalAmount` (positive integer, default 1), `intervalUnit` (`minute`, `hour`, `day`, `week`, `month`), `startsAt` (ISO date-time); optional `endsAt`, `occurrences` (positive integer), `timeZone`, `pauseAllowed`, `retrieveAllowed`.

Push payments from a funded stream to Pay or Split recipients at recurring intervals. Pre-fund the stream using the hosted trigger page; `execute` does not start it. `endsAt` takes precedence over `occurrences`; without either, deployment uses a 30-day window. End must be after start; a start already in the past is moved to deployment time. A month is 30 days. Pause defaults to allowed, retrieval of unvested funds defaults to disallowed; retrieval requires pausing first.

For Pay, set a positive fixed `amountStroops` per interval. For a percentage Split, set a positive `amountPerIntervalStroops`; for a fixed Split the interval amount is derived from the recipients' total. Scheduled fixed shares become proportional shares of vested funds, with rounding assigned to the last recipient. Use a simple Schedule → Pay or Split graph; amount and time branching conditions cannot be compiled under this trigger.

## HTTP Webhook — `web2_webhook`

Fields: `asset`.

A server-side authenticated HTTP callback makes the relayer invoke an already funded flow. The deployment UI provides its trigger URL and webhook secret; keep the secret on your server. Depositing funds tops up this flow and does not fire the callback. It can drive Pay, Split or Swap; its supported condition kind is multisig. This is not an `execute` flow: the v1 deposit API refuses a webhook-headed deployment. For the simplest payment integration use On Receive instead.

After your server verifies the completed goal, release from the funded pool with `x-webhook-secret` and a JSON body containing `escrow: true`. `amount` is a stroop string; omit it or use `"0"` to release the entire available balance. For one reward at a time, specify its amount:

```bash
# Run on your app server; keep PAIFLOW_WEBHOOK_SECRET server-side.
curl -sS --fail-with-body -X POST "$PAIFLOW/api/webhooks/$DEPLOYMENT_ID" \
  -H "x-webhook-secret: $PAIFLOW_WEBHOOK_SECRET" \
  -H 'Content-Type: application/json' \
  --data '{"escrow":true,"amount":"100000000"}'
```

This releases 10 tokens from the pool. Check the response and transaction status before marking the reward paid; the callback can return `PENDING`.

## Subscription — `subscription`

Fields: `asset`, `subscriber` (account address), `amountPerPeriodStroops` (integer string), `intervalAmount` (positive integer, default 1), `intervalUnit` (same five units, default `day`); optional `endsAt`, `occurrences`.

Pull payments from the configured subscriber after they approve an allowance. The relayer charges when due, without the subscriber signing every charge, until the window ends or allowance/balance is exhausted. Starts at deployment time; end/count/default window follow the rules above. The non-deferred amount must be greater than zero. If the next Split has all fixed recipients, its total determines the pull amount instead of a stale manual period amount. Use the allowance page; `execute` cannot start a subscription. Use Pay or Split downstream; amount and time branching conditions are refused under this trigger.

Dev mode can defer/change the subscriber and payment values through **Dev values** on the deployment page. An allowance still needs the customer's wallet signature. Do not claim that connecting any new wallet automatically creates a new subscriber in this one deployment.

## Pay — `pay`

Fields: `recipient`, `asset`; optional `email` (up to 254 characters), `mode` (`fixed` or `percentage`), `amountStroops`, `percentage` (0–100), `fullAmount` (default false), `fillValueViaApi`, `payoutMode` (use `crypto`).

Pay one recipient. Unless full amount or deferred value is selected, choose a mode: a fixed amount must be positive; a percentage must be greater than zero and at most 100. `fullAmount: true` pays 100% of what arrives. Fixed Pay sends the smaller of incoming amount and its configured cap; any surplus goes to its next step. With no next step, surplus stays in the Pay contract: avoid overfunding a terminal fixed Pay. For variable checkout prices, full amount is simpler.

`fillValueViaApi` is only allowed with graph `devMode: true`. That mutable Pay can deploy before its recipient/value is filled. Set these in **Dev values**, or use `payouts` for a per-payment recipient; do not call `execute` against an unconfigured Pay. A deferred-value payout configures that Pay to 100%.

## Split — `split`

Fields: `asset`, `recipients` (up to 20), optional `amountPerIntervalStroops`. Each recipient has `address`, `mode`, optional `label` (up to 64 characters), optional `email` (up to 254 characters), optional `payoutMode` (use `crypto`), and either `bps` for percentage or `amountStroops` for fixed. The schema also accepts legacy `ratePerSecondStroops`; new schedules use the interval amount.

- All recipients use the same mode. Never mix percentage and fixed rows.
- Percentage shares must each be greater than zero and sum to exactly 10,000 bps. For three equal shares use 3333, 3333, 3334. Rounding remainder goes to the last recipient.
- Fixed amounts must each be positive, with a positive total. Short deposits accumulate; the roster is paid when enough funds are held. Surplus is forwarded to a next step if one exists.
- No duplicate recipient addresses. A non-Dev flow needs at least one recipient. Dev mode may deploy an empty roster, but fill it in **Dev values** before payments.
- A scheduled percentage Split needs a positive `amountPerIntervalStroops`; a fixed scheduled Split derives the amount from its roster.

Use Split for fan-out rather than drawing several outgoing money paths and expecting automatic division. A percentage Split consumes the deposit; it does not leave money for a subsequent per-payment Pay.

## Swap — `swap`

Fields: `assetIn`, `assetOut`, `slippageBps` (default 100), `deadlineSecs` (integer 1–86,400; default 300).

Exchanges XLM for USDC or USDC for XLM through Soroswap. Input and output must differ; input must match what flows into it. Slippage must be at least 30 bps (0.3%, the pool fee) and at most 10,000 bps. Price impact can require a larger bound. The deadline is seconds from execution ledger time, not from graph creation. A failed swap reverts the payment. Exactly one outgoing money edge is required: the entire output goes to that next step, normally Pay or Split. No custom assets. Do not put it under a Schedule trigger.

## Condition — `condition`

The `config.kind` determines fields and behavior:

| Kind          | Fields                                                             | Rule                                                                              |
| ------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `amount_gt`   | `amountStroops`                                                    | True for strictly greater incoming amount; equality goes False.                   |
| `amount_lt`   | `amountStroops`                                                    | True for strictly smaller incoming amount; equality goes False.                   |
| `time_before` | `at`, optional `timeZone`                                          | Holds funds; a release strictly before `at` chooses True, at/after chooses False. |
| `time_after`  | `at`, optional `timeZone`                                          | Holds funds; a release at/after `at` chooses True, strictly before chooses False. |
| `multisig`    | `signers` (1–20 account addresses), `threshold` (positive integer) | Approval gate; threshold cannot exceed signer count. Has only True output.        |

Amount and time conditions need **both True and False connected, each to exactly one step**. A direct branch target cannot itself be another condition. A step downstream of a branch cannot have multiple different parents. Both outputs may point to the same step. Use On Receive for these branching flows; they are refused under Schedule and Subscription, and HTTP Webhook supports only multisig.

A time condition does not immediately pay its before side when a deposit arrives. It holds funds until release. Before the deadline, the deploying wallet can release, or the app can authorise the relayer using `release-early`. The app must decide who can request this; possession of the deployment token authorises it. At/after the deadline, automatic release takes the after side. The deadline belongs to the after side; a request for the wrong side is refused rather than redirected. Multiple customers' deposits share this condition's balance and deadline.

Multisig requires signer approvals and release through its contract/UI workflow; a v1 token is not a substitute for these approvals. There is no multisig-approval endpoint in v1.

## Hold — `hold`

Fields: none (`config: {}`). A terminal marker directly on the **before side of a time condition**. Exactly one incoming condition edge and no outgoing edges. It turns that time condition into a strict lock: no wallet or relayer early release. At/after the deadline, the full balance follows the after destination. Hold is part of the time condition, not a separate payable contract. It cannot be placed directly after a trigger.

## Return to owner — `return_to_owner`

Fields: none (`config: {}`). A terminal destination directly after an amount, time or multisig condition, with exactly one incoming edge and no outgoing edges. Pays the full incoming amount to the **wallet that signed deployment**, resolved when deploying and immutable even in Dev mode. It does **not** return each customer's contribution to its original wallet. For a customer refund, configure a Pay recipient explicitly instead.

## Notification settings

Email is a flow setting, not a block: optional `notify: { mode, sendTo }`, with `mode` one of `off`, `every_transaction`, `shortfalls_only`. Owners receive generated transaction summaries; optional Pay/Split recipient emails receive their own payout notices. Addresses stay private. New flows default to transaction notifications; older graphs without this setting stay off. Notification settings do not create another on-chain step.

# 3. Hosted pages

Use `https://beta.app.paiflow.xyz` as the Paiflow testnet origin for every URL below. `deploymentId` is the deployment UUID, not a flow id or `C…` contract address. These pages require a confirmed deployment with the appropriate contract type; an unavailable page returns 404.

| Page      | URL shape                           | What the team's app uses it for                                                                                                                                                                                                                                                                             |
| --------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trigger   | `/trigger/[deploymentId]`           | Public payment/top-up page with amount entry and wallet signing. On Receive deposits run the flow; Schedule and HTTP Webhook deposits fund it. A fixed flow can lock its required amount; variable flows accept an `?amount=10` hint in tokens, not stroops. The flow's required amount overrides the hint. |
| Embed     | `/deployments/[deploymentId]/embed` | Public view of the deployed graph and live events, with payment QR where supported. Link to it or place it in your app's embedded view; it is not an API response.                                                                                                                                          |
| Allowance | `/allowance/[deploymentId]`         | The subscription customer connects their wallet and approves an asset allowance for the subscription contract. Each approval adds to the existing allowance. It does not deposit or charge immediately.                                                                                                     |

The usual trigger QR opens this hosted page (or the allowance page for a subscription). The customer then connects a testnet wallet and signs there. Separate transaction QR modes encode SEP-7 requests and require a compatible wallet. Your own checkout can use the execute sequence instead.

# 4. The `/api/v1` API

## Authentication and integration boundary

Use `Authorization: Bearer pfk_<64 lowercase hex characters>`. A token is bound to exactly one deployment. Mint it in **API access** on the team's confirmed deployment; it is shown only once. Store it on the app server. Missing, malformed, unknown, expired, revoked or wrong-deployment tokens all return HTTP 401 `UNAUTHENTICATED`, with `A valid API token for this deployment is required`. A malformed deployment UUID is 404. Revocation takes effect on the next call.

**Put all Paiflow calls in one typed, server-only `lib/paiflow.ts` module in the starter repo, and call the API through it.** Use `import "server-only";`, read `PAIFLOW_API_TOKEN` and `PAIFLOW_DEPLOYMENT_ID` from server environment, and expose `prepareExecute`, `submitExecute`, `listEvents`, `preparePayout`, `submitPayout`, `releaseEarly`. Its header should say: `starter code, not a supported package — edit freely.` Follow the shapes below and the public OpenAPI document. Do not invent other v1 methods. Keep the bearer token out of browser bundles, browser requests and logs.

Browser → your app's server → Paiflow is the API path. The server returns unsigned preparation data to the browser. The customer's wallet signs there; the browser sends the signed envelope back to your server, which submits it. No private key crosses that boundary. Protect your own server routes: a browser action must not let an unauthorised caller release escrow or choose a payout recipient merely because your server holds the token.

## Routes, responses and limits

Success uses `{ "data": ... }`; preparation and submission return HTTP 200. Errors use `{ "error": { "code", "message", "fields"?, "details"? } }`. Inspect HTTP status **and** submission `data.status`. Every token-authenticated response has `x-request-id`; retain it for platform-support debugging. Do not log tokens or signed XDR.

| Method and path                               | Limit                                           |
| --------------------------------------------- | ----------------------------------------------- |
| `POST /api/v1/deployments/:id/execute`        | 30 / 60 seconds per token                       |
| `POST /api/v1/deployments/:id/execute/submit` | 30 / 60 seconds per token                       |
| `GET /api/v1/deployments/:id/events`          | 120 / 60 seconds per token                      |
| `POST /api/v1/deployments/:id/payouts`        | 10 / 60 seconds per token                       |
| `POST /api/v1/deployments/:id/payouts/submit` | 30 / 60 seconds per token                       |
| `POST /api/v1/deployments/:id/release-early`  | 10 / 60 seconds per token                       |
| `GET /api/v1/openapi.json` (public, no token) | 60 / 60 seconds per client IP                   |
| `POST /api/v1/demo-token` (public, no token)  | 3 / hour per client IP; 60 / hour instance-wide |

Limits use fixed windows, separately per endpoint. Owner-session token management has a shared 20/minute per-user limit. Working tokens issued or authenticated within 30 days avoid the pre-auth IP backstop. Unseen tokens have 6,000 lookups/minute per address; after 300 authentication failures in ten minutes, only 60 unseen lookups/minute are allowed. Fix a bad token instead of looping on 401.

| HTTP | API error code       | Action                                                        |
| ---- | -------------------- | ------------------------------------------------------------- |
| 401  | `UNAUTHENTICATED`    | Check token and deployment together.                          |
| 402  | `INSUFFICIENT_FUNDS` | Fund the `from` account on testnet.                           |
| 403  | `FORBIDDEN`          | Feature/caller unavailable, including a disabled public demo. |
| 404  | `NOT_FOUND`          | Check UUID and confirmed deployment.                          |
| 409  | `CONFLICT`           | Wait for payout finality/expiry and retry as described below. |
| 422  | `VALIDATION`         | Fix input or the simulated flow; inspect fields and message.  |
| 429  | `RATE_LIMITED`       | Back off using `Retry-After`.                                 |
| 500  | `INTERNAL`           | Keep request id and ask platform support.                     |
| 502  | `UPSTREAM_RPC`       | Retry carefully: submission may already have broadcast.       |

## Execute: prepare → customer's wallet signs → submit

Prepare body: `{ "from": "<customer G-address>", "amount": "100000000" }`. Amount is positive integer stroops of the flow's **input** asset, up to 39 digits; contract arithmetic still must fit i128. `from` must be funded on this network, pay deposit and fee, and sign. All recipients must be able to receive their assets. Preparation simulates the pipeline and refuses a missing prerequisite before the customer signs.

Works for every confirmed flow whose deployed head is a deposit trigger, including On Receive → Pay, Split, Swap or Condition. It does not execute Schedule, Subscription or HTTP Webhook heads.

Preparation data has `xdr` (unsigned base64 envelope), `networkPassphrase`, `network`, `expiresAt`. Require `network === "testnet"` in the event app; show a **TESTNET** chip on every payment screen. Sign using the returned network passphrase, never a wallet's implicit network. Execute has a **180-second validity window**. Submit `{ "signedXdr": "<wallet-signed envelope>" }` before `expiresAt`.

Submit accepts only one deposit invocation on this deployment's trigger, not arbitrary operations or a fee-bump envelope. `?wait=false` returns once accepted; default `wait=true` waits for finality for a bounded period (about 25 seconds, with RPC calls capped at ten seconds). At most three concurrent waiters per token; extra calls still send and answer without waiting.

Submission data has `txHash`, `status: "SUCCESS" | "PENDING" | "FAILED"`, optional `ledger`, and optional `error: { code, message }` for failure. **FAILED can be HTTP 200.** PENDING means not final: resubmit the **same signed envelope** to check again. A submission 502 can also mean it was broadcast already: retry the same envelope or poll its events, rather than preparing a duplicate payment. Retries are idempotent on transaction hash. SUCCESS records its decoded events before returning.

### Copy-paste curl

Run from a trusted terminal, not from a browser. Set the Paiflow testnet origin shown below and your real deployment UUID/token/customer public key. `jq` constructs JSON safely. No secret seed is used in these calls.

```bash
export PAIFLOW='https://beta.app.paiflow.xyz'
export DEPLOYMENT_ID='YOUR-DEPLOYMENT-UUID'
export PAIFLOW_TOKEN='pfk_YOUR_64_LOWERCASE_HEX_CHARACTERS'
export FROM='YOUR_CUSTOMER_PUBLIC_G_ADDRESS'
export RECIPIENT='YOUR_RECIPIENT_PUBLIC_G_ADDRESS'

curl -sS --fail-with-body -X POST "$PAIFLOW/api/v1/deployments/$DEPLOYMENT_ID/execute" \
  -H "Authorization: Bearer $PAIFLOW_TOKEN" -H 'Content-Type: application/json' \
  --data "$(jq -nc --arg from "$FROM" '{from:$from,amount:"100000000"}')" \
  > /tmp/paiflow-prepared.json
jq '.data | {xdr,networkPassphrase,network,expiresAt}' /tmp/paiflow-prepared.json

# Send preparation data to the browser wallet. Copy its signed envelope here.
# Signing is a wallet interaction, not a server-side secret-key script.
read -r -p 'Wallet-signed XDR: ' SIGNED_XDR
curl -sS --fail-with-body -X POST "$PAIFLOW/api/v1/deployments/$DEPLOYMENT_ID/execute/submit" \
  -H "Authorization: Bearer $PAIFLOW_TOKEN" -H 'Content-Type: application/json' \
  --data "$(jq -nc --arg signedXdr "$SIGNED_XDR" '{signedXdr:$signedXdr}')"
```

### Copy-paste TypeScript fetch

The following team-mode request example belongs in a server-only module. When extending the supplied starter, retain its mode guards; all six operations below use this helper. Set `PAIFLOW_BASE_URL=https://beta.app.paiflow.xyz` in your own app's server configuration. The error class retains status and retry information; callers must handle these rather than retrying every error.

```ts
import "server-only";
// starter code, not a supported package — edit freely.

type Prepared = {
  xdr: string;
  networkPassphrase: string;
  network: "testnet" | "mainnet";
  expiresAt: string;
};
type Submitted = {
  txHash: string;
  status: "SUCCESS" | "PENDING" | "FAILED";
  ledger?: number;
  error?: { code: string; message: string };
};
type ApiFailure = {
  code: string;
  message: string;
  fields?: Record<string, string[]>;
  details?: string;
};
export class PaiflowError extends Error {
  constructor(
    readonly status: number,
    readonly api: ApiFailure,
    readonly retryAfter: string | null,
    readonly requestId: string | null,
  ) {
    super(api.message);
  }
}
function config() {
  if (process.env.PAIFLOW_MODE !== "team")
    throw new Error("Select team mode for this team API example");
  const origin = process.env.PAIFLOW_BASE_URL;
  const deploymentId = process.env.PAIFLOW_DEPLOYMENT_ID;
  const token = process.env.PAIFLOW_API_TOKEN;
  if (!origin || !deploymentId || !token) throw new Error("Set Paiflow server configuration");
  return { origin, deploymentId, token };
}
async function call<T>(
  endpoint: string,
  method: "GET" | "POST",
  body?: unknown,
  query?: URLSearchParams,
): Promise<T> {
  const { origin, deploymentId, token } = config();
  const url = new URL(["api", "v1", "deployments", deploymentId, endpoint].join("/"), origin + "/");
  if (query) url.search = query.toString();
  const response = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const requestId = response.headers.get("x-request-id");
  const unexpected = `Unexpected Paiflow HTTP ${response.status}${requestId ? ` (x-request-id: ${requestId})` : ""}`;
  let result: { data: T } | { error: ApiFailure };
  try {
    result = await response.json();
  } catch {
    throw new Error(unexpected);
  }
  if ("error" in result) {
    throw new PaiflowError(
      response.status,
      result.error,
      response.headers.get("Retry-After"),
      requestId,
    );
  }
  if (!response.ok) throw new Error(unexpected);
  return result.data;
}
export const prepareExecute = (input: { from: string; amount: string }) =>
  call<Prepared>("execute", "POST", input);
export const submitExecute = (input: { signedXdr: string }, wait = true) =>
  call<Submitted>("execute/submit", "POST", input, new URLSearchParams({ wait: String(wait) }));
```

In your browser checkout: request preparation from your own server, hand `xdr` and `networkPassphrase` to the wallet's transaction-signing function, then send its returned signed XDR to your own submit handler. Use the wallet adapter already in your starter; signing return shapes depend on that adapter. Do not add the bearer token to either browser call. The server handlers call `prepareExecute` and `submitExecute` above. Keep the same signed envelope while status is uncertain.

## GET events: cursor paging and freshness

Query: optional `cursor` (opaque nonempty string, at most 512 characters), `limit` (1–100, default 50), `txHash` (64 hex characters). Unknown query fields are refused. Returns `{ data: { items, nextCursor, hasMore } }`. Each item has `id`, unique `eventId`, `kind`, nullable `topic`, `ledger`, `txHash`, ISO `occurredAt`, and nullable decoded `data`. These are Paiflow's decoded records, oldest first by `(ledger, eventId)`, not a raw chain feed. Typical kinds include `RECEIVE`, `PAYOUT`, `STATUS_CHANGE`. A swap has `kind: "PAYOUT"`, `topic: "swap"`, with `{ assetIn, assetOut, amountIn, amountOut }`; amounts are stroop strings. Asset labels may be symbols or contract addresses.

Store `nextCursor` and pass it back unchanged. While `hasMore` is true fetch immediately; otherwise wait (10–30 seconds is reasonable) and poll with the same cursor. An empty page echoes the supplied cursor. `nextCursor` is null only when there are no events and you supplied no cursor. Do not send `cursor=` when empty. Persist your cursor and deduplicate UI entries by `eventId`. Use a separate cursor when filtering by `txHash`, rather than overwriting the whole-feed cursor.

**Freshness from OpenAPI:** if collection is older than ten seconds, a read collects first and waits up to five seconds, then answers from the records. With continued polling, events usually appear 10–20 seconds after ledger close, including wallet/QR payments and scheduled charges. Collection is shared across callers of a deployment: one at a time and no sooner than ten seconds after the previous one ends. Polling faster does not improve it. Reads during collection or slow network answer with existing records; newer events arrive on a later call. A background poller also runs every minute. Confirmed execute submit records its own events before returning.

```bash
# First page; for a later page set CURSOR to the prior .data.nextCursor.
CURSOR=''
curl -sS --fail-with-body --get "$PAIFLOW/api/v1/deployments/$DEPLOYMENT_ID/events" \
  -H "Authorization: Bearer $PAIFLOW_TOKEN" --data-urlencode 'limit=50'

# Only run this once CURSOR is nonempty.
curl -sS --fail-with-body --get "$PAIFLOW/api/v1/deployments/$DEPLOYMENT_ID/events" \
  -H "Authorization: Bearer $PAIFLOW_TOKEN" \
  --data-urlencode 'limit=50' --data-urlencode "cursor=$CURSOR"
```

Append to the same server-only module:

```ts
type EventItem = {
  id: string;
  eventId: string;
  kind: string;
  topic: string | null;
  ledger: number;
  txHash: string;
  occurredAt: string;
  data: unknown;
};
type EventPage = { items: EventItem[]; nextCursor: string | null; hasMore: boolean };
export function listEvents(input: { cursor?: string; limit?: number; txHash?: string } = {}) {
  const query = new URLSearchParams();
  if (input.cursor) query.set("cursor", input.cursor);
  if (input.limit !== undefined) query.set("limit", String(input.limit));
  if (input.txHash) query.set("txHash", input.txHash);
  return call<EventPage>("events", "GET", undefined, query);
}

// One page at a time in your server polling handler:
// const page = await listEvents({ cursor: savedCursor ?? undefined });
// savedCursor = page.nextCursor;
// return page; // browser drains hasMore, then waits before asking again
```

## Per-payment payouts

`payouts` prepares a deposit **after configuring one mutable Pay for its recipient**. Requires a confirmed deposit-triggered flow and a Pay block with **Fill value via API** on, in a Dev mode flow. Body is `{ from, amount, recipient, nodeId? }`; `nodeId` is required when multiple deployed mutable Pay nodes exist. `recipient` is a valid account address, amount is positive stroops bounded by i128 (and percentage multiplication range). Account/trustline checks must succeed before recipient mutation. Preparation returns Execute's fields plus `nodeId`; its deposit has a **60-second validity window**, so sign promptly. Submit through `payouts/submit` using the same token and deployment.

Supported routes to that Pay are immediate amount conditions or fixed Split. A fixed Split must have zero token/accumulated balances, positive fixed recipients, one next step, and incoming amount greater than its fixed total; surplus reaches Pay. Percentage Split consumes everything; a shortfall accumulates; neither qualifies. Time holds, Swap and other delayed/unsupported paths are refused. Pay must have no existing pooled balance. Deferred value sets Pay to 100%; otherwise current configuration is preserved: percentage must consume all incoming funds, or incoming must not exceed a fixed cap. These checks concern the amount reaching Pay after upstream payouts.

**One payout at a time per deployment.** A lease keeps the chosen recipient protected during preparation/configuration and until the exact deposit is final or ledger-time expiry is proven. HTTP 409 means retry after `Retry-After` when provided; it is advisory and you may still get 409 because ledger time lags. If no header is present, wait and retry with bounded backoff. If the earlier deposit was submitted, retry that same signed envelope to get its status. PENDING, uncertain RPC results and some send refusals retain protection; do not change recipients or start another payout while waiting. A wall-clock timeout alone does not prove that an abandoned deposit cannot execute. Functioning coordination is required; a 502 coordination failure needs platform support.

**A deposit outside `/payouts` pays the last recipient set. Execute and direct deposits bypass the payout lease.** Keep them, owner changes and UI mutations from running concurrently with payouts. The lease does not isolate your deployment from those other paths. Only add envelope signatures to the prepared payout; changing source, amount, bounds, operations or authorisation entries is refused. Final retries are retained for seven days.

```bash
curl -sS --fail-with-body -X POST "$PAIFLOW/api/v1/deployments/$DEPLOYMENT_ID/payouts" \
  -H "Authorization: Bearer $PAIFLOW_TOKEN" -H 'Content-Type: application/json' \
  --data "$(jq -nc --arg from "$FROM" --arg recipient "$RECIPIENT" \
    '{from:$from,amount:"100000000",recipient:$recipient,nodeId:"pay"}')" \
  > /tmp/paiflow-payout.json
jq '.data | {nodeId,xdr,networkPassphrase,network,expiresAt}' /tmp/paiflow-payout.json
# Change nodeId "pay" to your actual Pay node id, or omit it if there is just one.
# Customer signs .data.xdr in the browser wallet, with .data.networkPassphrase.
read -r -p 'Wallet-signed payout XDR: ' SIGNED_XDR
curl -sS --fail-with-body -X POST "$PAIFLOW/api/v1/deployments/$DEPLOYMENT_ID/payouts/submit" \
  -H "Authorization: Bearer $PAIFLOW_TOKEN" -H 'Content-Type: application/json' \
  --data "$(jq -nc --arg signedXdr "$SIGNED_XDR" '{signedXdr:$signedXdr}')"
```

Append to the same module; submit results and `?wait=false` behave like execute:

```ts
export const preparePayout = (input: {
  from: string;
  amount: string;
  recipient: string;
  nodeId?: string;
}) => call<Prepared & { nodeId: string }>("payouts", "POST", input);
export const submitPayout = (input: { signedXdr: string }, wait = true) =>
  call<Submitted>("payouts/submit", "POST", input, new URLSearchParams({ wait: String(wait) }));

// Catch PaiflowError in your server handler. For status 409/429, forward status
// and Retry-After to your UI; wait that many seconds before retrying.
// Keep a submitted envelope to retry submitPayout while outcome is uncertain.
```

## Release early

Release a time condition's **before side**, for example after a freelancer delivers work. No customer signing is needed: the deployment token authorises the relayer. Body `{ nodeId? }`; empty body or `{}` works with one timelock branch. With several, pass the exact condition node id. Returns `{ data: { nodeId, txHash, ledger? } }` after confirmed release. Authorise the user's delivery decision on your app server before calling this privileged operation.

After the deadline returns 422 `VALIDATION`: `The deadline has passed; this condition now releases to its after side automatically.` Empty balance returns `There is nothing to release: this condition holds no funds right now.` A strict Hold is not an early-releasable branch.

```bash
curl -sS --fail-with-body -X POST "$PAIFLOW/api/v1/deployments/$DEPLOYMENT_ID/release-early" \
  -H "Authorization: Bearer $PAIFLOW_TOKEN" -H 'Content-Type: application/json' \
  --data '{"nodeId":"deadline"}'
```

Append to the same module; change `deadline` to the condition's actual node id:

```ts
export const releaseEarly = (input: { nodeId?: string } = {}) =>
  call<{ nodeId: string; txHash: string; ledger?: number }>("release-early", "POST", input);
// In an authorised server handler: await releaseEarly({ nodeId: "deadline" });
```

## Public spec and demo access

The OpenAPI document is bare JSON (no `data` wrapper). A public demo token takes no body, returns HTTP 201 `{ data: { deploymentId, token, expiresAt } }`, and expires in 60 minutes. Available only where enabled; otherwise 403. The demo is a shared testnet swap deployment: other callers can read events including your depositing address, and deposited testnet XLM goes to a Paiflow-owned account, not back to you. Use a throwaway funded wallet. Build your actual idea against the team's deployment/token. The starter can obtain a demo token on its server only after explicit `PAIFLOW_MODE=demo` selection. For hackathon teams, shared-demo payment testing begins on October 14; shared-demo payouts do not qualify for prizes.

```bash
curl -sS --fail-with-body "$PAIFLOW/api/v1/openapi.json"
curl -sS --fail-with-body -X POST "$PAIFLOW/api/v1/demo-token"
```

These optional public calls can also live in the server module:

```ts
export async function getOpenApi(origin: string): Promise<unknown> {
  if (!["demo", "team"].includes(process.env.PAIFLOW_MODE ?? "prepare"))
    throw new Error("Paiflow requests are disabled; select demo or team mode on integration day");
  const response = await fetch(new URL("/api/v1/openapi.json", origin));
  if (!response.ok) throw new Error(`OpenAPI HTTP ${response.status}`);
  return response.json();
}
export async function getDemoToken(origin: string) {
  if (process.env.PAIFLOW_MODE !== "demo")
    throw new Error("Demo access requires explicit demo mode");
  const response = await fetch(new URL("/api/v1/demo-token", origin), { method: "POST" });
  const body = (await response.json()) as
    | { data: { deploymentId: string; token: string; expiresAt: string } }
    | { error: ApiFailure };
  if ("error" in body)
    throw new PaiflowError(
      response.status,
      body.error,
      response.headers.get("Retry-After"),
      response.headers.get("x-request-id"),
    );
  if (!response.ok) throw new Error(`Demo HTTP ${response.status}`);
  return body.data; // keep token server-side
}
```

# 5. Testnet wallets and simulating customers

Teams are encouraged to prepare their own dedicated testnet wallets and obtain testnet XLM and USDC beforehand to save integration time. Add the exact USDC trustline described below; a trustline alone provides no balance. We provide wallet and funding support on site on October 14, with ready-to-use wallets as a last resort.

On October 14, use different wallets to simulate customers: connect/switch to the relevant wallet, prepare using its public address, have it sign in the browser, then submit. Each customer signs their own payment. **The app must never hold a customer's secret key**, even for a demo. Import any fallback-wallet handout keys only into dedicated testnet wallets, outside the app code; never commit them.

Organiser-provided fallback wallets are testnet-only; organisers hold copies of their keys. Never send real (mainnet) funds to them or import them into a wallet you use for real money. Anyone with the key can take what's in them.

**USDC trustlines:** a fresh Stellar wallet usually cannot hold USDC until it adds a trustline to that exact asset code and issuer. A missing recipient trustline can show `TrustlineMissingError` / `The payout recipient has no trustline for {asset}. The recipient must add a trustline for {asset} before this flow can pay them.` in simulation, surfaced as 422 `VALIDATION`; the whole payment reverts. A deploy warning does not block deployment or require acknowledgement, so successful deployment does not prove recipients are ready. In the recipient's testnet wallet, use Add asset / Add trustline for code `USDC`, issuer `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`, and have that wallet sign its change-trust transaction. Fund a new account with testnet XLM via Friendbot first so it exists and has reserves/fees. A trustline to another issuer's USDC will not work; native XLM needs no trustline. Check the exact trustline and required balances in every wallet, including any organiser-provided fallback wallet. Adding a trustline enables receipt, not a USDC balance: obtain testnet USDC separately, then prepare the failed payment again. Payouts checks recipient readiness before changing it; an inconclusive check also refuses mutation.

**Testnet USDC funding:** after funding the wallet with XLM and adding the exact USDC trustline, open [Circle's testnet faucet](https://faucet.circle.com/), select **USDC** and **Stellar Testnet**, and enter the customer's public wallet address (`G…`). Confirm the USDC balance before testing payments. Repeat for any wallet that will fund a flow, and choose test amounts that fit the available balance. Friendbot supplies XLM, not USDC.

# 6. Timing advice

Recommend **at least five minutes** for On Schedule and Subscription charge intervals; when using Allowance for a subscription, plan its charges on that same minimum interval. Allowance itself is approval, not a separate timed block. Payments land **one to two minutes after they are due** because automation is polled. Shorter intervals make a demo look stalled and drain testnet funds quickly: 10 USDC/minute requires about 2,400 USDC over four hours. Choose demo amounts to fit your available balance. Every team shares the relayer. The builder allows one-minute intervals; this is advice, not enforcement, but don't use them for the event.

For `/payouts`, **reuse a small, fixed set of recipients**. A new recipient costs one extra relayer configuration transaction; matching existing recipient and value can skip that mutation. Leave time for signing within its 60-second window and for the preceding payout to finish.

The **live feed can lag by up to a minute** in normal background polling. Do not send another payment just because the animation has not appeared. Poll events with the rules above, track submission status/hash, and allow extra time when the network is slow; a minute is not a guaranteed upper bound.

# 7. Common failures

The quoted text below is returned by the API or its contract error translation. `{asset}` is replaced with the resolved asset name, including its issuer where available. A prepare simulation failure appends this prerequisite text:

> `from` must be a funded account on this network: it pays the deposit and the fee, and signs the envelope. The flow's payout recipient must hold a trustline for the asset it receives; a missing trustline reverts the whole pipeline.

| Failure / exact message                                                                                                                                                     | What to do                                                                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `TrustlineMissingError`: `The payout recipient has no trustline for {asset}. The recipient must add a trustline for {asset} before this flow can pay them.`                 | Add the recipient's trustline to the exact testnet code/issuer, then prepare again. It is normally a 422 simulation refusal, not a partial payout.                       |
| `AccountMissingError`: `The account receiving {asset} doesn't exist on this network yet. Fund it with XLM first, then add a trustline for {asset}.`                         | Friendbot-fund the recipient and add its line.                                                                                                                           |
| `BalanceError`: `There isn't enough {asset} to cover this transfer.`                                                                                                        | Check payer/input balance, and any funded contract balance needed by the flow. Top up the correct testnet asset.                                                         |
| `Insufficient balance to cover this transaction. Check the account balance and try again.`                                                                                  | Check testnet asset balance and XLM for fees/reserves.                                                                                                                   |
| `txInsufficientBalance`: ``The `from` account cannot cover the fee for this transaction.``                                                                                  | Fund the signing account with testnet XLM.                                                                                                                               |
| Pay `NotConfigured`: `This flow's Pay step has no recipient yet. Set it in Dev values on the deployment page, or per payment through POST /api/v1/deployments/:id/payouts.` | Fill Pay in Dev values, or use payouts prepare/sign/submit. Retrying execute without configuring cannot fix it.                                                          |
| Split `NotConfigured`: `This flow's Split step has no recipients yet. Set them in Dev values on the deployment page.`                                                       | Fill the roster in Dev values and check shares/amounts before retrying.                                                                                                  |
| 422 `VALIDATION`: `Recipient account/trustline readiness could not be established; no relayer mutation was sent`                                                            | Check recipient exists and trusts the asset; if checks cannot reach the network, retry later.                                                                            |
| 429 `RATE_LIMITED`: `Too many requests`                                                                                                                                     | Stop immediate retries and wait the `Retry-After` seconds; reduce polling and duplicate submit loops.                                                                    |
| 409 `CONFLICT`: `Another payout is preparing or can still execute; submit its prepared envelope or retry after finality`                                                    | Submit/recheck the earlier prepared envelope; otherwise wait using `Retry-After` if provided, then retry. Never work around this with execute/direct deposits.           |
| `txTooLate`: `The transaction's 180-second window expired before it reached the network. Prepare it again.`                                                                 | Execute expired: prepare again and sign promptly. This shared error wording also appears for a payout even though payouts' actual window is 60 seconds; use `expiresAt`. |
| 422 `VALIDATION`: `This prepared payout has expired; prepare a new payout`                                                                                                  | The unconfirmed old payout no longer owns protection. Prepare a new one; do not submit an altered old body.                                                              |
| `txBadSeq`: ``The `from` account's sequence number moved since this envelope was prepared. Prepare it again.``                                                              | Avoid simultaneous transactions from the same customer wallet; prepare again after its other transaction finishes.                                                       |
| `txBadAuth`: ``The envelope is not signed by the `from` account.``                                                                                                          | Reconnect the selected customer's wallet and sign with the returned passphrase.                                                                                          |

If submission returns `PENDING` or a transport/502 error, keep its signed envelope and check again. Expiry is a reason to prepare anew only once the old payment is known not to have succeeded; don't mistake an uncertain response for no payment. For any unfamiliar error, keep `x-request-id`, status, code and message for platform support, without exposing credentials.

# 8. Worked examples

## Barkada bill splitter or creator tip jar

Graph: **On Receive USDC → Split**, with two recipients at 5000/5000 bps (or your chosen shares summing to 10,000). Every positive customer deposit is distributed by percentage; recipients need USDC trustlines. Deploy once for the group/creator.

App calls: `prepareExecute({ from: customerPublicKey, amount: "100000000" })` for a 10-USDC contribution → customer's browser wallet signs → `submitExecute({ signedXdr })` → `listEvents({ cursor })`. Show RECEIVE and PAYOUT events, deduplicated by eventId; use the hosted trigger page as a payment alternative and embed for the shared visual feed. Switch wallets to demonstrate three customers, not three deployments.

## Campus Snacks reference sample

Source: [artisam-paiflow/paiflow-campus-snacks](https://github.com/artisam-paiflow/paiflow-campus-snacks), built from the supplied starter. It represents one branch of a snack shop. See its [README setup instructions](https://github.com/artisam-paiflow/paiflow-campus-snacks/blob/main/README.md) for October 14 integration.

Graph: **On Receive USDC → percentage Split**, with Dev mode off. Vendor first: **9000 bps (90%)**; student organisation second: **1000 bps (10%)**. Use distinct funded testnet recipients with the exact USDC trustline. One deployment serves all customers.

On October 14, configure server-only `PAIFLOW_BASE_URL` with the supplied platform origin, `PAIFLOW_DEPLOYMENT_ID` with the team's confirmed deployment UUID, and `PAIFLOW_API_TOKEN` with its token; restart the app. The sample requires its own configured deployment and does not use the starter's shared XLM demo. The server calculates snack prices; Freighter signs in the browser.

The organiser's October 4 rehearsal confirmed **3.50 USDC → 3.15 vendor + 0.35 student organisation** on-chain. Each team must still rehearse its own deployment after setup. The two jars show cumulative received payouts, not wallet balances. They pair a USDC deposit with its percentage Split payout in the same transaction, deduplicate `eventId` and follow contract rounding; unmatched activity stays in history but does not increase totals. `$` labels denote testnet USDC; no real money or goods are involved.

## Sari-sari store checkout

Graph: **On Receive USDC → Pay full amount to the store wallet**, or → percentage Split for the store and partner. The app's basket total supplies input `amount` as stroops. This one deployment serves this store; it does not create a new contract for every shopper.

App calls: prepareExecute for the customer's address and checkout amount → browser wallet signs → submitExecute → listEvents, optionally filtering `txHash` to show that checkout's payout. Only mark the payment complete on SUCCESS, not merely HTTP 200. If the use case needs a recipient chosen per sale, use a Dev Pay with deferred value and preparePayout → sign → submitPayout; serialise payouts and do not mix execute/QR payments into that deployment while a payout lease is held.

## Freelance escrow

Graph: **On Receive USDC → Condition `time_before` at a future deadline**. True/before → Pay full amount to the freelancer; False/after → Pay full amount to the client's configured wallet. Both outputs must be connected. Use an explicit client Pay for a refund, because Return to owner would pay the team's deploying wallet. Do not use Hold if work delivery should permit early release.

App calls: prepareExecute for the client deposit → client signs → submitExecute. Poll listEvents to show the deposit is held. When an authorised client accepts delivery **before** the deadline, call `releaseEarly({ nodeId: "deadline" })` (use the actual condition id), then poll events for the freelancer payout. If no early release occurs, automatic after-side release pays the configured client at/after the deadline, subject to polling delay. Everyone using this deployment shares that deadline and held balance; this is one escrow relationship, not independent escrows per customer.

## Group-buy pool

Graph: **On Receive USDC → Condition `time_after` at the collection deadline**. False/before → Hold; True/after → Return to owner. Customers contribute to one shared locked balance. Early release is disabled; at/after the deadline all funds go to the wallet that signed deployment so the group organiser can buy the goods. This is not automatic per-contributor refunds or a target-based success/failure pool.

App calls: prepareExecute for each customer contribution → that customer's wallet signs → submitExecute → listEvents for the shared deposit history. No releaseEarly call: Hold makes it a strict lock. Wait for automatic after-side release and show its event in the feed/embed. Explain in the pitch who controls the deploying wallet and that it receives the pooled money at the deadline.
