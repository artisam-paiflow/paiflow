# Paiflow alpha testing guide

Thanks for helping test Paiflow. This guide takes about **45 minutes** end to end: 10 minutes of
setup, then a set of short test cases. You don't need to know how to code.

**What Paiflow is.** A visual builder for payments. You drag a trigger ("when money arrives") and
an action ("pay this person", "split it", "swap it") onto a canvas, press **Deploy**, and Paiflow
turns that into real smart contracts on the Stellar network. It is non-custodial: you sign every
transaction yourself, in your own wallet, and Paiflow never holds your keys.

> **Everything in this round runs on Stellar testnet.** Testnet money is free and worthless. You
> will never be asked for real funds, a card, or a seed phrase. If anything ever asks you for one,
> stop and report it.

> **We record how the app is used during this round.** beta.paiflow.xyz sends usage analytics
> and screen recordings of your sessions to PostHog, so we can see where things are confusing
> without asking you to write it all down. Recordings mask what you type into fields. Events are
> tied to your test account's internal ID, not your name, and never include wallet addresses or
> keys. If you have concerns about this, contact us before you start.

---

## Contents

1. [Before you start](#1-before-you-start)
2. [Sign in to your test account](#2-sign-in-to-your-test-account)
3. [A quick tour of the builder](#3-a-quick-tour-of-the-builder)
4. [Test cases](#4-test-cases)
5. [What not to test in this round](#5-what-not-to-test-in-this-round)
6. [Known issues](#6-known-issues)
7. [Troubleshooting](#7-troubleshooting)
8. [Reporting a bug](#8-reporting-a-bug)

---

## 1. Before you start

**You need:** a desktop or laptop with **Chrome** or **Brave**. Phones are not part of this round.

### 1.1 Install Freighter and switch it to testnet

1. Install the [Freighter wallet extension](https://www.freighter.app/) and pin it to your toolbar.
2. Open Freighter → **Create new wallet**. Write down the recovery phrase somewhere safe — even
   for a test wallet, you'll want it if the extension gets reset.
3. In Freighter, open the network menu at the top and choose **Testnet**.

- [ ] Freighter shows **Testnet** at the top.

### 1.2 Fund your wallet with free testnet XLM

A brand-new Stellar account doesn't exist on the network until it holds some XLM. Friendbot is
Stellar's free testnet faucet.

1. In Freighter, copy your address (it starts with `G`).
2. Open this link in a new tab, replacing `YOUR_ADDRESS`:
   `https://friendbot.stellar.org/?addr=YOUR_ADDRESS`
   (Freighter may also show a **Fund with Friendbot** button — that does the same thing.)

- [ ] Freighter shows a balance of **10,000 XLM**.

This account is your **Main** account. You'll deploy and trigger flows with it.

### 1.3 Create two recipient accounts

Your flows need somebody to pay. You'll pay yourself, into two extra accounts.

1. In Freighter, open the account menu → **Add a new wallet** (or **Create account**). Name it
   **Recipient A**.
2. Fund it with Friendbot exactly as in step 1.2.
3. Repeat for a third account named **Recipient B**.
4. Paste all three `G…` addresses into a note — you'll copy them into Paiflow later.

- [ ] Main, Recipient A and Recipient B all show 10,000 XLM.

### 1.4 Let Recipient A hold USDC

Some tests swap XLM into USDC (a testnet dollar token). A Stellar account has to opt in to a
token before it can hold it — this is called adding a **trustline**.

1. In Freighter, switch to **Recipient A**.
2. Open **Manage assets** → **Add an asset** (the wording varies slightly by Freighter version).
3. Search for **USDC**, and pick the one whose issuer is
   `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`. Confirm and sign.
4. Switch Freighter back to **Main**.

- [ ] Recipient A lists **USDC** with a balance of 0.

Leave Recipient B **without** a USDC trustline.

---

## 2. Sign in to your test account

We'll send you a **username** and **password** for your test account.

1. Go to [beta.paiflow.xyz](https://beta.paiflow.xyz/login) and open the login page.
2. Enter your **Username** and **Password**, then click **SIGN IN**.

- [ ] You land on your dashboard ("Your flows.").
- [ ] One flow is already there: **Swap XLM to USDC**.

**Tip:** bookmark each deployment page you create, so you can find it quickly for a bug report.

---

## 3. A quick tour of the builder

Open **Swap XLM to USDC**. Take a minute to find each of these — you'll use them in every test.

- **Blocks** (left sidebar) — the palette. Drag a block onto the canvas. Triggers, Actions and
  Logic are grouped.
- **Canvas** (centre) — your flow. Drag from one block's handle to another to connect them. Select
  a block and press Delete to remove it.
- **Settings panel** — click any block on the canvas to open its settings.
- **English Preview** (top) — your flow written out as a sentence. **Always read it before
  deploying** — it's the plain-language check on the money.
- **Errors** button — appears when something's wrong. Click it to list every problem. Fields with
  problems are also highlighted.
- **DEPLOY** button — greyed out until the flow has no errors.
- **Dev mode** switch — **leave this off** for every test.
- **Flow title** — click it to rename the flow. Changes save automatically; there is no Save
  button.

A flow always starts with exactly **one trigger**. Once you have one, the other triggers grey out.

---

## 4. Test cases

Do them in order — later tests reuse accounts and flows from earlier ones. For each one, tick the
boxes as you go. **If a box doesn't match what you see, report it** with the
[bug report form](https://forms.gle/c7AmbU61XbGpCPVXA), unless it's listed under
[known issues](#6-known-issues).

**Where to check that money really moved:**

- The **live event feed** on the deployment page.
- **Freighter**: switch to the recipient account and look at its balance.
- **stellar.expert**: every deployment page links its contract to
  [stellar.expert/explorer/testnet](https://stellar.expert/explorer/testnet), where you can see
  each transaction.

---

### T1 — Deploy and run the ready-made swap flow

**Goal:** the core of this round. Receive XLM, swap it to USDC on a real exchange (Soroswap), and
pay it out.

1. Open **Swap XLM to USDC**. Don't change anything.
2. Read the **English Preview**.
   - [ ] It describes receiving XLM, swapping to USDC, and paying it out.
3. Click the **Swap** block.
   - [ ] Router shows **Soroswap (testnet)** and can't be changed.
   - [ ] A live quote appears, like _"10 XLM → ~1.05 USDC via Soroswap (live)"_, with a minimum
         amount under it.
4. Click **DEPLOY**. You're taken to **Review & deploy**.
   - [ ] A **TESTNET** chip is shown.
   - [ ] The page says how many contracts it will create, and shows the swap quote again.
5. Click **DEPLOY TO TESTNET**. Freighter pops up — check it says testnet, then **sign**.
   - [ ] A "Contract deployed" message appears and you're taken to the deployment page.
   - [ ] Within about a minute the status becomes **ACTIVE** and a QR code appears.
6. **Bookmark this page.** Click **OPEN TRIGGER PAGE**.
7. Enter **10** as the amount, click **CONFIRM AMOUNT**, then **CONNECT WALLET & TRIGGER**. Sign
   in Freighter (with your **Main** account).
   - [ ] You see progress messages ending in a success message.
8. Go back to the deployment page and watch the live event feed.
   - [ ] A **RECEIVE** row for 10 XLM appears.
   - [ ] A **PAYOUT** row for the swap shows amount in (XLM) and amount out (USDC), and the USDC
         amount is close to the quote from step 3.
   - [ ] On stellar.expert, the trigger transaction shows a Soroswap **swap**.

This first flow pays a shared Paiflow demo account, so you won't see the USDC yourself — T2 fixes
that.

---

### T2 — Swap into your own account

**Goal:** confirm the swapped USDC lands where you told it to.

1. Back on the dashboard, open **Swap XLM to USDC** again.
2. Click the **Pay** block and replace the recipient with **Recipient A**'s address.
   - [ ] The English Preview now shows Recipient A's address (shortened).
3. Deploy it (steps 4–5 of T1), then trigger it with **20 XLM** (steps 6–7 of T1).
   - [ ] The live feed shows RECEIVE and PAYOUT rows.
4. In Freighter, switch to **Recipient A**.
   - [ ] Recipient A now holds **about 2 USDC** (close to the quote).
5. Switch Freighter back to **Main**.

---

### T3 — The swap block refuses bad settings

**Goal:** check that mistakes are caught _before_ anything is deployed. You won't deploy in this
test.

Open **Swap XLM to USDC** and try each change below. After each one, check the boxes, then **undo
the change** before trying the next.

- **a. Try:** set **Asset Out** to **XLM** (same as Asset In).
  - **Expected:** an error saying a swap has to exchange two different assets.
- **b. Try:** set **Max slippage** to **0.1**.
  - **Expected:** an error saying slippage must be at least 0.3% because of Soroswap's pool fee.
- **c. Try:** set **Deadline** to **0**, then to **100000**.
  - **Expected:** the field refuses the value (the allowed range is 1–86,400 seconds).
- **d. Try:** delete the connection between **Swap** and **Pay**.
  - **Expected:** an error saying a swap needs one next step.
- **e. Try:** drag in a second **Pay** block and connect **Swap** to it too.
  - **Expected:** an error saying a swap sends its output to only one next step.

For every row:

- [ ] The error is easy to understand and says how to fix it.
- [ ] **DEPLOY** is greyed out while the error is there.
- [ ] The error goes away once you undo the change.

---

### T4 — Receive XLM, pay a fixed amount

**Goal:** the simplest flow — money in, money out to one person.

1. On the dashboard, click **NEW FLOW**, name it **T4 Pay**, and click **CREATE FLOW**.
2. The new flow comes with an example (receive USDC, split to Alice / Bob / Charlie). Those are
   placeholder accounts that can't receive money, so **delete both blocks**.
3. Drag in **On Receive**. In its settings, set Asset to **XLM (native)**.
4. Drag in **Pay** and connect On Receive → Pay. In Pay's settings:
   - Asset: **XLM**
   - Recipient: **Recipient B**'s address
   - Amount mode: **Fixed**, amount **5**
   - [ ] English Preview reads roughly: _when this contract receives XLM, pay 5 XLM to G…_
5. Deploy it and trigger it with **5 XLM**.
   - [ ] Live feed shows RECEIVE then PAYOUT.
   - [ ] Recipient B's XLM balance in Freighter went up by 5.
6. Open the flow again, change Pay to **Send full amount**, deploy, and trigger with **12 XLM**.
   - [ ] Recipient B's balance went up by 12.

---

### T5 — Receive XLM, split it between two people

**Goal:** fan one payment out to several recipients.

1. **NEW FLOW** → name it **T5 Split**. Keep the example's two blocks this time.
2. Click **On Receive** and change Asset to **XLM (native)**. Click **Split** and change its Asset
   to **XLM**.
3. In Split, use **Percentage** mode with exactly two recipients:
   - Recipient A — **70%**, label `A`
   - Recipient B — **30%**, label `B`
   - [ ] The allocation bar is full, and the English Preview shows 70% and 30%.
4. Deploy and trigger with **10 XLM**.
   - [ ] Live feed shows RECEIVE and two PAYOUT rows.
   - [ ] Recipient A received 7 XLM and Recipient B received 3 XLM.

**Now try to break it** (no need to deploy — just check the error, then undo):

- **a. Try:** change 30% to **20%**.
  - **Expected:** an error saying the percentages don't add up to 100%.
- **b. Try:** set both recipients to **Recipient A**'s address.
  - **Expected:** an error about a duplicate address.
- **c. Try:** leave a recipient address empty, or type `hello`.
  - **Expected:** the field is highlighted as invalid.

- [ ] Each error is clear, and DEPLOY stays greyed out until you undo it.

---

### T6 — Split USDC (uses the USDC from T2)

**Goal:** the same split, with a token instead of XLM, and a recipient that can't accept it.

1. **NEW FLOW** → **T6 USDC split**. Keep the example's **On Receive (USDC)** → **Split (USDC)**.
2. Replace the three recipients with a single one: **Recipient A**, **100%**.
3. Deploy with **Main** as usual.
4. Open the trigger page. **Switch Freighter to Recipient A** (it holds the USDC from T2), enter
   **1**, and trigger.
   - [ ] Live feed shows RECEIVE 1 USDC and a PAYOUT of 1 USDC.
5. Now change the flow so the single recipient is **Recipient B** (no USDC trustline), deploy, and
   trigger with **1 USDC** from Recipient A again.
   - [ ] The trigger is refused **before** you're charged, with a message you can make sense of.
   - [ ] Recipient A still has its USDC.

Switch Freighter back to **Main** when you're done.

---

### T7 — Free exploration (10 minutes)

Build any flow you like using **On Receive**, **Pay**, **Split** and **Swap** — for example
receive XLM → swap to USDC → split to two accounts that both have a USDC trustline. Deploy it,
trigger it, and tell us what felt confusing, slow or surprising. There are no wrong answers here.

---

## 5. What not to test in this round

These features are in the app but aren't ready for alpha testing yet. You may see them in the
palette or on a page — **please don't use them this round, and don't report problems with
them.**

- **On Schedule, HTTP Webhook, Subscription and Payroll triggers** — not part of this round. Build
  your flows with **On Receive** only.
- **Condition block** — not part of this round.
- **Email Notify block** — still being finished. Don't add it to a flow.
- **Fiat / bank payout** in Pay and Split, and **Sender KYC** — not part of this round. Keep
  payouts on **Crypto (wallet)**.
- **Dev mode switch** — leave it off.
- **Ask AI** (chat and voice) — not part of this round.
- **API access** panel on deployment pages (developer API tokens) — not part of this round.
- **Passkeys** on the Profile page — not part of this round. Sign in with your username and
  password.
- **Phones and mobile wallets** (LOBSTR, xBull) — not part of this round. Use desktop Freighter.

---

## 6. Known issues

Already on our list — no need to report these.

- **The trigger page can report a failure even though the payment went through.** Before
  reporting a failed trigger, check the live event feed and stellar.expert. Only report it if the
  money really didn't move.
- **The trigger page doesn't keep a record of a successful trigger** after the message
  disappears. Use the deployment page's live feed instead.
- **The review page lists several wallets** (Freighter, Albedo, xBull, LOBSTR, Hana), but only
  **Freighter** works for deploying right now.
- **The example flow created by NEW FLOW** pays placeholder accounts (Alice, Bob, Charlie) that
  can't receive money. Always replace them with your own recipients.
- **The live feed can lag** a few seconds to a minute behind the chain. Give it a minute before
  reporting a missing row.

---

## 7. Troubleshooting

- **You see** _"Account … is not funded"_ or _"Minimum 2 XLM required"_.
  **Try:** fund the account in Freighter with Friendbot
  ([step 1.2](#12-fund-your-wallet-with-free-testnet-xlm)).
- **You see** a Freighter network error, or the signature fails.
  **Try:** check Freighter is on **Testnet**, then try again.
- **You see** an error mentioning a **trustline**.
  **Try:** the account receiving USDC hasn't added USDC yet
  ([step 1.4](#14-let-recipient-a-hold-usdc)).
- **You see** DEPLOY greyed out.
  **Try:** click the **Errors** button above the canvas and fix each item.
- **You see** _"Invalid username or password"_.
  **Try:** check both, including capital letters. After 5 wrong tries the account locks for 15
  minutes — wait, then try again.
- **You forgot your password.**
  **Try:** there's no reset link yet. Contact us — the same people who sent you your test account —
  and we'll reset it.
- **You see** no Freighter pop-up.
  **Try:** click the Freighter icon in your toolbar — the request may be waiting there.

---

## 8. Reporting a bug

Report bugs with the **[bug report form](https://forms.gle/c7AmbU61XbGpCPVXA)** — one form per
bug, please.

It helps to have these ready before you open it:

- the test and step you were on (e.g. T5, step 4);
- the exact error message, if there was one;
- the deployment page URL, and the transaction link on stellar.expert if you have one;
- a screenshot or screen recording.

When you're finished, please also fill in the short
**[feedback survey](https://forms.gle/hdmpGNwUi6oh6stv6)** (3–4 minutes). It's the most useful
thing you can give us.

Thank you!
