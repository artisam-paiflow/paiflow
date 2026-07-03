---
marp: true
theme: default
class: invert
size: 16:9
paginate: true
title: Paiflow — Investor Pitch (Draft)
description: Zaps for Payments. Powered by Stellar.
style: |
  :root {
    --pr-bg: #0e0e0e;
    --pr-surface: #1c1b1b;
    --pr-fg: #e5e2e1;
    --pr-muted: #ac878f;
    --pr-pink: #ffb1c4;
    --pr-hot: #ff007f;
    --pr-blue: #98cbff;
    --pr-amber: #ffba20;
  }
  section {
    background-color: var(--pr-bg);
    color: var(--pr-fg);
    font-family: "Geist", "Inter", system-ui, sans-serif;
    background-image:
      linear-gradient(to right, rgba(0,162,253,0.04) 1px, transparent 1px),
      linear-gradient(to bottom, rgba(0,162,253,0.04) 1px, transparent 1px);
    background-size: 32px 32px, 32px 32px;
    padding: 64px 80px;
  }
  section.title {
    background-image:
      radial-gradient(circle at 30% 40%, rgba(255,0,127,0.18) 0%, transparent 60%),
      radial-gradient(circle at 80% 70%, rgba(0,162,253,0.12) 0%, transparent 60%),
      linear-gradient(to right, rgba(0,162,253,0.04) 1px, transparent 1px),
      linear-gradient(to bottom, rgba(0,162,253,0.04) 1px, transparent 1px);
    background-size: 100% 100%, 100% 100%, 32px 32px, 32px 32px;
  }
  h1, h2, h3 {
    font-family: "Space Grotesk", "Geist", sans-serif;
    color: var(--pr-fg);
    letter-spacing: -0.02em;
    line-height: 1.1;
  }
  h1 { font-size: 64px; font-weight: 700; }
  h2 { font-size: 44px; font-weight: 600; margin-bottom: 24px; }
  h3 { font-size: 28px; font-weight: 600; color: var(--pr-pink); }
  .eyebrow {
    font-family: "JetBrains Mono", ui-monospace, monospace;
    font-size: 14px;
    color: var(--pr-pink);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    margin-bottom: 12px;
  }
  .tagline {
    font-family: "JetBrains Mono", ui-monospace, monospace;
    font-size: 20px;
    color: var(--pr-blue);
    letter-spacing: 0.04em;
  }
  .mono, code {
    font-family: "JetBrains Mono", ui-monospace, monospace;
    color: var(--pr-blue);
  }
  .pink { color: var(--pr-pink); font-weight: 600; }
  .hot { color: var(--pr-hot); font-weight: 700; }
  .amber { color: var(--pr-amber); }
  .muted { color: var(--pr-muted); }
  ul, ol { font-size: 22px; line-height: 1.5; }
  li { margin-bottom: 8px; }
  table {
    border-collapse: collapse;
    width: 100%;
    margin-top: 16px;
    font-family: "JetBrains Mono", ui-monospace, monospace;
    font-size: 18px;
  }
  th, td {
    border: 1px solid rgba(172,135,143,0.25);
    padding: 12px 16px;
    text-align: left;
  }
  th {
    background: rgba(255,177,196,0.08);
    color: var(--pr-pink);
    font-weight: 600;
  }
  section::after {
    color: var(--pr-muted);
    font-family: "JetBrains Mono", ui-monospace, monospace;
  }
  .columns {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 32px;
  }
  .columns-3 {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 24px;
  }
  .card {
    border: 1px solid rgba(172,135,143,0.25);
    border-radius: 8px;
    padding: 20px;
    background: rgba(28,27,27,0.5);
  }
  .card h3 { font-size: 20px; margin-top: 0; }
  .card p { font-size: 16px; color: var(--pr-fg); margin: 8px 0 0; }
  footer { color: var(--pr-muted); font-family: "JetBrains Mono", monospace; }
---

<!-- _class: title -->
<!-- _paginate: false -->

