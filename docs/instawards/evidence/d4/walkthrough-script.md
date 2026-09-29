# Technical walkthrough: script

The 3–5 minute technical demo video SOW §5.1 week 4 asks for ("Record and publish 3–5 min
technical demo video"; §6.1 "Demo video (technical walkthrough)"). It explains **how** Paiflow
works, for the Ambassador Chapter Lead and for a developer deciding whether to integrate.

It isn't the end-to-end wallet run. That one is a separate, unedited recording made by hand with
Freighter ([`e2e-run-checklist.md`](e2e-run-checklist.md)). This video is produced from screen
captures of the public app, of stellar.expert and of GitBook, plus one slide. It carries burned-in
captions and a voice-over read from the **Say** lines below.

Everything shown is real. Anything not happening live on screen is captioned with when it
happened.

**Length:** about 4:30 · **Format:** 1920×1080, 30 fps, captions burned in, voice-over.

---

## Title card (0:00–0:03)

**Picture:** "Paiflow: a visual, non-custodial payment-flow builder on Stellar. Technical
walkthrough · Stellar testnet · September 2026".

**Say:** nothing.

---

## 1. How it fits together (0:03–0:50)

**Picture:** one slide, drawn left to right:

```
Canvas flow ──▶ Validated ──▶ Server builds +     ──▶ YOUR WALLET ──▶ Factory: deploy_pipeline ──▶ Contracts run
(blocks, wires)  browser,      simulates an           signs            trigger · swapper · payer
                 server,       unsigned tx            (keys never      created and wired
                 contract                             leave it)        in ONE transaction
```

**Say:**

> Paiflow turns a payment flow you draw into Stellar smart contracts. You wire blocks on a canvas.
> The flow is checked in the browser, checked again on the server, and the contracts check again
> on chain. The server then builds and simulates the transaction, but it never holds
> your key. Your own wallet signs it. One call to Paiflow's factory contract creates every contract
> in the flow and wires each to the next, all in a single transaction. So a flow is live all at
> once, or not at all.

**Proves:** §3.10 (how it works), §3.9 (non-custodial, validated flows).

---

## 2. What a swap does on chain (0:50–1:50)

**Picture:** stellar.expert, transaction
[`750f64c1…`](https://stellar.expert/explorer/testnet/tx/750f64c1ac2e2e0085ffcc94aea1f15e2e3d5dcfc961625a92bb0cbf951db903).
Scroll slowly down the invocation tree and highlight each line as it's named:
`deposit` → `execute_step` (swapper) → `swap_exact_tokens_for_tokens` (Soroswap router) →
`transfer` → `execute_step` (payer) → `transfer` to the recipient.

**Caption (top):** "Recorded 28 Sep · deployment 516255e1 · 10 XLM → 1.0565359 USDC".

**Say:**

> Here is one of those flows running, on Stellar testnet. Someone deposits ten XLM into the
> flow's trigger contract. The trigger hands it to the swapper, and the swapper calls Soroswap's
> router, a real decentralised exchange, which swaps the XLM for USDC. The swapper passes the USDC
> to the payer, and the payer sends it to the recipient: one point zero five six five USDC.
>
> Before it swaps, the swapper sets a minimum it will accept: the pool's current price, less the
> flow's maximum slippage. If the pool can't meet that, the whole transaction reverts, and no money
> moves anywhere. Every step you just saw happened in one transaction.

**Proves:** D1, a real swap through the Soroswap router with its tx hash (§6.1 D1).

---

## 3. Building it, with guard rails (1:50–2:40)

**Picture:** the builder on paiflow.xyz, in a no-account sandbox session, on a flow already drawn:
**On Receive** (XLM) → **Swap** → **Pay** (USDC).

1. Open the Swap panel. Set **Asset Out** to XLM: the same-asset error appears under the field.
   Set it back to USDC.
2. Type **0.1** into **Max slippage (%)** and leave the field: it's raised to the 0.3% floor, and
   the live preview warns that at this setting every swap would revert. Set it to **1**: the
   warning clears.
3. Type **10** into **You send**: the live quote from the Soroswap pool.
4. Open **Advanced**: the router is pinned to Soroswap's real contract, linked to stellar.expert.
5. Close the panel: the plain-English preview above the canvas.
6. Press **DEPLOY**: the review page, with the **TESTNET** chip. Stop there, before any signing.

**Caption (top):** "paiflow.xyz · a no-account sandbox session". At 6: "Signing is shown in the
separate end-to-end recording".

**Say:**

> This is the builder, with a flow already drawn: receive, swap, pay. The swap block's settings
> are built from shared inputs: an asset picker, a percentage, an amount and a pinned address.
> They catch mistakes where you make them. Swapping an asset for itself is an error on the spot.
> Slippage can't go below Soroswap's zero point three percent pool fee, and the live preview warns
> when a setting would make every swap revert. The router isn't a choice you can get wrong: it's
> pinned to Soroswap's own contract. The preview reads the flow back in plain English, and Deploy
> opens a review page, clearly marked testnet, before anything reaches your wallet.

**Proves:** D3, the Swapper panel on shared input primitives with consistent validation (§6.1 D3).

---

## 4. The developer API (2:40–3:50)

**Picture:** a terminal replaying the 28 Sep `/api/v1` run on deployment `516255e1`, with the
commands typed and the real responses printed from
[`03-e2e-api-execute.json`](03-e2e-api-execute.json):

1. `POST …/execute` → the prepared, unsigned envelope. Then decoded: `deposit(from, 100000000)` on
   the trigger contract, one `transfer` authorised.
2. `stellar tx sign` → signed on the partner's side.
3. `POST …/execute/submit` → `"status": "SUCCESS"`.
4. `GET …/events` → `deposit`, `swap`, `pay`.

Then stellar.expert, transaction
[`56929533…`](https://stellar.expert/explorer/testnet/tx/569295336b906aaeb9538c519bd4d5f7020671a945ac39908fe46d2651803ae6):
the same router call.

**Caption (top):** "Replay of the 28 Sep API run · token shown by its prefix only".

**Say:**

> A partner's backend can run the same flow without a browser. The flow's owner creates a token
> for this one deployment. It can't reach any other flow, and it can't move money on its own. With
> it, the partner asks Paiflow to prepare a deposit. Paiflow builds and simulates the transaction
> and returns it unsigned. Decoded, it's a single call: deposit ten XLM, from the partner's
> account, into this flow, and nothing else. The partner signs it with its own key and submits it.
> Paiflow relays it, waits for the result, and the events show the deposit, the swap and the
> payout. On the explorer it's the same router call as before, triggered this time by an API.

**Proves:** D2, an authenticated API execute of the Swapper flow on testnet with its tx hash
(§6.1 D2).

---

## 5. Checking it yourself (3:50–4:27)

**Picture:** GitBook, [paiflow.gitbook.io/paiflow-docs](https://paiflow.gitbook.io/paiflow-docs):
the transaction list (scroll), the integration guide (scroll to the decoded envelope), then the
handoff page.

**Say:**

> Everything here can be checked without an account. The transaction list links every swap the public app
> has run, and the deployment behind it, to the explorer. The integration guide walks through what
> you've just seen, with the real payloads decoded. And the handoff page maps each deliverable to
> its evidence. Paiflow: draw the flow, sign it with your own wallet, and let the contracts run.

**Proves:** §6.1 validation package (usage guide, tx list).

---

## End card (4:27–4:30)

**Picture:** three lines:
`paiflow.xyz` · `paiflow.gitbook.io/paiflow-docs` · `github.com/artisam-paiflow/paiflow`.

**Say:** nothing.

---

## Recording the voice-over

After the silent cut is approved, you get a cue sheet: each **Say** paragraph with the time it
starts. Read it in one take while the silent cut plays, into a phone or laptop mic in a quiet
room, and send the file (WAV or MP3). Stumbles are fine; I cut them out and fit each paragraph to
its segment. Aim for a relaxed pace. If a paragraph runs long, I adjust the picture to the voice,
not the other way round.
