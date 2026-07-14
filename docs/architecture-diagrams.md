# Architecture diagram sources

Editable mermaid sources for the diagrams embedded in [`../README.md`](../README.md).
The README references the pre-rendered SVGs in [`./diagrams`](./diagrams) so the
diagrams display everywhere (GitHub's client-side mermaid renderer is flaky and
unsupported in the mobile app); the sources are kept here so they stay editable
and still preview as live mermaid where rendering works.

**After editing a diagram here, regenerate the SVG:**

```bash
npx -y @mermaid-js/mermaid-cli -i <diagram>.mmd -o docs/diagrams/<diagram>.svg -b transparent
```

## System architecture

```mermaid
flowchart TB
    subgraph Client["Client (browser / phone)"]
        Builder["Visual builder<br/>(@xyflow/react canvas)"]
        Wallet["Wallet — Freighter / xBull / Albedo /<br/>LOBSTR / WalletConnect<br/>(@creit.tech/stellar-wallets-kit)"]
        Payer["Payer — scans QR /<br/>opens dApp URL"]
    end

    subgraph App["Next.js 15 app (Railway)"]
        Pages["Pages — /flows /deployments<br/>/trigger /admin"]
        API["API routes — /api/deployments/*<br/>/api/flows/* /api/transcribe<br/>/api/webhooks/* /api/cron/*"]
        Auth["Auth.js v5 — argon2 +<br/>WebAuthn + middleware"]
        StellarLib["lib/stellar — XDR build /<br/>simulate / submit / relayer"]
        Cron["Cron jobs — poll-events,<br/>auto-release, auto-charge-*,<br/>process-streamer/offramp-jobs"]
    end

    subgraph Data["Data plane"]
        PG[("PostgreSQL 16<br/>Prisma — Flow, Deployment,<br/>ContractEvent, AuditLog, …")]
        Redis[("Redis 7 — rate limits,<br/>job claims, event pub/sub")]
        Files[("File storage —<br/>MinIO (dev) / Volume (prod)")]
    end

    subgraph Chain["Stellar network (testnet / mainnet)"]
        RPC["Soroban RPC —<br/>simulate / send / getEvents"]
        Horizon["Horizon —<br/>account funding checks"]
        Factory["Factory contract<br/>(deploy_pipeline)"]
        Contracts["Deployed pipelines —<br/>triggers: deposit / webhook / subscription / oracle<br/>actions: splitter / streamer / payer / payroll /<br/>cash_out / swapper / yield<br/>conditions: timelock / amount / oracle"]
    end

    subgraph External["External services"]
        Groq["Groq — Whisper (STT)<br/>+ Llama (flow edits)"]
        Resend["Resend —<br/>transactional email"]
        PDAX["PDAX —<br/>fiat off-ramp"]
    end

    Builder --> Pages
    Payer --> Pages
    Pages --> API
    API --> Auth
    API --> StellarLib
    API --> PG
    API --> Redis
    API --> Files
    API --> Groq
    API --> Resend
    Cron --> StellarLib
    Cron --> PG
    Cron --> PDAX
    StellarLib --> RPC
    StellarLib --> Horizon
    RPC --> Factory
    Factory --> Contracts
    Wallet -. signs XDR .-> API
    Wallet -. submits signed tx .-> RPC
```

## Sequence — deploy a flow

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant UI as Builder UI
    participant API as /api/deployments
    participant DB as Postgres
    participant RPC as Soroban RPC
    participant Wallet as User wallet
    participant Factory as Factory contract

    User->>UI: Wire flow, click Deploy
    UI->>API: POST /prepare {flowId, sourceAccount}
    API->>DB: validateFlow → Deployment (BUILDING)
    API->>RPC: simulate deploy_pipeline (factory)
    RPC-->>API: assembled unsigned XDR
    API->>DB: Deployment (PENDING_SIGNATURE, unsignedXdr,<br/>pre-computed contractAddress)
    API-->>UI: unsigned XDR
    UI->>Wallet: kit.signTransaction(xdr)
    Wallet-->>UI: signed XDR
    UI->>API: POST /submit {signedXdr}
    API->>API: verify tx hash matches prepared tx
    API->>RPC: sendTransaction + poll getTransaction
    RPC->>Factory: deploy_pipeline → child contracts live
    API->>DB: Deployment (CONFIRMED) + audit rows<br/>+ first StreamerClaimJob (if streamer)
    API-->>UI: contract address, QR / dApp URL