<div class="eyebrow">▮ PAIFLOW · INVESTOR DRAFT</div>

# Paiflow

<div class="tagline">Zaps for Payments. <span class="hot">Powered by Stellar.</span></div>

<br>

**Drag. Drop. Deploy.** — programmable payments on Stellar Soroban, with **no Rust** and **no devs**.

<br>

<span class="muted mono">v0.1 DRAFT · 2026</span>

---

<div class="eyebrow">§ 01 · PROBLEM</div>

## Programmable payments are <span class="pink">locked behind engineers.</span>

- Every fintech, SMB, payroll team, or DAO that wants conditional, scheduled, or split payments today must **hire Rust developers** — or be stuck with off-the-shelf SaaS that doesn't fit.
- Stellar's **Soroban** unlocks programmable money, but the UX is "go learn a smart-contract toolchain."
- **There is no middle layer** between "send-a-payment button" and "build-your-own contract."

<br>

<span class="mono">→ Result: 99% of operators who'd benefit can't ship.</span>

---

<div class="eyebrow">§ 02 · SOLUTION</div>

## Paiflow is that middle layer.

<div class="columns">

<div>

**A visual builder** for payment automations.

- Drag a **trigger** (`On Receive`, `On Schedule`, API, email).
- Drop an **action** (`Pay`, `Split`, `Stream`).
- Add **logic** (oracle, threshold, multisig).
- Click **Deploy** → a pre-audited Soroban contract is live in **~90 seconds**.

</div>

<div>

**Non-custodial by design.** Paiflow never holds keys — users sign in their own wallet.

**AI-assisted authoring.** Describe the flow in plain English; Paiflow drafts the canvas.

**Three audited templates** cover ~80% of real-world use cases out of the gate.

</div>

</div>

---

<div class="eyebrow">§ 03 · DEMO BEAT</div>

## <span class="pink">90 seconds</span> from idea to on-chain.

<div class="columns-3">

<div class="card">
<h3 class="mono">01 · DRAG</h3>
<p>Pick <code>On Receive USDC</code> from the palette. Drop it on the canvas.</p>
</div>

<div class="card">
<h3 class="mono">02 · DROP</h3>
<p>Add <code>Split 60 / 30 / 10</code> to three wallets — Alice, Bob, Charlie.</p>
</div>

<div class="card">
<h3 class="mono">03 · DEPLOY</h3>
<p>Sign in Freighter. QR code appears. Scan, send <span class="pink">10 USDC</span>, watch three payouts fan out live.</p>
</div>

</div>

<br>

<span class="mono muted">→ Same loop powers payroll, treasury, escrow, marketplaces, DAO ops.</span>

---

<div class="eyebrow">§ 04 · WHAT YOU CAN BUILD</div>

## Real-world payment workflows, <span class="pink">visually.</span>

<div class="columns">

<div>

- **Auto-schedule salaries** — pay 50 contractors every 1st & 15th, in USDC.
- **API-triggered payouts** — Shopify webhook → split revenue with co-founders.
- **Email-triggered payments** — invoice paid → release affiliate commission.
- **Oracle-conditional escrow** — release funds if BTC > $X or game outcome resolves.

</div>

<div>

- **Streaming compensation** — pay grants per-second over 12 months.
- **Notify on payout** — email/SMS recipients when their tranche lands.
- **Prediction-market settlement** — auto-distribute pool to winning side.
- **Tiered treasury rules** — 70% ops, 20% reserve, 10% community, every inflow.

</div>

</div>

<br>

<span class="mono muted">Every block composes. Every flow becomes one Soroban contract on Stellar.</span>

---

<div class="eyebrow">§ 05 · WHY STELLAR · WHY NOW</div>

## <span class="pink">Stellar is the payment rail.</span> Soroban makes it programmable. We make it usable.

<div class="columns">

<div>

**Stellar:** ~5s settlement, sub-cent fees, native USDC, regulated on-ramps, and **real adoption with payment companies** (MoneyGram, Circle, IBM World Wire alumni).

