# Paiflow Developer Guide

Updated Oct 10, 2026

Build your first payment integration: a customer's XLM payment automatically splits 90% to a shop and 10% to a community fund. Start with a working flow, prove its payout, then connect your own app.

### Choose the right resource

| Resource                                                                                                                             | Use it when you want to…                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| [Developer guide](https://github.com/webnxt-2030/pinkraft/blob/hackathon-staging/docs/hackathon/developer-guide.md)                  | Set up wallets, build and deploy a flow, then configure and customise the ready-wired starter.                     |
| [API quickstart](https://github.com/webnxt-2030/pinkraft/blob/hackathon-staging/docs/hackathon/developer-api-quickstart.md)          | Integrate your own app without the starter, using a complete frontend/backend example.                             |
| [Full API reference](https://github.com/webnxt-2030/pinkraft/blob/hackathon-staging/docs/api/README.md)                              | Look up endpoint schemas, errors, limits, pagination and advanced workflows.                                       |
| [OpenAPI JSON](https://github.com/webnxt-2030/pinkraft/blob/hackathon-staging/docs/api/openapi.json)                                 | Import the machine-readable API contract into development tools.                                                   |
| [Postman collection](https://github.com/webnxt-2030/pinkraft/blob/hackathon-staging/docs/api/paiflow-api-v1.postman_collection.json) | Try API requests with your deployment UUID and token.                                                              |
| [AI developer context (`llms.md`)](https://github.com/artisam-paiflow/paiflow-hackathon-starter/blob/main/llms.md)                   | Give your AI assistant product rules, API details and worked examples.                                             |
| [Starter repository](https://github.com/artisam-paiflow/paiflow-hackathon-starter)                                                   | Get working payment preparation, Freighter signing, submission and event reads without implementing them yourself. |
| [Freighter Testnet setup](https://developers.stellar.org/docs/build/guides/freighter/connect-testnet)                                | Create a wallet, select Testnet and obtain testnet XLM.                                                            |
| [Stellar Expert Testnet](https://stellar.expert/explorer/testnet)                                                                    | Inspect transaction evidence and verify actual payouts.                                                            |

Follow your participant brief for event rules, preparation permissions, deadlines and submissions.

### Contents

1. [Before you begin](#before-you-begin)
2. [Prepare your testnet wallets](#prepare-your-testnet-wallets)
3. [Build a Receive → Split flow](#build-a-receive--split-flow)
4. [Review and deploy](#review-and-deploy)
5. [Make a payment through the hosted page](#make-a-payment-through-the-hosted-page)
6. [Create your deployment API token](#create-your-deployment-api-token)
7. [Run the starter in preparation mode](#run-the-starter-in-preparation-mode)
8. [Configure your own deployment](#configure-your-own-deployment)
9. [Make a payment from your app](#make-a-payment-from-your-app)
10. [Replace the screens with your idea](#replace-the-screens-with-your-idea)
11. [Troubleshoot your first integration](#troubleshoot-your-first-integration)
12. [Check your result and go further](#check-your-result-and-go-further)

## Before you begin

This walkthrough is event-neutral. Follow your participant brief and organisers' instructions for when preparation, deployment and app integration are allowed.

Paiflow is the money logic behind your app. Your app handles who pays and why; a deployed flow handles when money moves and where it goes. One deployment serves one business or group and can receive payments from many customers.

| You need                                | Purpose                                          |
| --------------------------------------- | ------------------------------------------------ |
| [Paiflow](https://beta.app.paiflow.xyz)     | Build, deploy and inspect your payment flow      |
| A full/team Paiflow account             | Create your own deployment API token             |
| [Freighter](https://www.freighter.app/) | Connect wallets and approve testnet transactions |
| Node.js 22, pnpm 10 and git             | Run the supplied starter app                     |
| Dedicated testnet wallets               | Deploy, pay and receive the split                |

**Sandbox or team account?** The sandbox supports practice using its available features, including flows and test payments. Sandbox accounts cannot create deployment API tokens or connect their deployments to your app through the partner API. Use a full/team account for the integration steps.

## Prepare your testnet wallets

**Recommended: watch the full wallet setup tutorial.** The video walks through installing Freighter, selecting Testnet, funding with Friendbot, adding Circle USDC and swapping XLM for USDC.

[Watch the wallet setup tutorial](https://youtu.be/OBFtQsRe4b0).

1. Install the [Freighter browser extension](https://www.freighter.app/) in the browser you will use for Paiflow and your local app. Complete its initial wallet setup, then switch to Stellar Testnet.
2. Create a dedicated testnet account and fund it with testnet XLM using Freighter's Friendbot funding option.
3. Add a Circle testnet USDC trustline in Freighter. Use asset code `USDC` and issuer `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`. Adding the trustline enables receiving that asset; it does not provide a USDC balance.
4. In Freighter, select Swap and exchange a small amount of testnet XLM for the Circle testnet USDC asset added above. Review the quote, confirm the Testnet transaction and check that your USDC balance appears. Keep some XLM for fees and reserves. If no swap quote is available, use the [Circle testnet faucet](https://faucet.circle.com/) to obtain USDC instead.
5. Make a secondary wallet in Freighter, select Testnet, fund it with Friendbot and add the same USDC trustline. Feel free to create as many wallets as you need.

Keep wallet secrets in Freighter. Never paste a secret key or recovery phrase into Paiflow, your app, an AI prompt or a repository. Testnet funds have no real-money value.

## Build a Receive → Split flow

1. Open [Paiflow](https://beta.app.paiflow.xyz) and log in, or use the sandbox to try it out.
2. Create a flow, using **On Receive** as its trigger and **Split** as its action. Connect On Receive to Split.
3. Select native **XLM** as the flow's asset. Remove unrelated blocks or default recipients from the example graph.
4. Configure two percentage recipients using your actual funded public addresses:

| Recipient      | Percentage | Expected share of 1 XLM |
| -------------- | ---------- | ----------------------- |
| Shop           | 90%        | 0.9 XLM                 |
| Community fund | 10%        | 0.1 XLM                 |

The shares must total 100%. The UI uses percentages; in the graph/API reference, 90% is `9000` basis points and 10% is `1000`. Replace every placeholder address before deploying.

**Checkpoint:** your graph has one trigger, a connected Split action, XLM throughout and two real recipients. You are modelling one shop's payment rules, not a separate contract for each customer.

## Review and deploy

1. Open the deployment review and read the **English preview**. Confirm that it describes receiving XLM and paying your two recipients at the intended percentages.
2. Connect the funded deployer wallet. Confirm Freighter is on Testnet.
3. Start deployment. In Freighter, review the network, source account, requested contract operations and displayed fee before confirming.
4. Wait for the deployment to report **CONFIRMED**, then open its deployment page.

Copy the deployment's UUID. It is different from the flow ID and the Stellar contract address beginning with `C`. API calls use the deployment UUID.

**Checkpoint:** you have a confirmed deployment with the correct asset and recipients. Deployment alone does not prove a payment succeeded; make a test payment next. If confirmation is uncertain, check the existing deployment/transaction before starting another deployment.

## Make a payment through the hosted page

1. Open the deployment's hosted payment page or QR link. For this Receive flow, its path is `/trigger/YOUR_DEPLOYMENT_UUID` on the Paiflow site.
2. Connect your funded customer wallet. If you changed accounts in Freighter, check that the app shows the intended customer's public address.
3. Enter **1 XLM**, review the payment and approve the Testnet transaction in Freighter.
4. Wait for confirmation. Inspect the deployment's live activity and transaction evidence for the split payout.

For this example, the payment should route **0.9 XLM to the shop and 0.1 XLM to the community fund**. Fees are additional to the customer's 1 XLM payment. If a recipient is also the paying wallet, its net balance change will include both the payment and fees; use the transaction's payout evidence to check the split.

**Checkpoint:** save the payment transaction hash and verify its expected payouts. A slow live feed is not proof of failure; check the existing transaction before paying again. You can look up the hash on [Stellar Expert Testnet](https://stellar.expert/explorer/testnet).

## Create your deployment API token

1. Return to your deployment page while signed in as its owner.
2. Open **API access**, create a token and copy it immediately. The full token is shown once.
3. Keep the token with your confirmed deployment UUID for the starter's server configuration.

See the [API quickstart](https://github.com/webnxt-2030/pinkraft/blob/hackathon-staging/docs/hackathon/developer-api-quickstart.md) for preparing, signing and submitting payments, checking transaction status and reading events.

| Value            | How to recognise it                                                    |
| ---------------- | ---------------------------------------------------------------------- |
| Deployment UUID  | UUID for the confirmed deployment; not the flow ID or contract address |
| API token        | Begins with `pfk_`; belongs to this deployment                         |
| Customer address | Public `G…` address; comes from the customer's connected wallet        |

**Keep the API token server-side.** Do not put it in browser code, `NEXT_PUBLIC_` variables, screenshots or public repositories. If exposed, revoke it and issue a replacement. Customers approve their own payments in their wallets; your server never needs their secret keys.

## Run the starter in preparation mode

Use the [Paiflow hackathon starter](https://github.com/artisam-paiflow/paiflow-hackathon-starter). Run these commands in a terminal:

```bash
git clone https://github.com/artisam-paiflow/paiflow-hackathon-starter.git
cd paiflow-hackathon-starter
corepack enable
pnpm install
cp .env.example .env.local
pnpm dev
```

Open `http://localhost:3000`. These copy commands work in bash; on Windows you can copy `.env.example` to `.env.local` in your editor instead. Keep `PAIFLOW_MODE=prepare` while preparing non-payment screens or while event rules require it.

Preparation mode disables wallet actions, payments and event polling. It makes no upstream Paiflow requests. Payment, payout and event routes return `403 PREPARATION_MODE`; that is expected in this mode.

**Checkpoint:** the app opens locally and you can work on its non-payment screens. Keep the starter's mode guards when you customise it.

## Configure your own deployment

When integration is permitted, stop the dev server. Edit `.env.local` using your deployment and token:

```dotenv
PAIFLOW_MODE=team
PAIFLOW_BASE_URL=https://beta.app.paiflow.xyz
PAIFLOW_DEPLOYMENT_ID=YOUR_CONFIRMED_DEPLOYMENT_UUID
PAIFLOW_API_TOKEN=YOUR_DEPLOYMENT_API_TOKEN
```

Replace both placeholders with the real values. If your organiser supplies a different API origin, use that origin for `PAIFLOW_BASE_URL`. The starter's copied example may have an older default; set it explicitly. Restart with `pnpm dev` after changing configuration.

| Mode      | Meaning                                               |
| --------- | ----------------------------------------------------- |
| `prepare` | Non-payment screens only; default when mode is unset  |
| `team`    | Your deployment and server-side token                 |
| `demo`    | Optional shared XLM demo, where enabled and permitted |

Use **team** mode for this walkthrough. An empty token does not automatically select demo mode. Shared-demo transactions belong to a different deployment and do not demonstrate your own integration.

Ensure `.env.local` is ignored by git. Do not commit it. Missing or invalid team configuration disables integration with an error; fix the UUID, token or origin rather than bypassing the guards.

## Make a payment from your app

1. Open the local starter in the browser with Freighter installed. Confirm team mode is configured and the deployment uses XLM.
2. Select **Connect Freighter** and approve access to the local site. Connecting to Paiflow does not automatically grant access to your local app.
3. Confirm the customer address and Testnet network. Enter **1** in the ordinary **Pay** amount field and select **Pay**. Do not use the per-payment recipient form for this fixed Split example.
4. Review the Testnet signing request in Freighter and confirm. The starter prepares through its server, Freighter signs, and the server submits.
5. Check for **SUCCESS**, then verify the expected 0.9/0.1 XLM payout. Save the transaction hash.

The amount field uses decimal units of your flow's input asset. Internally, 1 XLM is the integer string `"10000000"`. Let `lib/amount.ts` handle conversion with bigint; avoid floating-point money arithmetic.

**Sign promptly.** The ordinary Pay preparation has an approximately **180-second validity window** (`expiresAt`). Have Freighter unlocked before selecting Pay. If preparation expires before signing/submission, dismiss the old request and prepare again. If signing finished or submission may have started, first check the original transaction's outcome; create a new payment only after confirming the original failed or expired without being included on-chain.

**If pending:** use **Check again** with the same signed transaction. Keep the tab open. A timeout or submission `502` may mean it was already broadcast; do not prepare a duplicate payment because the result is uncertain. If you switch customer accounts, select **Refresh wallet** before paying again.

## Replace the screens with your idea

Keep the working payment path while changing the customer experience:

| File                         | Role                                                                 |
| ---------------------------- | -------------------------------------------------------------------- |
| `components/starter-app.tsx` | Customer UI; replace with your checkout, dues or donation experience |
| `app/page.tsx`               | Server page wrapper and configuration readiness                      |
| `lib/paiflow.ts`             | Server-only Paiflow client and mode guards                           |
| `lib/amount.ts`              | Exact decimal-to-stroops conversion                                  |

The request path is **browser → your server → Paiflow → customer wallet signature → your server → Paiflow submission**. Return unsigned preparation data to the browser for wallet signing; keep the bearer token on the server. Treat HTTP 200 as a transport result, not payment confirmation: inspect transaction status and the expected payout.

Keep the deployment UUID and transaction hash with your app's payment record. Associate feed activity by transaction hash and deduplicate by `eventId`. Before exposing privileged payout or early-release routes, add your app's own authorisation.

For subscriptions, schedules, escrow, webhooks or changing recipients per payment, use the [developer context guide](https://github.com/artisam-paiflow/paiflow-hackathon-starter/blob/main/llms.md). Those features have different funding, consent and execution requirements; they are not interchangeable with this simple Receive flow.

## Troubleshoot your first integration

| Symptom                                   | What to check                                                                                               |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Freighter missing or not connecting       | Install/unlock it in this browser; approve this site's access; check the active account and Testnet network |
| No payment controls or `PREPARATION_MODE` | Set server-only `PAIFLOW_MODE=team` when permitted; restart the app                                         |
| Configuration error, `401` or `404`       | Check the origin, confirmed deployment UUID and active token belonging to that deployment                   |
| Insufficient funds or missing account     | Friendbot-fund the payer and recipients; leave XLM for fees and reserves                                    |
| Missing trustline after switching to USDC | Every receiving wallet needs the exact USDC asset trustline; the payer also needs USDC funds                |
| `422` validation error                    | Read the message; check asset, amount, recipients and trigger type                                          |
| `429` rate limit                          | Wait for `Retry-After`; avoid repeated clicks and excessive polling                                         |
| `PENDING`, timeout or submission `502`    | Preserve and resubmit the same signed envelope; check finality before creating a new payment                |
| Preparation expired before signing        | Dismiss the old request and prepare again; if submission was attempted, check its outcome first             |
| `FAILED`                                  | Read the confirmed failure and fix its cause before preparing another payment                               |
| Payment confirmed, feed not updated       | Verify by transaction hash; allow the feed to catch up instead of paying again                              |

A confirmed deposit can leave funds held in other flow types. For this Split example, verify the two expected payouts. When asking for help, include the deployment UUID, transaction hash, error code/message and `x-request-id` if available. Omit secrets and signed envelopes.

## Check your result and go further

Your first integration is ready when you have:

- A confirmed XLM Receive → Split deployment using your real recipient addresses.
- A hosted-page payment and a starter-app payment with verifiable payouts.
- The deployment UUID and payment transaction hashes saved.
- Server-only API credentials, with no wallet secrets in your app.
- A clear way to display success, pending and failure to the customer.
