# [POC] Build `payroll-poc` — a web2 freelancer payroll app powered by Paiflow

> **Status:** design / ready for implementation  
> **Owner:** TBD  
> **Repo:** `webnxt-2030/paiflow-payroll` (standalone, not under `paiflow`)  
> **Branch target:** `main`  
> **Priority:** P1 — demo asset for "Paiflow as web2 backend" narrative

---

## 1. The pitch in one paragraph

Build a **minimal but complete** Next.js application for employers who pay freelancers. Instead of wiring salaries manually, the employer configures a payroll run and Paiflow's Soroban contracts handle the pull-from-employer, split-to-recipients, and (optionally) fiat off-ramp logic on Stellar. The app must look and feel like a normal SaaS product: no wallet jargon, no Rust, no XDR. The goal is to prove that a web2 team can ship a real payment product on top of Paiflow without learning Soroban.

Because Paiflow's public API is not exposed yet, this POC **stubs the Paiflow client layer**. Every screen, form, route, and data model is real; the actual HTTP calls to Paiflow are mocked with realistic shapes so the app is demo-ready today and wire-up-ready the moment the API ships.

---

## 2. Why this matters

Paiflow today is a visual contract builder. The next narrative beat is: **"what can you build with it?"** A freelancer payroll app is the ideal answer because:

- The use case is instantly understandable to non-crypto audiences.
- It exercises the `PAYROLL` / `SUBSCRIPTION_DEV → SPLITTER_DEV` flow currently being built on `feat/payroll-pull-employer`.
- It showcases dev-mode / API-driven mutability (recipients and amounts filled after deploy).
- It optionally shows the PDAX fiat off-ramp (`CASH_OUT_DEV`) for "salary to bank account" demos.
- It forces us to dog-food the developer experience of building on Paiflow from a clean Next.js app.

---

## 3. Goals

1. **Ship a standalone Next.js (App Router) app** that a web2 developer would recognize.
2. **Model the full freelancer payroll lifecycle:** company → employees → pay schedule → pay run → payouts → status tracking.
3. **Integrate with Paiflow conceptually:** deploying a Paiflow payroll flow, updating recipients via API, triggering charges, and reading events.
4. **Stub all Paiflow API calls** so the app compiles, runs, and demos end-to-end without the public API being ready.
5. **Use pnpm** for dependency management and workspace consistency.
6. **Keep it POC-quality:** polished enough for a judge demo, not production-hardened.

---

## 4. Non-goals

- No real on-chain transactions from the POC app itself (we stub the Paiflow client).
- No multi-tenant orgs, roles, or RBAC beyond a single logged-in employer.
- No KYC/onboarding for fiat off-ramp beyond a form that submits to Paiflow.
- No mobile native app; responsive web is enough.
- No production-grade billing, invoices, or accounting exports.

---

## 5. Target persona

**Mara** — founder of a 12-person remote design studio in the Philippines. She pays 8 freelancers weekly in PHP. She currently sends money via three different apps, copies paste amounts into spreadsheets, and loses half a day every Friday. She wants a single dashboard where she adds freelancers once, hits "Run payroll", and sees every payout land in a bank account or wallet.

---

## 6. Tech stack

| Layer           | Choice                                                              | Reason                                                                                             |
| --------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Framework       | Next.js 15 (App Router, React Server Components)                    | Matches Paiflow; familiar to web2 devs. "openrouter" = App Router.                                 |
| Language        | TypeScript 5.x, `strict: true`                                      | Consistency with Paiflow.                                                                          |
| Package manager | pnpm 10.x                                                           | Required; matches Paiflow's `packageManager`.                                                      |
| Styling         | Tailwind CSS 4 + shadcn/ui (copy-in)                                | Reuse Paiflow component primitives where possible.                                                 |
| Forms           | react-hook-form + zod                                               | Same validation story as Paiflow.                                                                  |
| State           | Server Components + Server Actions by default; minimal client state | Keep it simple.                                                                                    |
| Auth            | NextAuth.js v5 Credentials provider                                 | Standalone auth for the POC; later replaced by Paiflow SSO/API keys.                               |
| DB (POC)        | SQLite via `better-sqlite3` or Postgres via Prisma                  | **Decision needed** — SQLite is enough for a POC but Postgres mirrors Paiflow. See open questions. |
| Paiflow client  | `lib/paiflow-client.ts`                                             | Typed stub client that will become the real HTTP SDK.                                              |