**Soroban:** mainnet-live Rust smart-contract platform purpose-built for payments and assets.

</div>

<div>

**The shift now:**

- **No-code** is how SaaS scaled from devs to operators (Zapier, Retool, Webflow).
- **AI** collapses the last mile — describe the flow, get the contract.
- **Stablecoins** are eating cross-border payments.

Paiflow sits at the intersection.

</div>

</div>

---

<div class="eyebrow">§ 06 · MARKET</div>

## Target: <span class="pink">operators</span>, not protocol engineers.

<div class="columns">

<div>

**Initial wedge**

- **Crypto-native SMBs & DAOs** — payroll, treasury, contributor payouts.
- **Web3 fintechs** building on Stellar — embed Paiflow flows as their payments layer.
- **Remittance & payout operators** — programmable splits at the edge.

</div>

<div>

**Why they buy**

- Today: Rust contractor at $150/hr, 2-week build, ongoing audits.
- With Paiflow: **launch in an afternoon**, audited templates, no custody risk.

**TAM signal:** Zapier crossed $200M ARR by being a verb. "Paiflow it" is the same shape for money.

</div>

</div>

---

<div class="eyebrow">§ 07 · PRICING (INITIAL)</div>

## Self-serve SaaS, billed per active flow.

| Tier           | Price         | What you get                                                    |
| -------------- | ------------- | --------------------------------------------------------------- |
| **Free**       | $0            | 1 active flow · testnet · community support                     |
| **Starter**    | **$29 / mo**  | 5 flows · mainnet · email notifications · 10k events/mo         |
| **Pro**        | **$149 / mo** | 25 flows · API + webhook triggers · SMS · 100k events · SLAs    |
| **Business**   | **$499 / mo** | Unlimited flows · SSO · audit log export · 1M events · priority |
| **Enterprise** | Custom        | Dedicated infra · custom templates · contract audits · co-sell  |

<br>

<span class="mono muted">Revenue add-ons: per-event metering above tier, white-label embed, and template marketplace rev share.</span>

---

<div class="eyebrow">§ 08 · ROADMAP</div>

## From hackathon demo to <span class="pink">programmable payment fabric.</span>

<div class="columns-3">

<div class="card">
<h3 class="mono">NOW · Q2'26</h3>
<p>Three audited templates (Splitter, Streamer, Conditional). Testnet live. Visual builder shipping. Hackathon demo.</p>
</div>

<div class="card">
<h3 class="mono">NEXT · Q3'26</h3>
<p>Mainnet GA · API & webhook triggers · email/SMS · AI flow authoring · 10 design-partner pilots.</p>
</div>

<div class="card">
<h3 class="mono">LATER · '27</h3>
<p>Template marketplace · oracle integrations (Reflector, Pyth) · multi-chain export · embedded SDK.</p>
</div>

</div>

<br>

<span class="mono muted">Built non-custodial from day one — no money-transmitter risk; users sign every action.</span>

---

<div class="eyebrow">§ 09 · TEAM · ASK</div>

## Team

<div class="columns">

<div>

### Founders <span class="muted mono">[placeholder]</span>

- **[Name]** — CEO · ex-[Co], built [thing]
- **[Name]** — CTO · ex-[Co], Stellar/Soroban contributor
- **[Name]** — Design · ex-[Co], shipped [product]

### Advisors <span class="muted mono">[placeholder]</span>

- [Name] — Stellar Development Foundation
- [Name] — Payments / fintech operator

</div>

<div>

### The ask

Raising **$[X]M seed** to:

- Ship mainnet GA + AI flow authoring
- Onboard the first **50 paying SMBs / DAOs**
- Hire 2 engineers, 1 design partner success lead
- Fund external audits of every shipped template

<br>

<span class="hot mono">→ Let's make programmable payments boring.</span>

</div>

</div>

<br>

<span class="muted mono">contact@paiflow.app · paiflow.app · github.com/webnxt-2030/paiflow</span>
