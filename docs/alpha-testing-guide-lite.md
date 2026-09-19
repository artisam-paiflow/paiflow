# Paiflow quick test

Thanks for helping test Paiflow. This takes **about 20 minutes**. You don't need to know how to
code, you don't need a crypto wallet, and you don't record anything.

**What you do:** four short tasks, answering a survey as you go. A completed survey makes you
eligible for the **₱125** incentive. An [optional bonus](#optional-bonus-75) at the end adds
**₱75**.

**What you need:** a laptop or desktop with **Chrome** or **Brave**, your phone, and the username
and password we sent you.

**Open the survey now, in its own tab, and keep it open:** <https://forms.gle/s5D1R8xVnN6X4N338>. Each
task tells you when to switch to it. Don't close that tab until you've pressed Submit — an
unfinished survey isn't saved.

> **We are testing Paiflow, not you.** Most of this guide deliberately doesn't tell you where to
> click. If something is confusing, that is exactly what we need to hear — write it down and move
> on. There are no wrong answers.

> **Everything here runs on Stellar testnet.** Testnet money is free and worthless. You will never
> be asked for real funds, a card, or a seed phrase. If anything ever asks you for one, stop and
> tell us.

> **What we record.** If any of it concerns you, contact us before you start.
>
> - **Usage analytics, sent to PostHog:** which buttons and screens you reach, and where errors
>   appear. Events are tied to your test account's internal ID, not your name.
> - **Your screen is not recorded**, and neither are your face or voice.
> - **Your survey answers** are stored in Google Forms and read by the Paiflow team.
> - **Only if you do the optional bonus:** the public address of the wallet you connect, the
>   transaction hash, and your IP address at the moment you connect are recorded and linked to your
>   test account. We never see or store a secret key.

---

## B1 — First impression (2 minutes)

1. On your laptop, open [beta.paiflow.xyz](https://beta.paiflow.xyz).
2. Look at the page for **ten seconds. Don't scroll, don't click.**
3. Switch to the survey and answer **section B1** now, before you look at anything else.

---

## Sign in (1 minute)

1. Back on the page, click **Build a flow**.
2. Enter your **Username** and **Password**, then click **SIGN IN**.

- [ ] You land on your dashboard ("Your flows.").

---

## B2 — Read a flow (3 minutes)

1. Click **NEW FLOW**, name it **Shop**, and click **CREATE FLOW**. The builder opens with an
   example flow already on the canvas.
2. **Don't change anything yet.** Look at the screen and work out: when money arrives, who gets
   paid, and how much each?
3. Answer survey **section B2**.

---

## B3 — Make it yours (8 minutes)

Here is the situation. There are no steps — do it however makes sense to you.

> You run a small shop with a business partner. Customers pay you in **XLM**. Whenever a payment
> arrives, **60% should go to you and 40% to your partner**. Nobody else gets a share.

Change the **Shop** flow so it does exactly that. Use these two addresses:

| Who          | Address                                                    |
| ------------ | ---------------------------------------------------------- |
| You          | `GAS4J4X5VR7TYWGD5CLVIFMIHDAOAJZYAOA7KPVHKYS5XWSTMUZBC25K` |
| Your partner | `GBPL3PMLOWFYARP6OL2H6HIFMLS5Q7ZWUMNKTIDPBK4REPXLZOMY2XSP` |

**You're done when** the **DEPLOY** button at the top is no longer greyed out. Then:

1. Click **DEPLOY**. A review page opens.
2. Read the review page. **Stop there — do not press DEPLOY TO TESTNET.**
3. Answer survey **section B3**.

Give yourself eight minutes. If you aren't there by then, stop anyway and tell us where you got
stuck — that is a useful result, and it doesn't affect your incentive.

<details>
<summary><strong>Stuck for more than three minutes? Open this hint.</strong> The survey asks whether you did.</summary>

- Click a block on the canvas to open its settings on the right.
- Both blocks have an **Asset** setting. The example uses USDC; the shop is paid in XLM.
- The **Split** block lists its recipients. Each one has an address, a share and a label, and the
  shares must add up to 100%.
- The **Errors** button at the top lists whatever is still wrong.

</details>

---

## B4 — The customer's side, on your phone (3 minutes)

A flow like yours gives you a page to send to the people who pay you. Here is one we made earlier.

1. **On your phone**, open: <https://beta.app.paiflow.xyz/trigger/7ed55a66-6fa3-4f31-be3c-b2e562b38cc7>
2. Look at it as if a shop had just sent it to you. **Don't pay anything** and don't install
   anything.
3. Still on your phone, open: <https://beta.app.paiflow.xyz/deployments/7ed55a66-6fa3-4f31-be3c-b2e562b38cc7/embed>
   Scroll down to **Live events**. Ignore the red "Authentication required" box and the missing QR
   image on this page — both are already on our list.
4. Answer survey **section B4**.

---

## Finish the survey (5 minutes)

Answer the last section, **About you and overall**, and press **Submit**.

One submitted survey is what makes you eligible for the **₱125** incentive. An honest "I couldn't
finish B3" counts exactly the same as a perfect run. We'll contact you on the name you enter in
the survey.

Please leave everything else in the app alone: other block types, **Ask AI**, **Dev mode**, and
the Profile page aren't part of this round.

**Thank you.** Twenty minutes of somebody's real attention is the most useful thing we get.

---

## Optional bonus (+₱75)

About 25 more minutes. You install a test wallet, put your Shop flow on the Stellar test network,
and send it one payment. Do this **after** submitting the survey — you'll send us one link at the
end.

### 1. Install Freighter and get free testnet XLM

1. Install the [Freighter wallet extension](https://www.freighter.app/) in Chrome or Brave and pin
   it to your toolbar.
2. Open Freighter → **Create new wallet**. Write down the recovery phrase somewhere safe.
3. In Freighter, open the network menu at the top and choose **Testnet**.
4. Copy your address (it starts with `G`) and open this link in a new tab, replacing
   `YOUR_ADDRESS`: `https://friendbot.stellar.org/?addr=YOUR_ADDRESS`

- [ ] Freighter shows **Testnet** at the top, and a balance of 10,000 XLM.

### 2. Deploy the Shop flow

1. Open your **Shop** flow and click **DEPLOY**, then **DEPLOY TO TESTNET** on the review page.
2. Freighter pops up — check it says testnet, then **sign**.

- [ ] A "Contract deployed" message appears and you're taken to the deployment page.
- [ ] Within about a minute the status becomes **ACTIVE** and a QR code appears.

### 3. Pay it once

1. On the deployment page, click **OPEN TRIGGER PAGE**.
2. Enter **10** as the amount, click **CONFIRM AMOUNT**, then **CONNECT WALLET & TRIGGER**, and
   sign in Freighter.
3. Go back to the deployment page and watch the live feed.

- [ ] The live feed shows one RECEIVE row and two PAYOUT rows: 6 XLM and 4 XLM.

### 4. Send us the link

Copy the address of your **deployment page** from the browser's address bar and send it to us by
replying to the message this guide came in. That link is what makes you eligible for the extra
**₱75**.

**Already on our list, so no need to report:** the trigger page can report a failure even though
the payment went through (check the live feed first); the review page lists several wallets, but
only Freighter works for deploying right now; and the live feed can lag a few seconds to a minute
behind the chain.