---

## 7. Repo structure

This app lives in its own repo:

```text
https://github.com/webnxt-2030/paiflow-payroll

paiflow-payroll/
├── app/                  # Next.js App Router routes
├── components/           # UI components
├── lib/
│   ├── db.ts             # local database client
│   ├── auth.ts           # NextAuth config
│   ├── paiflow-client.ts # stub Paiflow API client
│   └── utils.ts
├── prisma/
│   └── schema.prisma     # POC-only schema
├── public/
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── next.config.ts
└── tailwind.config.ts
```

It depends on **Paiflow** only at the API boundary (`lib/paiflow-client.ts`). The Paiflow repo (`webnxt-2030/paiflow`, branch `feat/payroll-pull-employer`) is the upstream backend and source of truth for contract behavior.

---

## 8. Architecture overview

```text
┌─────────────────────────────────────────────────────────────────────┐
│                    payroll-poc (Next.js App Router)                 │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────┐  ┌───────────┐  │
│  │ Employer    │  │ Employees    │  │ Pay Sched. │  │ Pay Runs  │  │
│  │ dashboard   │  │ CRUD + bank  │  │ weekly/etc │  │ trigger   │  │
│  └──────┬──────┘  └──────┬───────┘  └─────┬──────┘  └─────┬─────┘  │
│         └─────────────────┴────────────────┴───────────────┘       │
│                                    │                                │
│                    lib/paiflow-client.ts (stub)                   │
│                                    │                                │
└────────────────────────────────────┼────────────────────────────────┘
                                     │  (future: HTTPS / API keys)
                                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         Paiflow backend                            │
│  Flow builder → deploy pipeline → SUBSCRIPTION_DEV → SPLITTER_DEV  │
│  → optional CASH_OUT_DEV → PDAX off-ramp → bank account             │
└─────────────────────────────────────────────────────────────────────┘
```

The POC owns:

- Employer account and session (for now).
- Employees, bank details, and pay schedules.
- Pay runs and their human-readable status.
- The UX for "connect to Paiflow / deploy payroll contract".

Paiflow owns:

- The actual Soroban contract deploy, charge, and event logic.
- Wallet signing and on-chain state.
- Fiat off-ramp execution (PDAX).

The boundary is `lib/paiflow-client.ts`.

---

## 9. Paiflow client stub contract

`apps/payroll-poc/lib/paiflow-client.ts` exports typed functions that return mock data today and real data later.

```ts
export type PaiflowDeployment = {
  id: string;
  contractAddress: string | null;
  status: "PENDING_SIGNATURE" | "SUBMITTED" | "CONFIRMED" | "FAILED";
  network: string;
  createdAt: string;
};

export async function deployPayrollFlow(opts: {
  employerAddress: string;
  asset: "USDC" | "XLM";
  intervalUnit: "day" | "week" | "month";
  firstPaymentAt: string;
  totalAmountPerPeriodStroops: string;
}): Promise<PaiflowDeployment>;

export async function updatePayrollRecipients(
  deploymentId: string,
  recipients: Array<{
    address: string;
    label?: string;
    mode: "fixed" | "percentage";
    amountStroops?: string;
    bps?: number;
  }>,
): Promise<{ txHash: string }>;

export async function triggerPayrollCharge(
  deploymentId: string,
): Promise<{ txHash: string | null; status: string }>;

export async function getPayrollEvents(deploymentId: string): Promise<
  Array<{
    kind: string;
    amountStroops?: string;
    recipient?: string;
    txHash: string;
    occurredAt: string;
  }>
>;

export async function enableFiatOffRamp(
  deploymentId: string,
  senderProfile: FiatSenderProfile,
): Promise<{ ok: boolean }>;
```

**Stub behavior:**

- Every function `await`s a short delay (`setTimeout`) so the UI shows realistic loading states.
- `deployPayrollFlow` returns a fake deployment with a fake contract address after 1.5s.
- `updatePayrollRecipients` returns a fake tx hash.
- `triggerPayrollCharge` returns a fake tx hash and queues fake events.
- `getPayrollEvents` returns deterministic mock events so the live feed animates.
- All functions log to the console with a `// TODO: wire to Paiflow API` comment.

---

## 10. POC data model

Use Prisma with a lightweight schema. Fields mirror what a real payroll SaaS needs; Paiflow-specific IDs are stored as opaque strings.

