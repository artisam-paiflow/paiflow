# Paiflow alpha testing guide

Thanks for helping test Paiflow. This guide takes **about 90 minutes** end to end: 15 minutes of
setup, about an hour of test cases, then the interview questions. You don't need to know how to
code.

**You'll send us three things at the end.** They're what makes you eligible for the **₱500**
incentive ([section 10](#10-your-incentive)):

1. a **Loom recording** of your session, with your screen and camera ([step 1.5](#15-set-up-loom-and-prepare-to-record));
2. your **screenshots**, named as the test cases tell you ([section 4](#4-test-cases));
3. your **answers file** — the interview questions, answered as you go ([step 1.6](#16-create-your-answers-file)).

**What Paiflow is.** A visual builder for payments. You drag a trigger ("when money arrives") and
an action ("pay this person", "split it", "swap it") onto a canvas, press **Deploy**, and Paiflow
turns that into real smart contracts on the Stellar network. It is non-custodial: you sign every
transaction yourself, in your own wallet, and Paiflow never holds your keys.

> **Everything in this round runs on Stellar testnet.** Testnet money is free and worthless. You
> will never be asked for real funds, a card, or a seed phrase. If anything ever asks you for one,
> stop and report it.

> **We record how the app is used during this round.** beta.app.paiflow.xyz sends usage analytics
> to PostHog — which buttons and screens you reach, and where errors appear — so we can see where
> things are confusing without asking you to write it all down. **Your screen and your session are
> not recorded.** Events are tied to your test account's internal ID, not your name, and never
> include wallet addresses or keys. If you have concerns about this, contact us before you start.
>
> **The only recording of your screen is the one you make yourself**, with Loom, and send to us
> (step 1.5). It is not masked — it shows your screen as you see it, and your face and voice — so
> only start it once wallet setup is finished, as the steps below tell you.

---

## Contents

1. [Before you start](#1-before-you-start)
2. [Sign in to your test account](#2-sign-in-to-your-test-account)
3. [A quick tour of the builder](#3-a-quick-tour-of-the-builder)
4. [Test cases](#4-test-cases)
5. [What not to test in this round](#5-what-not-to-test-in-this-round)
6. [Known issues](#6-known-issues)
7. [Troubleshooting](#7-troubleshooting)
8. [Reporting bugs and sending in your artifacts](#8-reporting-bugs-and-sending-in-your-artifacts)
9. [Closing interview questions](#9-closing-interview-questions)
10. [Your incentive](#10-your-incentive)

[Appendix: answers file template](#appendix-answers-file-template)

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

### 1.5 Set up Loom and prepare to record

**Recording yourself is required this round.** Watching someone actually use Paiflow — face,
voice and screen together — tells us far more than a written bug report can, especially about the
parts that are merely confusing rather than broken.

1. Sign up at [loom.com](https://www.loom.com/) and install the **Loom Chrome extension**.
2. Loom's free Starter plan cuts every recording off at **5 minutes**, which isn't enough for this
   session. Start the **14-day free Business + AI trial** so your recording runs uninterrupted.
   **No card is needed.** If you don't add one, the workspace drops back to the free Starter plan
   when the trial ends and there is nothing to cancel. Only add a payment method if you want to
   keep Loom afterwards — doing so starts a paid subscription when the trial ends.
3. Set the recorder to **Screen + camera + mic**. We want your face in the corner and your voice
   throughout — thinking out loud, especially when you're unsure what a screen means, is the most
   useful part of the whole recording. If being on camera is a problem for you, tell us before you
   start rather than skipping it.

> **Don't start recording yet.** Your Freighter recovery phrase was on screen in step 1.1. Start
> recording at the beginning of [section 4](#4-test-cases), once wallet setup is done and there's
> nothing sensitive left to capture.

- [ ] Loom is installed, on a plan that records for longer than 5 minutes, and set to Screen +
      camera + mic.

### 1.6 Create your answers file

The interview is built into this guide: each test case ends with a question, and there's a closing
set in [section 9](#9-closing-interview-questions). You answer them **out loud on the recording**
and **in writing**, so we have something searchable next to the video.

1. Copy the [answers file template](#appendix-answers-file-template) at the end of this guide
   into a text file or a doc.
2. Save it as `answers-<yourname>.txt` (or `.doc` — either is fine).
3. Fill in the **About you** section at the top now, before you start testing.
4. Keep it open in another window while you work.

- [ ] Your answers file exists, and the About you section is filled in.

---

## 2. Sign in to your test account

We'll send you a **username** and **password** for your test account.

1. Go to [beta.paiflow.xyz](https://beta.paiflow.xyz) and open the login page.
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

> **Start your Loom recording now**, and keep it running through T1 to T7. Narrate as you go: what
> you're about to do, and what you expected to happen when it doesn't. If you have to stop partway
> — a break, a crash, the trial cutting out — just start a new recording and send us every link.

Do them in order — later tests reuse accounts and flows from earlier ones. For each one, tick the
boxes as you go. **If a box doesn't match what you see, grab a screenshot and report it** with the
[bug report form](https://forms.gle/c7AmbU61XbGpCPVXA), unless it's listed under
[known issues](#6-known-issues).

**Screenshots.** Each test below marks the shots we need with **Screenshot**. Save each one with
the exact name given (for example `T1-5-live-feed.png`) into a single folder — at the end you'll
zip that folder and send it in. Your operating system's built-in tool is enough:
**Win + Shift + S** on Windows, **Cmd + Shift + 4** on macOS.

**Interview prompts.** Each test ends with an **Interview** box. Say your answer out loud on the
recording, then write a line or two into your answers file under that test's heading. Don't
overthink them — your first reaction is exactly what we're after, including "I have no idea".

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
   - **Screenshot** `T1-1-english-preview` — the English Preview panel.
3. Click the **Swap** block.
   - [ ] Router shows **Soroswap (testnet)** and can't be changed.
   - [ ] A live quote appears, like _"10 XLM → ~1.05 USDC via Soroswap (live)"_, with a minimum
         amount under it.
   - **Screenshot** `T1-2-swap-quote` — the Swap settings, showing the router and the live quote.
4. Click **DEPLOY**. You're taken to **Review & deploy**.
   - [ ] A **TESTNET** chip is shown.
   - [ ] The page says how many contracts it will create, and shows the swap quote again.
   - **Screenshot** `T1-3-review-deploy` — the review page, with the TESTNET chip in shot.
5. Click **DEPLOY TO TESTNET**. Freighter pops up — check it says testnet, then **sign**.
   - [ ] A "Contract deployed" message appears and you're taken to the deployment page.
   - [ ] Within about a minute the status becomes **ACTIVE** and a QR code appears.
   - **Screenshot** `T1-4-deployment-active` — the deployment page once it reads ACTIVE.
6. **Bookmark this page.** Click **OPEN TRIGGER PAGE**.
7. Enter **10** as the amount, click **CONFIRM AMOUNT**, then **CONNECT WALLET & TRIGGER**. Sign
   in Freighter (with your **Main** account).
   - [ ] You see progress messages ending in a success message.
8. Go back to the deployment page and watch the live event feed.
   - [ ] A **RECEIVE** row for 10 XLM appears.
   - [ ] A **PAYOUT** row for the swap shows amount in (XLM) and amount out (USDC), and the USDC
         amount is close to the quote from step 3.
   - [ ] On stellar.expert, the trigger transaction shows a Soroswap **swap**.
   - **Screenshot** `T1-5-live-feed` — the feed showing the RECEIVE and PAYOUT rows together.
   - **Screenshot** `T1-6-stellar-expert` — the transaction on stellar.expert showing the swap.

> **Interview — T1.** Before you clicked **DEPLOY TO TESTNET**, what did you think was about to
> happen? And when Freighter popped up, could you tell what you were being asked to sign?

This first flow pays a shared Paiflow demo account, so you won't see the USDC yourself — T2 fixes
that.

---

### T2 — Swap into your own account

**Goal:** confirm the swapped USDC lands where you told it to.

1. Back on the dashboard, open **Swap XLM to USDC** again.
2. Click the **Pay** block and replace the recipient with **Recipient A**'s address.
   - [ ] The English Preview now shows Recipient A's address (shortened).
   - **Screenshot** `T2-1-english-preview` — the preview with Recipient A's address in it.
3. Deploy it (steps 4–5 of T1), then trigger it with **20 XLM** (steps 6–7 of T1).
   - [ ] The live feed shows RECEIVE and PAYOUT rows.
   - **Screenshot** `T2-2-live-feed` — the feed after the trigger.
4. In Freighter, switch to **Recipient A**.
   - [ ] Recipient A now holds **about 2 USDC** (close to the quote).
   - **Screenshot** `T2-3-recipient-a-usdc` — Freighter showing Recipient A's USDC balance.
5. Switch Freighter back to **Main**.

> **Interview — T2.** Before you opened Freighter to check, did you already believe the USDC had
> arrived? What made you sure, or unsure?

---

### T3 — The swap block refuses bad settings

**Goal:** check that mistakes are caught _before_ anything is deployed. You won't deploy in this
test.

Open **Swap XLM to USDC** and try each change below. After each one, check the boxes and take the
screenshot, then **undo the change** before trying the next. Every screenshot here should have the
**greyed-out DEPLOY button in shot** alongside the error — that pairing is the thing we're
checking.

- **a. Try:** set **Asset Out** to **XLM** (same as Asset In).
  - **Expected:** an error saying a swap has to exchange two different assets.
  - **Screenshot** `T3-a-same-asset`
- **b. Try:** set **Max slippage** to **0.1**.
  - **Expected:** an error saying slippage must be at least 0.3% because of Soroswap's pool fee.
  - **Screenshot** `T3-b-slippage`
- **c. Try:** set **Deadline** to **0**, then to **100000**.
  - **Expected:** the field refuses the value (the allowed range is 1–86,400 seconds).
  - **Screenshot** `T3-c-deadline`
- **d. Try:** delete the connection between **Swap** and **Pay**.
  - **Expected:** an error saying a swap needs one next step.
  - **Screenshot** `T3-d-swap-no-next-step`
- **e. Try:** drag in a second **Pay** block and connect **Swap** to it too.
  - **Expected:** an error saying a swap sends its output to only one next step.
  - **Screenshot** `T3-e-swap-two-outputs`

For every row:

- [ ] The error is easy to understand and says how to fix it.
- [ ] **DEPLOY** is greyed out while the error is there.
- [ ] The error goes away once you undo the change.

> **Interview — T3.** Were those error messages enough to fix the problem on your own, without
> asking anyone? Which one was clearest, and which one left you guessing?

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
   - **Screenshot** `T4-1-english-preview` — the preview for the finished flow.
5. Deploy it and trigger it with **5 XLM**.
   - [ ] Live feed shows RECEIVE then PAYOUT.
   - [ ] Recipient B's XLM balance in Freighter went up by 5.
   - **Screenshot** `T4-2-live-feed` — the feed showing both rows.
   - **Screenshot** `T4-3-recipient-b-plus-5` — Freighter showing Recipient B's new balance.
6. Open the flow again, change Pay to **Send full amount**, deploy, and trigger with **12 XLM**.
   - [ ] Recipient B's balance went up by 12.
   - **Screenshot** `T4-4-recipient-b-plus-12` — Freighter showing the balance after this trigger.

> **Interview — T4.** That's the first flow you built from scratch. Where did you hesitate, and
> what were you unsure about when you did?

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
   - **Screenshot** `T5-1-allocation-70-30` — the allocation bar and the English Preview together.
4. Deploy and trigger with **10 XLM**.
   - [ ] Live feed shows RECEIVE and two PAYOUT rows.
   - [ ] Recipient A received 7 XLM and Recipient B received 3 XLM.
   - **Screenshot** `T5-2-live-feed` — the feed showing the RECEIVE and both PAYOUT rows.
   - **Screenshot** `T5-3-balances` — Freighter balances for Recipient A and Recipient B.

**Now try to break it** (no need to deploy — just check the error, screenshot it, then undo):

- **a. Try:** change 30% to **20%**.
  - **Expected:** an error saying the percentages don't add up to 100%.
  - **Screenshot** `T5-a-percent-mismatch`
- **b. Try:** set both recipients to **Recipient A**'s address.
  - **Expected:** an error about a duplicate address.
  - **Screenshot** `T5-b-duplicate-address`
- **c. Try:** leave a recipient address empty, or type `hello`.
  - **Expected:** the field is highlighted as invalid.
  - **Screenshot** `T5-c-invalid-address`

- [ ] Each error is clear, and DEPLOY stays greyed out until you undo it.

> **Interview — T5.** Did you read the English Preview before deploying this one? Did it match the
> flow you thought you'd built?

---

### T6 — Split USDC (uses the USDC from T2)

**Goal:** the same split, with a token instead of XLM, and a recipient that can't accept it.

1. **NEW FLOW** → **T6 USDC split**. Keep the example's **On Receive (USDC)** → **Split (USDC)**.
2. Replace the three recipients with a single one: **Recipient A**, **100%**.
3. Deploy with **Main** as usual.
4. Open the trigger page. **Switch Freighter to Recipient A** (it holds the USDC from T2), enter
   **1**, and trigger.
   - [ ] Live feed shows RECEIVE 1 USDC and a PAYOUT of 1 USDC.
   - **Screenshot** `T6-1-live-feed` — the feed showing both rows.
5. Now change the flow so the single recipient is **Recipient B** (no USDC trustline), deploy, and
   trigger with **1 USDC** from Recipient A again.
   - [ ] The trigger is refused **before** you're charged, with a message you can make sense of.
   - [ ] Recipient A still has its USDC.
   - **Screenshot** `T6-2-trustline-refusal` — the refusal message in full. This is the whole point
     of the test, so please make sure the wording is readable.
   - **Screenshot** `T6-3-recipient-a-balance` — Freighter showing Recipient A's USDC untouched.

Switch Freighter back to **Main** when you're done.

> **Interview — T6.** The payment was refused. From the message alone, did you understand why, and
> did you know what you'd need to do to fix it?

---

### T7 — Free exploration (10 minutes)

Build any flow you like using **On Receive**, **Pay**, **Split** and **Swap** — for example
receive XLM → swap to USDC → split to two accounts that both have a USDC trustline. Deploy it,
trigger it, and tell us what felt confusing, slow or surprising. There are no wrong answers here.

- **Screenshot** `T7-1-canvas` — the flow you built.
- **Screenshot** `T7-2-english-preview` — its English Preview.
- **Screenshot** `T7-3-live-feed` — the feed after you trigger it.
- **Screenshot** anything that confused or surprised you, named however you like.

This is the test we learn the most from, so keep narrating on the recording even if nothing
breaks.

> **Interview — T7.** What did you set out to build? Did you get it working — and if not, what
> stopped you? Was there a block or an option you went looking for and couldn't find?

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
- **Loom stopped recording after 5 minutes.**
  **Try:** your account is still on the free Starter plan — check the Business + AI trial actually
  started ([step 1.5](#15-set-up-loom-and-prepare-to-record)). Keep the part you recorded and
  carry on in a new video; send us both links.

---

## 8. Reporting bugs and sending in your artifacts

### 8.1 Reporting a bug

Report bugs as you hit them with the
**[bug report form](https://forms.gle/c7AmbU61XbGpCPVXA)** — one form per bug, please.

It helps to have these ready before you open it:

- the test and step you were on (e.g. T5, step 4);
- the exact error message, if there was one;
- the deployment page URL, and the transaction link on stellar.expert if you have one;
- **a screenshot** — please always attach one.

Bug reports are separate from your three artifacts. Filing them as you go doesn't replace the
hand-in below, and filing none doesn't count against you.

### 8.2 Sending in your three artifacts

Once you've finished T7 and answered the [closing questions](#9-closing-interview-questions), send
everything in one go through the **[submission form](https://forms.gle/hdmpGNwUi6oh6stv6)**.

Have these ready before you open it:

- **Your Loom link.** One link covering T1 to T7, or every link if you recorded in parts. Check the
  share setting allows anyone with the link to view it — we can't watch a private video.
- **Your screenshots, zipped.** Put the whole folder into a single archive, something like
  `paiflow-alpha-yourname.zip`. The form takes one file here, so it needs to be a single zip
  rather than loose images.
- **Your answers file.** `answers-<yourname>.txt` or a doc — whichever you used.
- **A Google account.** The form has file uploads, and Google Forms requires every respondent to be
  signed in for those — there's no way for us to switch that off.

---

## 9. Closing interview questions

Answer these in your answers file once you've finished T7 — and say them out loud on the recording
too, while it's still running. Take your time; these are the ones we read most carefully.

1. **In your own words, what does Paiflow do?** Imagine explaining it to a colleague who's never
   seen it.
2. **Would you trust Paiflow with real money today?** If not, what specifically would have to
   change first?
3. **On a scale of 0 to 10, how likely are you to recommend Paiflow to someone who needs
   programmable payouts?** Give the number, then say why that number and not one higher.
4. **What did you like most?**
5. **What should we fix or improve first?**
6. **What one feature would make Paiflow significantly more useful to you?**
7. **How comfortable were you with blockchain and smart contracts before today, and did anything
   in this session change that?**
8. **Was there anything you expected to find and didn't?**
9. **May we follow up with you?** If yes, leave an email address.

---

## 10. Your incentive

You're eligible for **₱500** once we've received all three artifacts:

- [ ] Your **Loom recording** link
- [ ] Your **screenshots**, zipped
- [ ] Your **answers file**

If something broke and you genuinely couldn't finish a test, still send all three — write down what
happened in your answers file and it still counts. A run that fails honestly is useful to us. What
doesn't count is a missing artifact.

We'll arrange the payment details with you directly once your artifacts are in.

Thank you — genuinely. An hour and a half of somebody's real attention is the most valuable thing
we get at this stage.

---

## Appendix: answers file template

Copy everything between the lines into a text file, save it as `answers-<yourname>.txt`, and fill
it in as you work through the guide.

```text
PAIFLOW ALPHA — ANSWERS
Name:
Date:

== ABOUT YOU (fill in before you start) ==
1. What best describes your role?
   (fintech/DeFi founder or PM · software engineer · SMB operator or finance manager ·
    freelancer/creator · crypto-native user · other)
   >

2. What made you interested in trying Paiflow?
   >

== QUICK RATINGS (fill in at the end, 1 = poor, 5 = excellent) ==
How easy was it to understand what Paiflow does at first glance?   [ ]
How intuitive was the drag-and-drop canvas?                        [ ]
How smooth was connecting your wallet and deploying?               [ ]
How trustworthy does Paiflow feel for real money?                  [ ]

== DURING THE TESTS ==
T1 — Before you clicked DEPLOY TO TESTNET, what did you think was about to happen?
     Could you tell what Freighter was asking you to sign?
   >

T2 — Before checking Freighter, did you already believe the USDC had arrived?
     What made you sure or unsure?
   >

T3 — Were the error messages enough to fix things on your own?
     Clearest one? Most confusing one?
   >

T4 — First flow you built from scratch. Where did you hesitate?
   >

T5 — Did you read the English Preview before deploying? Did it match what you'd built?
   >

T6 — The payment was refused. Did you understand why, and what to do next?
   >

T7 — What did you set out to build? Did it work? What was missing?
   >

== CLOSING QUESTIONS ==
1. In your own words, what does Paiflow do?
   >

2. Would you trust Paiflow with real money today? What would have to change?
   >

3. 0-10, how likely are you to recommend Paiflow?   [ ]
   Why that number, and not one higher?
   >

4. What did you like most?
   >

5. What should we fix or improve first?
   >

6. What one feature would make Paiflow significantly more useful?
   >

7. How comfortable were you with blockchain before today? Did that change?
   >

8. Anything you expected to find and didn't?
   >

9. May we follow up? If yes, your email:
   >

== ANYTHING ELSE ==
Anything that annoyed, confused or delighted you that we didn't ask about:
   >
```
