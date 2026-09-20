# Paiflow alpha testing guide

Thanks for helping test Paiflow. This guide takes **about 70 minutes** end to end: around 20 minutes
of setup, about 45 minutes of test cases, then the closing questions. You don't need to know how to
code.

**You'll send us three things at the end.** They're what makes you eligible for the **₱650**
incentive ([section 8.2](#82-sending-in-your-three-artifacts)):

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

> **What we record during this round.** If any of it concerns you, contact us before you start.
>
> - **Usage analytics, sent to PostHog:** which buttons and screens you reach, and where errors
>   appear. Events are tied to your test account's internal ID, not your name. They never include
>   secret keys or transaction payloads, and no address is recorded as a payment recipient.
> - **Your screen and your session are not recorded by us.** The only screen recording is the Loom
>   you make yourself and send to us. It is not masked — it shows your screen, face and voice — so
>   apart from the short test clip in step 1.5, start it only once wallet setup is finished.
> - **The public address of every wallet you connect and sign with is recorded**, together with the
>   transaction hash, and linked to your test account, so we can trace a testnet transaction back
>   to the tester who made it. T5 has you sign with an account you also pay into; that address is
>   recorded the same way.
> - **Server-side logs:** each wallet connection, with your IP address, and each API token you
>   create or revoke in T6. We store only a hash of the token, never the token itself.

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
3. Repeat to create a second recipient, named **Recipient B**.
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

**Recording yourself is required this round** — face, voice and screen together. If being on
camera is a problem, or you have no **Mac or Windows** machine (Loom's desktop app doesn't run on
Linux or ChromeOS), contact us before you start — the same people who sent you your test account.

1. Sign up at [loom.com](https://www.loom.com/), install the **Loom desktop app** from
   [loom.com/download](https://www.loom.com/download) and sign in to it. **Don't use the Chrome
   extension** — its camera bubble disappears whenever you switch tabs or Freighter pops up.
2. Start the **14-day free Business + AI trial**; the free Starter plan cuts every recording off at
   5 minutes. **No card is needed**, and without one there is nothing to cancel — the workspace
   drops back to Starter when the trial ends.
3. Set the recorder to **Screen + camera + mic** and **Full screen**, not a single window or tab.
   **On a Mac**, grant Loom **Screen Recording**, **Camera** and **Microphone** under System
   Settings → Privacy & Security.
4. Make a **10-second test recording**: close Freighter, start recording, switch to another tab,
   stop, and play it back. Then delete the clip.

> **Don't start the real recording yet.** Your recovery phrase was on screen in step 1.1. Start
> recording at the beginning of [section 4](#4-test-cases), once wallet setup is done.

- [ ] The Loom **desktop app** is signed in, on the trial, and set to Screen + camera + mic on your
      full screen.
- [ ] Your test recording still shows your face in the corner after you switch tabs.

### 1.6 Create your answers file

Each test case ends with an interview question, and there's a closing set at the end. You answer
them **out loud on the recording** and **in writing**, so we have something searchable next to the
video.

1. Copy the [answers file template](#appendix-answers-file-template) into a text file or a doc,
   and save it as `answers-<yourname>.txt` (or `.doc`).
2. Fill in the **About you** section now, and keep the file open in another window while you work.

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

Open **Swap XLM to USDC** and take a minute to find each of these.

- **Blocks** (left sidebar), **canvas** (centre) and **settings panel** — drag a block onto the
  canvas, drag from one block's handle to another to connect them, and click a block to open its
  settings. Select a block and press Delete to remove it.
- **English Preview** (top) — your flow written out as a sentence. **Always read it before
  deploying** — it's the plain-language check on the money.
- **Errors** button and **DEPLOY** — DEPLOY is greyed out until the flow has no errors; the Errors
  button lists every problem, and the fields at fault are highlighted.
- Changes save automatically — there is no Save button. Click the flow title to rename it, and
  leave the **Dev mode** switch **off** for every test.

A flow always starts with exactly **one trigger**. Once you have one, the other triggers grey out.

---

## 4. Test cases

> **Start your Loom recording now**, and keep it running through T1 to T7 and on into the
> [closing questions](#9-closing-interview-questions). Narrate as you go: what you're about to do,
> and what you expected to happen when it doesn't. If you have to stop partway — a break, a crash,
> the trial cutting out — just start a new recording and send us every link.

Do the tests in order — later ones reuse accounts and flows from earlier ones — and tick the boxes
as you go.

- **If a box doesn't match what you see,** take a screenshot and report it with the
  [bug report form](https://forms.gle/c7AmbU61XbGpCPVXA), unless it's a
  [known issue](#6-known-issues). Two to rule out first: the live feed can lag up to a minute behind
  the chain, and the trigger page sometimes reports a failure even though the payment went through —
  so before reporting a failed trigger, check the feed and stellar.expert.
- **Screenshots.** Your recording covers most of what we need, so there are only ten. Each is
  marked **Screenshot** with the exact name to save it under (for example `T1-2-live-feed.png`), in
  one folder that you'll zip at the end. **Win + Shift + S** on Windows, **Cmd + Shift + 4** on
  macOS.
- **Interview boxes.** Say your answer out loud, then write a line or two under that test's heading
  in your answers file. Your first reaction is what we're after, including "I have no idea".
- **To check that money really moved:** the **live event feed** on the deployment page; the
  recipient's balance in **Freighter**; and
  [stellar.expert](https://stellar.expert/explorer/testnet), which every deployment page links to.

---

### T1 — Deploy the swap flow and pay yourself

**Goal:** the core of this round. Receive XLM, swap it to USDC on a real exchange (Soroswap), and
pay it out to an account you control.

1. Open **Swap XLM to USDC**. Click the **Pay** block and replace the recipient with
   **Recipient A**'s address.
   - [ ] The **English Preview** describes receiving XLM, swapping to USDC, and paying it to
         Recipient A's address (shortened).
2. Click the **Swap** block.
   - [ ] Router shows **Soroswap (testnet)** and can't be changed.
   - [ ] A live quote appears, like _"10 XLM → ~1.05 USDC via Soroswap (live)"_, with a minimum
         amount under it.
3. Click **DEPLOY**. You're taken to **Review & deploy**.
   - [ ] A **TESTNET** chip is shown.
   - [ ] The page says how many contracts it will create, and shows the swap quote again.
   - **Screenshot** `T1-1-review-deploy` — the review page, with the TESTNET chip in shot.
4. Click **DEPLOY TO TESTNET**. Freighter pops up — check it says testnet, then **sign**.
   - [ ] A "Contract deployed" message appears and you're taken to the deployment page.
   - [ ] Within about a minute the status becomes **ACTIVE** and a QR code appears.
5. **Bookmark this page** — T6 comes back to it. Click **OPEN TRIGGER PAGE**.
6. Enter **20** as the amount, click **CONFIRM AMOUNT**, then **CONNECT WALLET & TRIGGER**. Sign
   in Freighter (with your **Main** account).
   - [ ] You see progress messages ending in a success message.
7. Go back to the deployment page and watch the live event feed.
   - [ ] A **RECEIVE** row for 20 XLM appears.
   - [ ] A **PAYOUT** row for the swap shows amount in (XLM) and amount out (USDC), close to the
         quote.
   - [ ] On stellar.expert, the trigger transaction shows a Soroswap **swap**.
   - **Screenshot** `T1-2-live-feed` — the feed showing the RECEIVE and PAYOUT rows together.
   - **Screenshot** `T1-3-stellar-expert` — the transaction on stellar.expert showing the swap.
8. In Freighter, switch to **Recipient A**, then back to **Main**.
   - [ ] Recipient A now holds **about 2 USDC**.
   - **Screenshot** `T1-4-recipient-a-usdc` — Freighter showing Recipient A's USDC balance.

> **Interview — T1.** Before you clicked **DEPLOY TO TESTNET**, what did you think was about to
> happen? When Freighter popped up, could you tell what you were being asked to sign? And before
> you checked Freighter, did you already believe the USDC had arrived?

---

### T2 — The swap block refuses bad settings

**Goal:** check that mistakes are caught _before_ anything is deployed. You won't deploy in this
test.

Open **Swap XLM to USDC**, try each change below, and **undo it** before trying the next.

| Try                                                                  | Expected                                                                  | How it's refused |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------- |
| **a.** Set **Asset Out** to **XLM** (same as Asset In)               | An error saying a swap has to exchange two different assets               | Canvas error     |
| **b.** Set **Max slippage** to **0.1**                               | Snaps back to **0.3**, the minimum; the note under the field explains why | Field refuses    |
| **c.** Set **Deadline** to **0**, then to **100000**                 | The value is refused (the allowed range is 1–86,400 seconds)              | Field refuses    |
| **d.** Delete the connection between **Swap** and **Pay**            | An error saying a swap needs one next step                                | Canvas error     |
| **e.** Drag in a second **Pay** block and connect **Swap** to it too | An error saying a swap sends its output to only one next step             | Canvas error     |

- [ ] **Canvas errors (a, d, e):** the message is easy to understand and says how to fix it,
      **DEPLOY** is greyed out while it's there, and it goes away once you undo the change.
- [ ] **Field refusals (b, c):** it's clear the value was refused and what the allowed range is.
      There's no canvas error, and DEPLOY stays available.
- **Screenshot** `T2-1-error-deploy-greyed` — row **a**'s error with the greyed-out DEPLOY button
  in the same shot.

> **Interview — T2.** Were those error messages enough to fix the problem on your own, without
> asking anyone? Which one was clearest, and which one left you guessing?

---

### T3 — Receive XLM, pay a fixed amount

**Goal:** the simplest flow — money in, money out to one person.

1. On the dashboard, click **NEW FLOW**, name it **T3 Pay**, and click **CREATE FLOW**.
2. The new flow comes with an example (receive USDC, split to Alice / Bob / Charlie). Those are
   placeholder accounts that can't receive money, so **delete both blocks**.
3. Drag in **On Receive**. In its settings, set Asset to **XLM (native)**.
4. Drag in **Pay** and connect On Receive → Pay. In Pay's settings:
   - Asset: **XLM**
   - Recipient: **Recipient B**'s address
   - Amount mode: **Fixed**, amount **5**
   - [ ] English Preview reads roughly: _when this contract receives XLM, pay 5 XLM to G…_
5. Deploy it and trigger it with **5 XLM**, the same way as T1.
   - [ ] Live feed shows RECEIVE then PAYOUT.
   - [ ] Recipient B's XLM balance in Freighter went up by 5.
   - **Screenshot** `T3-1-live-feed` — the feed showing both rows.
6. **Optional:** open the flow again, change Pay to **Send full amount**, deploy, and trigger with
   **12 XLM**.
   - [ ] Recipient B's balance went up by 12.

> **Interview — T3.** That's the first flow you built from scratch. Where did you hesitate, and
> what were you unsure about when you did?

---

### T4 — Receive XLM, split it between two people

**Goal:** fan one payment out to several recipients.

1. **NEW FLOW** → name it **T4 Split**. Keep the example's two blocks this time.
2. Click **On Receive** and change Asset to **XLM (native)**. Click **Split** and change its Asset
   to **XLM**.
3. In Split, use **Percentage** mode with exactly two recipients:
   - Recipient A — **70%**, label `A`
   - Recipient B — **30%**, label `B`
   - [ ] The allocation bar is full, and the English Preview shows 70% and 30%.
4. Deploy and trigger with **10 XLM**.
   - [ ] Live feed shows RECEIVE and two PAYOUT rows.
   - [ ] Recipient A received 7 XLM and Recipient B received 3 XLM.
   - **Screenshot** `T4-1-live-feed` — the feed showing the RECEIVE and both PAYOUT rows.

**Now try to break it** — no need to deploy; check the error, then undo:

| Try                                                     | Expected                                             |
| ------------------------------------------------------- | ---------------------------------------------------- |
| **a.** Change 30% to **20%**                            | An error saying the percentages don't add up to 100% |
| **b.** Set both recipients to **Recipient A**'s address | An error about a duplicate address                   |
| **c.** Leave a recipient address empty, or type `hello` | The field is highlighted as invalid                  |

- [ ] Each error is clear, and DEPLOY stays greyed out until you undo it.

> **Interview — T4.** Did you read the English Preview before deploying this one? Did it match the
> flow you thought you'd built?

---

### T5 — Split USDC (uses the USDC from T1)

**Goal:** the same split, with a token instead of XLM, and a recipient that can't accept it.

1. **NEW FLOW** → **T5 USDC split**. Keep the example's **On Receive (USDC)** → **Split (USDC)**.
2. Replace the three recipients with a single one: **Recipient A**, **100%**.
3. Deploy with **Main** as usual.
4. Open the trigger page. **Switch Freighter to Recipient A** (it holds the USDC from T1), enter
   **1**, and trigger.
   - [ ] Live feed shows RECEIVE 1 USDC and a PAYOUT of 1 USDC.
5. Now change the flow so the single recipient is **Recipient B** (no USDC trustline), deploy, and
   trigger with **1 USDC** from Recipient A again.
   - [ ] The trigger is refused **before** you're charged, with a message you can make sense of.
   - [ ] Recipient A still has its USDC.
   - **Screenshot** `T5-1-trustline-refusal` — the refusal message in full. This is the whole point
     of the test, so please make sure the wording is readable.

Switch Freighter back to **Main** when you're done.

> **Interview — T5.** The payment was refused. From the message alone, did you understand why, and
> did you know what you'd need to do to fix it?

---

### T6 — Read your flow's events through the developer API

**Goal:** a deployed flow can also be driven by another program. Here you create an API token for
the T1 deployment, use it to read that flow's events, then revoke it. You'll paste one command into
a terminal — no coding.

1. Open the **T1 deployment page** you bookmarked and scroll to the **API access** panel. Set
   Label to `alpha` and Expires to **30 days**, then click **CREATE TOKEN**.
   - [ ] A token starting with `pfk_` appears, marked _"COPY THIS TOKEN NOW. IT WILL NOT BE SHOWN
         AGAIN."_ Copy it into your note.
   - Ignore the **PREPARE AN EXECUTION** command under it — running a flow through the API needs
     a signing step that isn't part of this round.
2. Build the events address from the deployment page's own address. If the page is
   `https://…/deployments/1234abcd-…`, the events address is
   `https://…/api/v1/deployments/1234abcd-…/events` — same start, `/api/v1` added before
   `/deployments`, `/events` added at the end.
3. Open **Terminal** (macOS) or **Command Prompt** (Windows) and run this on one line, with your
   token and events address pasted in. On Windows, type `curl.exe` instead of `curl`.

   ```text
   curl -H "Authorization: Bearer YOUR_TOKEN" "YOUR_EVENTS_ADDRESS"
   ```

   - [ ] Text comes back that includes `"kind":"RECEIVE"` and `"kind":"PAYOUT"`, with the same
         amounts as T1's live feed.
   - **Screenshot** `T6-1-api-events` — the terminal showing the command's output.
   - [ ] Reload the deployment page: the token's **LAST USED** no longer says NEVER.

4. Click **REVOKE** next to the token and confirm. Run the same command again.
   - [ ] The token is marked **REVOKED**, and the command now returns an `UNAUTHENTICATED` error
         instead of events.

Your token was visible on the recording; that's fine, because step 4 just made it useless.
Developers can read more in the [developer API guide](api/README.md).

> **Interview — T6.** In your own words, what does that token let someone do — and what can't they
> do with it? Would you be comfortable handing one to a developer?

---

### T7 — Free exploration (10 minutes)

Build any flow you like using **On Receive**, **Pay**, **Split** and **Swap** — for example
receive XLM → swap to USDC → split it between Recipient A and a friend's account. Any account that
receives USDC needs a USDC trustline first (step 1.4), otherwise the payout is refused exactly as
in T5. Deploy it, trigger it, and tell us what felt confusing, slow or surprising. There are no
wrong answers here.

- **Screenshot** `T7-1-canvas` — the flow you built.
- **Screenshot** anything that confused or surprised you, named however you like.

This is the test we learn the most from, so keep narrating on the recording even if nothing
breaks.

> **Interview — T7.** What did you set out to build? Did you get it working — and if not, what
> stopped you? Was there a block or an option you went looking for and couldn't find?

---

## 5. What not to test in this round

Build with **On Receive**, **Pay**, **Split** and **Swap** only, keep payouts on **Crypto
(wallet)**, leave **Dev mode** off, and use desktop **Freighter**. Everything else you may see in
the app isn't ready for alpha testing — **please don't use it, and don't report problems with
it**: the On Schedule, HTTP Webhook, Subscription and Payroll triggers; the Condition and Email
Notify blocks; Fiat / bank payouts and Sender KYC; Ask AI (chat and voice); Passkeys on the Profile
page; and phones or mobile wallets (LOBSTR, xBull).

---

## 6. Known issues

Already on our list — no need to report these.

- **The trigger page can report a failure even though the payment went through.** Check the live
  feed and stellar.expert first; only report it if the money really didn't move.
- **The trigger page doesn't keep a record of a successful trigger** after the message
  disappears. Use the deployment page's live feed instead.
- **The review page lists several wallets** (Freighter, Albedo, xBull, LOBSTR, Hana), but only
  **Freighter** works for deploying right now.
- **The live feed can lag** a few seconds to a minute behind the chain.

---

## 7. Troubleshooting

| You see                                                                  | Try                                                                                                                                                                            |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| _"Account … is not funded"_ or _"Minimum 2 XLM required"_                | Fund the account with Friendbot ([step 1.2](#12-fund-your-wallet-with-free-testnet-xlm)).                                                                                      |
| A Freighter network error, or the signature fails                        | Check Freighter is on **Testnet**, then try again.                                                                                                                             |
| No Freighter pop-up                                                      | Click the Freighter icon in your toolbar — the request may be waiting there.                                                                                                   |
| An error mentioning a **trustline**                                      | The account receiving USDC hasn't added USDC yet ([step 1.4](#14-let-recipient-a-hold-usdc)).                                                                                  |
| DEPLOY greyed out                                                        | Click the **Errors** button above the canvas and fix each item.                                                                                                                |
| _"Invalid username or password"_                                         | Check both, including capital letters. After 5 wrong tries the account locks for 15 minutes.                                                                                   |
| You forgot your password                                                 | There's no reset link yet. Contact us — the same people who sent you your test account.                                                                                        |
| T6: `UNAUTHENTICATED` on the **first** call                              | Check the whole token was pasted, with one space after `Bearer`, and that the address is for the deployment you made the token on.                                             |
| Loom stopped after 5 minutes, or your face vanishes when you switch tabs | The trial didn't start, or you're on the Chrome extension ([step 1.5](#15-set-up-loom-and-prepare-to-record)). Fix it, record the rest in a new video, and send us every link. |
| Loom records a black screen, or no camera (macOS)                        | Tick Loom under **Screen Recording**, **Camera** and **Microphone** in System Settings → Privacy & Security, then quit and reopen Loom.                                        |

---

## 8. Reporting bugs and sending in your artifacts

### 8.1 Reporting a bug

Report bugs as you hit them with the
**[bug report form](https://forms.gle/c7AmbU61XbGpCPVXA)** — one form per bug, please. Have ready:
the test and step you were on (e.g. T4, step 4); the exact error message; the deployment page URL,
and the stellar.expert link if you have one; and **a screenshot** — please always attach one.

Bug reports are separate from your three artifacts. Filing them doesn't replace the hand-in below,
and filing none doesn't count against you.

### 8.2 Sending in your three artifacts

Once you've finished T7 and answered the [closing questions](#9-closing-interview-questions), send
everything in one go through the **[submission form](https://forms.gle/hdmpGNwUi6oh6stv6)**. You're
eligible for the **₱650** incentive once we've received all three:

- [ ] **Your Loom link** — one link covering T1 to T7 and the closing questions, or every link if
      you recorded in parts. Check the share setting lets anyone with the link view it.
- [ ] **Your screenshots, zipped** into a single archive, something like
      `paiflow-alpha-yourname.zip` — the form takes one file here.
- [ ] **Your answers file** — `answers-<yourname>.txt` or a doc.

You'll need to be signed in to a **Google account**: the form has file uploads, and Google Forms
requires it.

If something broke and you genuinely couldn't finish a test, still send all three — write down what
happened in your answers file and it still counts. A run that fails honestly is useful to us. What
doesn't count is a missing artifact. We'll arrange the payment details with you directly once your
artifacts are in.

---

## 9. Closing interview questions

Once you've finished T7, and **while the recording is still running**, work through the **CLOSING
QUESTIONS** block of your answers file: say each answer out loud, then write it down. Take your
time; these are the ones we read most carefully. Then fill in the **QUICK RATINGS** block near the
top of the file — the four 1–5 scores. It's easy to miss, and it's the only place we ask for them.

Thank you — genuinely. An hour of somebody's real attention is the most valuable thing we get at
this stage.

---

## Appendix: answers file template

Copy everything below into a text file, save it as `answers-<yourname>.txt`, and fill
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

== DURING THE TESTS (answer each test's Interview box from the guide) ==
T1 >

T2 >

T3 >

T4 >

T5 >

T6 >

T7 >

== CLOSING QUESTIONS ==
1. In your own words, what does Paiflow do? Imagine explaining it to a colleague
   who's never seen it.
   >

2. Would you trust Paiflow with real money today? If not, what specifically would
   have to change first?
   >

3. 0-10, how likely are you to recommend Paiflow to someone who needs
   programmable payouts?   [ ]
   Why that number, and not one higher?
   >

4. What did you like most?
   >

5. What should we fix or improve first?
   >

6. What one feature would make Paiflow significantly more useful to you?
   >

7. How comfortable were you with blockchain and smart contracts before today,
   and did anything in this session change that?
   >

8. Was there anything you expected to find and didn't?
   >

9. May we follow up with you? If yes, your email:
   >

== ANYTHING ELSE ==
Anything that annoyed, confused or delighted you that we didn't ask about:
   >
```