```prisma
model Employer {
  id            String     @id @default(uuid())
  email         String     @unique
  passwordHash  String
  name          String
  walletAddress String?    // employer Stellar address, captured during onboarding
  paiflowDeploymentId String? @unique
  createdAt     DateTime   @default(now())
  employees     Employee[]
  paySchedules  PaySchedule[]
  payRuns       PayRun[]
}

model Employee {
  id              String    @id @default(uuid())
  employerId      String
  label           String    // e.g. "Alice — UI Designer"
  walletAddress   String?   // on-chain recipient
  bankAccountName   String?
  bankAccountNumber String?
  bankCode          String?
  amountStroops   String?   // fixed amount per period; overrides schedule default if set
  bps             Int?      // percentage split if used instead of fixed
  mode            String    @default("fixed") // "fixed" | "percentage"
  isActive        Boolean   @default(true)
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  employer        Employer  @relation(fields: [employerId], references: [id], onDelete: Cascade)
  payouts         Payout[]
}

model PaySchedule {
  id                    String   @id @default(uuid())
  employerId            String
  label                 String   // e.g. "Weekly Friday"
  intervalUnit          String   // "day" | "week" | "month"
  intervalAmount        Int      @default(1)
  nextRunAt             DateTime
  asset                 String   @default("USDC")
  defaultAmountStroops  String?  // total per-period amount; individual employee amounts can override
  isActive              Boolean  @default(true)
  employer              Employer @relation(fields: [employerId], references: [id], onDelete: Cascade)
}

model PayRun {
  id              String    @id @default(uuid())
  employerId      String
  scheduleId      String?
  status          String    @default("DRAFT") // DRAFT | PENDING | CHARGED | PAYOUTS_SENT | FAILED | CANCELLED
  totalStroops    String?
  triggeredAt     DateTime?
  paiflowTxHash  String?
  errorMessage    String?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  employer        Employer  @relation(fields: [employerId], references: [id], onDelete: Cascade)
  payouts         Payout[]
}

model Payout {
  id              String    @id @default(uuid())
  payRunId        String
  employeeId      String
  amountStroops   String
  status          String    @default("PENDING") // PENDING | SENT | COMPLETED | FAILED
  txHash          String?
  completedAt     DateTime?
  employee        Employee  @relation(fields: [employeeId], references: [id], onDelete: Cascade)
  payRun          PayRun    @relation(fields: [payRunId], references: [id], onDelete: Cascade)
}
```

---

## 11. Routes / pages

| Path              | Auth   | Description                                                                                                       |
| ----------------- | ------ | ----------------------------------------------------------------------------------------------------------------- |
| `/login`          | public | Email + password.                                                                                                 |
| `/onboarding`     | user   | Capture company name, employer wallet address, and (optionally) connect to Paiflow by deploying the payroll flow. |
| `/dashboard`      | user   | Summary: next payday, total employees, last pay run status, recent payouts.                                       |
| `/employees`      | user   | CRUD freelancers + bank/wallet details.                                                                           |
| `/employees/[id]` | user   | Edit one employee.                                                                                                |
| `/schedule`       | user   | Configure pay interval and default amount.                                                                        |
| `/pay-runs`       | user   | List historical pay runs.                                                                                         |
| `/pay-runs/[id]`  | user   | Detail view with payout list, tx hashes (mock), and a live-style event feed.                                      |
| `/pay-runs/new`   | user   | Review upcoming payout list and hit "Run payroll now".                                                            |
| `/settings`       | user   | Paiflow connection status, network (testnet/mainnet chip), fiat off-ramp toggle + sender profile form.            |
| `/api/paiflow/*`  | server | Internal bridge that calls `paiflow-client.ts` so the UI never talks to Paiflow directly.                         |

---

## 12. Key user flows

### 12.1 Onboarding

1. Employer signs up with email/password.
2. Enters company name.
3. Pastes their Stellar wallet address (or is guided to Freighter — stubbed).
4. Clicks **"Create Paiflow payroll contract"**.
5. App calls `deployPayrollFlow()` stub; stores `paiflowDeploymentId` on the employer row.
6. Employer lands on the dashboard.

### 12.2 Add a freelancer

1. Employer navigates to `/employees/new`.
2. Enters name, optional wallet address, optional bank details.
3. Sets amount: fixed PHP-equivalent amount (input in PHP, converted to USDC stroops via a stub rate) or percentage.
4. Saves. Employee appears in the roster.