```

## Sequence — payer executes via QR

```mermaid
sequenceDiagram
    autonumber
    actor Payer
    participant Page as /trigger page
    participant API as /api/deployments/[id]
    participant RPC as Soroban RPC
    participant Wallet as Payer wallet
    participant C as Deployed contract
    participant Cron as poll-events cron
    participant DB as Postgres / Redis

    Payer->>Page: Scan QR (SEP-7 dApp URL)
    Page->>API: POST /trigger {amount, userAddress}
    API->>RPC: simulate invocation (deposit/distribute/top-up)
    API-->>Page: unsigned XDR + network passphrase
    Page->>Wallet: kit.signTransaction(xdr)
    Wallet-->>Page: signed XDR
    Page->>API: POST /submit-trigger {signedXdr}
    API->>RPC: sendTransaction
    RPC->>C: execute (funds fan out atomically)
    API-->>Page: txHash (PENDING)
    Page->>API: poll /tx-status until finality
    Cron->>RPC: getEvents (per EventCursor)
    Cron->>DB: ContractEvent rows → Redis pub/sub<br/>(+ off-ramp job on CASH_OUT, emails)
```

## Sequence — Raft Log voice edit

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant UI as Builder UI
    participant STT as /api/transcribe
    participant Groq as Groq (Whisper / Llama)
    participant Edit as /api/flows/[id]/edit
    participant DB as Postgres

    User->>UI: "Change Alice to 55%"
    UI->>STT: POST audio (webm/mp4/wav)
    STT->>Groq: Whisper large-v3 (→ turbo fallback)
    Groq-->>STT: transcript
    STT-->>UI: text
    UI->>Edit: POST transcript
    Edit->>Groq: Llama 3.3 70B (JSON mode)<br/>system prompt + flow graph + address book
    Groq-->>Edit: JSON patch (or clarify)
    Edit->>Edit: applyPatch + autoConnectOrphans<br/>+ validateFlow (retry once on failure)
    Edit->>DB: persist patched Flow graph
    Edit-->>UI: updated canvas
```

## Sequence — scheduled automation (cron + relayer)

```mermaid
sequenceDiagram
    autonumber
    participant Sched as Scheduler (cron secret)
    participant Cron as /api/cron/*
    participant DB as Postgres
    participant RPC as Soroban RPC
    participant C as Deployed contract
    participant PDAX as PDAX off-ramp

    Sched->>Cron: POST /poll-events (x-cron-secret)
    Cron->>RPC: getEvents per CONFIRMED deployment
    Cron->>DB: ContractEvent + EventCursor advance

    Sched->>Cron: POST /process-streamer-jobs
    Cron->>DB: due StreamerClaimJob rows
    Cron->>RPC: read vested amount → relayer-signed claim
    RPC->>C: claim() pays recipient
    Cron->>DB: reschedule next milestone

    Sched->>Cron: POST /auto-charge-subscriptions / auto-charge-payroll
    Cron->>RPC: check on-chain state + allowance
    Cron->>RPC: relayer-signed charge (under relayer lock)
    Cron->>DB: PayrollRun / nextChargeAt

    Sched->>Cron: POST /auto-release
    Cron->>RPC: relayer releases matured timelocks

    Sched->>Cron: POST /process-offramp-jobs
    Cron->>DB: claim OffRampPayoutJob batch
    Cron->>PDAX: execute fiat payout
    PDAX-->>Cron: result callback (/api/webhooks/offramp)
```
