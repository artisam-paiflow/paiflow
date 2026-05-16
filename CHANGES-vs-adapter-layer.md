# Changes: `feat/address-resolve-flow` vs `feat/ai-adapter-layer`

## Overview

One commit on top of `feat/ai-adapter-layer`:
`848534e` — Replace placeholder addresses with `PENDING:label` resolution protocol

**Theme**: Eliminate the singleton placeholder address (`GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`) and replace it with an interactive address resolution system that works like a production app would.

**Before**: AI silently used a hardcoded placeholder for all unknown recipients. All 3 recipients (Mom, Car, Savings) got the same fake address. No prompt asking for real addresses.

**After**: AI uses `PENDING:<label>` sentinel for unknown recipients. The client shows an interactive prompt asking for each address. Addresses are saved to a per-user address book for reuse. Deployment is blocked until all addresses are resolved.

---

## New Files Created (6 files)

### `lib/address-book.ts`

Per-user address book helpers. Queries and upserts `AddressBookEntry` rows tied to `ownerId`. Used by the AI edit API for auto-resolution and by the resolve-addresses API.

### `app/api/address-book/route.ts` + `app/api/address-book/[id]/route.ts`

CRUD endpoints for the address book:

- `GET /api/address-book` — list user's entries
- `POST /api/address-book` — create or update an entry
- `DELETE /api/address-book/:id` — remove an entry

### `app/api/flows/[id]/resolve-addresses/route.ts`

Bulk resolution endpoint. Accepts `{ addresses: { "Mom": "GABC...", "Car": "GDEF..." } }`. Replaces all `PENDING:<label>` recipients with real addresses, upserts each to the address book, validates the resulting flow, and saves.

### `components/builder/raft-log.tsx`

The Raft Log chat UI component (was already on the adapter branch as untracked). **New addition in this commit**: the `MissingAddressPrompt` sub-component that:

- Shows an amber warning banner with the count of pending recipients
- Renders one input field per label with inline Stellar address validation
- "Apply Addresses" button sends to `/resolve-addresses`
- "Skip for now" dismisses (addresses stay pending, deploy blocked)

---

## Modified Files (12 files)

### `lib/flows/schema.ts`

- **`stellarAccount` validator** now accepts both valid `G...` keys AND the `PENDING:*` format
- **Exported `isPendingAddress()`** — checks if a string starts with `"PENDING:"`
- **Exported `getPendingLabels()`** — scans a `FlowGraph` and returns all pending recipient labels
- **`FlowGraphSchema.nodes`** — changed from `.min(2)` to no minimum (accepts 0+ nodes for intermediate editing states)
- **`SplitAction.recipients`** — changed from `.min(2)` to `.min(1)` (accepts single-recipient splits during editing)

### `lib/flows/validate.ts`

- **Duplicate real-address check**: if two split recipients share the same non-pending `G...` address → validation error
- **Pending label collection**: scans all action nodes for `PENDING:*` addresses, collects their labels
- **`ValidationResult`** now includes `pendingLabels: string[]` when `ok: true`

### `lib/flows/english.ts`

- Pending recipients display `"50% to Mom (needs address)"` instead of converting the `PENDING:*` string to hex
- Pay nodes with pending address show `"pay to (needs address)"`

### `lib/ai/prompts.ts`

- **Removed the hardcoded placeholder** `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` from the system prompt and user message builders
- **Added `missingAddresses: string[]`** to `EditResponseSchema` — AI reports labels that need addresses
- **New address rules in system prompt**:
  - User provides `G...` address → use it
  - Label matches address book → use that address
  - Label matches existing flow recipient → reuse that address
  - **No known address** → use `PENDING:<label>` and add to `missingAddresses`
  - Never invent random `G...` addresses
- **`buildUserMessage()`** now:
  - Accepts address book entries
  - **Filters `PENDING:*` out** of the "Existing addresses" section (avoids AI confusing them with real addresses)
  - Adds a separate "Unresolved recipients" section for pending labels
  - Injects "Address book (known addresses)" section when entries exist
- **`buildCorrectionPrompt()`** — same address book injection and pending filtering

### `app/api/flows/[id]/edit/route.ts`

- **Fetches address book** before calling the AI
- **Passes address book** to `buildUserMessage()` and `buildCorrectionPrompt()`
- **Auto-resolves** known labels: if the AI creates `PENDING:Mom` but Mom exists in the address book, replaces with the real address immediately (reduces unnecessary prompts)
- **Forwards `missingAddresses`** in the API response so the client can show the address prompt
- Returns `{ patch, explanation, applied, missingAddresses, templateKind }`

### `app/api/flows/[id]/route.ts`

- **Relaxed validation for autosave**: if `validateFlow` rejects intermediate stale (e.g., no action node after deletion), still saves the graph but keeps old `templateKind`/`parameters`. Previously it threw 422 and blocked the save entirely.

### `app/api/deployments/prepare/route.ts`

- **Deploy guard**: after `FlowGraphSchema.parse` + `validateFlow`, calls `getPendingLabels(graph)`. If any pending labels exist, throws `AppError("VALIDATION", "Cannot deploy: these recipients need Stellar addresses first: Mom, Car. Resolve them in the flow editor before deploying.")`. Fires **before** `deployment.create()` — no failed deployment record is created.

### `components/builder/builder-client.tsx`