### 12.3 Run payroll

1. Employer goes to `/pay-runs/new`.
2. App previews the list of active employees and computed total.
3. Employer clicks **"Run payroll"**.
4. App:
   - syncs recipients to Paiflow via `updatePayrollRecipients()`;
   - creates a `PayRun` row in `PENDING`;
   - calls `triggerPayrollCharge()`;
   - transitions `PayRun` to `CHARGED` and creates `Payout` rows.
5. Employer is taken to `/pay-runs/[id]` to watch fake events roll in.

### 12.4 Fiat off-ramp demo

1. Employer enables off-ramp in `/settings`.
2. Fills sender profile (name, address, nationality, source of funds).
3. App calls `enableFiatOffRamp()` stub.
4. Employees with bank details show a "to bank" badge in the roster.

---

## 13. UI/UX notes

- Use Paiflow brand tokens from `BRAND.md` where possible.
- Keep copy plain: "Run payroll" not "trigger charge"; "Freelancers" not "recipients".
- Show a **testnet/mainnet chip** on every screen that touches money.
- Every Stellar address is truncated with copy-to-clipboard.
- Amounts display in PHP-equivalent (stub rate) with raw stroops in a tooltip.
- The pay-run detail page mimics Paiflow's live event feed but simplified.
- Empty states include a CTA ("Add your first freelancer").

---

## 14. Stubbing strategy

| Paiflow capability  | POC treatment                                                                       |
| ------------------- | ----------------------------------------------------------------------------------- |
| Deploy payroll flow | `paiflow-client.deployPayrollFlow` returns mock deployment after delay.             |
| Update recipients   | Returns mock tx hash; does not mutate chain.                                        |
| Trigger charge      | Returns mock tx hash; creates mock `PAYOUT` events on next `getPayrollEvents` call. |
| Event feed          | Deterministic mock events generated from pay run ID + timestamp.                    |
| Wallet signing      | Employer pastes/pastes address; no browser extension integration in POC.            |
| Fiat off-ramp       | Form submits to stub; status shown as "pending PDAX" with fake progress.            |
| Auth                | POC has its own NextAuth session; later replaced by Paiflow API key.                |

Each stub function must contain a `// TODO(PAIFLOW_API): replace with real HTTP call` comment and a documented request/response shape so the migration is mechanical.

---

## 15. Acceptance criteria

- [ ] `pnpm install` succeeds at the repo root.
- [ ] `pnpm dev` boots the app locally.
- [ ] Employer can sign up, log in, and complete onboarding.
- [ ] Employer can add, edit, and deactivate freelancers.
- [ ] Employer can configure a pay schedule.
- [ ] Employer can run payroll and see a pay-run detail page with mock events.
- [ ] All Paiflow client functions are stubbed but typed and documented.
- [ ] App is responsive down to 375px width.
- [ ] TypeScript type-check passes (`pnpm typecheck`).
- [ ] No production secrets or real API keys required to run locally.

---

## 16. Open questions / decisions

1. **Local database:** SQLite is enough for a demo but diverges from Paiflow's Postgres. Should we use Postgres + Prisma to mirror Paiflow's stack, or keep the POC lighter?
2. **Auth model:** Keep a separate employer table in the POC, or plan to delegate to Paiflow's user table/API keys once exposed?
3. **Fiat in POC:** Should the off-ramp sender profile live in the POC DB or be sent straight to Paiflow? For now, store locally and stub the Paiflow call.
4. **Currency display:** Display everything in PHP with a hardcoded testnet USDC/PHP rate, or show both PHP and USDC?

---

## 17. Related work

- Current branch: `feat/payroll-pull-employer` — contains the `PAYROLL` contract and mutable recipient APIs.
- `docs/dev-mode-mutable-flows.md` — explains the `_DEV` contract decomposition (`SUBSCRIPTION_DEV → SPLITTER_DEV`) that this app will eventually consume.
- `lib/offramp/*` — PDAX off-ramp jobs the fiat flow will use once wired.
- `SPEC.md` and `AGENT.md` — Paiflow's product spec and engineering guidelines.

---

## 18. Suggested first PR

Create the directory scaffold, `package.json`, `pnpm-workspace.yaml` (or document the alternative), and the typed `lib/paiflow-client.ts` stub. Do **not** wire real HTTP calls. Merge once the app boots and the stub client returns mock data that the onboarding screen can render.