- **`scanPendingLabels()`**: client-side helper that scans `FlowNode[]` for `PENDING:*` addresses
- **`handleResolveAddress()`**: async function that POSTs to `/api/flows/:id/resolve-addresses`, updates flow state with resolved graph, clears pending state
- **`pendingAddresses` state**: tracks labels needing addresses
- **After every patch**: runs `scanPendingLabels()` on the new graph, sets `pendingAddresses`
- Passes `pendingAddresses` and `onResolveAddress` to `RaftLog`

### `components/builder/config-panel.tsx`

- **Label input field** added to each split recipient row (was missing entirely)
- **"needs address" badge** shown next to rows where address is `PENDING:*`
- **"Add recipient" button** now uses `PENDING:unnamed` instead of the placeholder
- Pay node input shows amber ring when address is pending

### `components/builder/palette.tsx`

- Removed `DEMO_ADDR` constant
- Pay template uses `PENDING:unnamed`
- Split template uses `PENDING:unnamed` for both default recipients

### `app/flows/new/page.tsx`

- Starter template now uses `PENDING:Mom`, `PENDING:Landlord`, `PENDING:Savings` instead of the placeholder

### `prisma/schema.prisma`

- **New model `AddressBookEntry`**:
  ```prisma
  model AddressBookEntry {
    id        String   @id @default(uuid()) @db.Uuid
    ownerId   String   @db.Uuid
    label     String
    address   String
    createdAt DateTime @default(now())
    updatedAt DateTime @updatedAt
    owner User @relation(fields: [ownerId], references: [id], onDelete: Cascade)
    @@unique([ownerId, label])
    @@index([ownerId])
  }
  ```
- `User` model now has `addressBookEntries AddressBookEntry[]` relation

### `tests/unit/validate.test.ts`

- Updated constants: split from single `ADDR` to `ADDR_A` and `ADDR_B` (two different valid Stellar addresses) because the new duplicate address check now rejects two recipients with the same address in a split
- All 6 test cases now use distinct addresses where needed

---

## New Migration

`prisma/migrations/20260516083151_add_address_book/migration.sql`

Creates the `AddressBookEntry` table with:

- Primary key on `id` (UUID)
- Foreign key to `User` with `ON DELETE CASCADE`
- Unique index on `[ownerId, label]`
- Index on `ownerId`

---

## Technical Architecture

### Flow (user creates a split with unknown recipients)

```
User: "when i receive 50usdc. split 50/30 to mom, car, savings"
  │
  ▼
AI creates patch with PENDING:Mom, PENDING:Car, PENDING:Savings
missingAddresses: ["Mom", "Car", "Savings"]
  │
  ▼
Client applies patch, scans for pending → shows MissingAddressPrompt
  │
  ▼
User types: Mom=GABC..., Car=GDEF..., Savings=GHIJ...
  │
  ▼
POST /resolve-addresses → replaces in graph + upserts to address book
  │
  ▼
Graph saved with real addresses. Flow is deployable.
  │
  ▼
Next time user says "send to Mom" → AI looks up address book → uses GABC... directly
```

### Guard chain (blocks deploy with pending addresses)

```
PATCH (autosave) ──→ Schema: passes (PENDING:* is valid)
                   → validateFlow: passes (pending allowed)
                   → flowToParams: passes (returns string as-is)
                   → Saved to DB ✓

POST (deploy)     ──→ Schema: passes
                   → validateFlow: passes
                   → getPendingLabels(): returns ["Mom", "Car"] → THROW AppError
                   → ✗ Never reaches constructorArgs / deployment.create()
```

### Safety properties

| Scenario                                           | What happens                                                                 |
| -------------------------------------------------- | ---------------------------------------------------------------------------- |
| AI returns `PENDING:Mom` + Mom in address book     | Auto-resolved in `edit/route.ts:autoResolvePending()`                        |
| AI returns `PENDING:Mom` + Mom NOT in address book | `missingAddresses: ["Mom"]` → client shows prompt                            |
| User skips address prompt                          | Graph saved with `PENDING:Mom` → deploy blocked with clear error             |
| User re-enters existing address for Mom            | Address book upsert is idempotent (unique `[ownerId, label]`)                |
| User deletes node mid-edit                         | Graph saved anyway (relaxed validation) → no 422 errors                      |
| User deploys without resolving                     | `getPendingLabels()` fires before `deployment.create()` → rejected           |
| `PENDING:*` reaches `constructorArgs()`            | Impossible (deploy guard blocks before `flowToParams` passes to deploy path) |

---

## Files Removed (from adapter layer, not part of this change)

These deletions were part of the `feat/ai-adapter-layer` foundation:

| File                                      | Reason                    |
| ----------------------------------------- | ------------------------- |
| `lib/ai/adapter.ts`                       | Replaced by groq.ts       |
| `lib/ai/anthropic.ts`                     | Replaced by groq.ts       |
| `lib/ai/types.ts`                         | Inlined into prompts.ts   |
| `components/builder/ai-generate-bar.tsx`  | Replaced by raft-log.tsx  |
| `components/builder/suggestion-panel.tsx` | Folded into raft-log.tsx  |
| `app/api/flows/generate/route.ts`         | Replaced by edit/route.ts |
| `app/api/flows/suggest/route.ts`          | Folded into edit/route.ts |
| Various test files                        | Updated for new AI layer  |
