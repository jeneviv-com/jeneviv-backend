# Jeneviv Payment Collection Platform — Agent Instructions

> This is the source of truth for what to build and in what order. Do not deviate from confirmed decisions without explicit user sign-off.

## Context

Jeneviv is a payment collection platform. Merchants (vetted users) create payment **collections** (e.g., school fees, donations, event tickets) with custom form fields. Customers register, fill the form, and get a **fresh dedicated virtual account number** for each payment attempt. Money lands in Flutterwave → webhook fires → we credit the merchant's pending **wallet_balance** → a T+1 cron promotes it to **payouts_balance** → merchant withdraws (manual or scheduled).

The platform must be **payment-gateway agnostic** — Flutterwave is the first adapter; Paystack/Monnify must be droppable in without rewriting business logic.

Existing codebase (already wired): Express 5 + Drizzle ORM + Postgres + Better Auth (email/password + Google). Minimal scaffolding so far — only [src/app.ts](src/app.ts), [src/auth.ts](src/auth.ts), [src/db/schema.ts](src/db/schema.ts), [src/db/index.ts](src/db/index.ts). Bruno API docs live in [api/](api/). Flutterwave Bruno docs at `C:\Users\Lenovo\Documents\bruno\jeneviv-flutterwave` cover virtual-accounts, direct-transfers, account-resolve, banks, customers.

---

## Confirmed Product Decisions

| Decision | Value |
|---|---|
| Transactions vs Payments | **Merge into single `transactions` table** with `gateway_ref`, `gateway_id`, `charge` |
| wallet_balance vs payouts_balance | `wallet` = pending. `payouts` = withdrawable. T+1 cron promotes |
| Pricing | Fixed amount per collection. Customer bears **all fees** (collection_amount + ₦75 platform fee + Flutterwave fee) |
| Platform fee | Env var `PLATFORM_FEE_NGN=75`, configurable |
| Customer accounts | **Required** — customers must register (reuses `users` table) |
| Currency | **Multi-currency from day one** — `currency` column on collections/transactions/payouts |
| Virtual account lifecycle | New account every payment attempt (~20 min expiry) |
| Merchant onboarding | Application + admin approval (`merchants.status`: pending/approved/rejected/suspended) |
| Admin role | `users.role` column: `'user'` \| `'admin'` |
| Payout mode | Per-merchant: `'manual'` \| `'auto_daily'` \| `'auto_weekly'` |
| File uploads | Cloudinary |
| Templates | Both platform-wide (admin-owned, `merchant_id` null) and per-merchant |
| Email | Resend. Notification batching per merchant: immediate/hourly/6hourly/12hourly/daily |
| Refunds | Full refunds only; debits merchant's `payouts_balance`; new `refunds` table |

---

## Repository Conventions (must follow)

- **TypeScript NodeNext** modules. Imports use `.js` suffix in source (see existing `auth.ts` importing `./db/index.js`). Strict mode on.
- **Drizzle**: snake_case DB columns, camelCase TS field names. PK is `id` on every new table (existing `users` uses `uid` — keep it). FKs reference `users.id` (the TS field that maps to the `uid` column).
- **Validation**: Zod 4 + drizzle-zod. Export `insertXSchema` and `selectXSchema` next to each table.
- **Migrations**: `pnpm db:generate` then `pnpm db:migrate`. Never hand-edit generated SQL.
- **Bruno**: Every new endpoint ships with a `.yml` file in [api/](api/) alongside the existing auth specs.
- **Env loading**: `dotenv.config()` at top of entry files. Required env vars throw at import-time (see `auth.ts` Google check pattern).
- **No comments unless WHY is non-obvious.** No backwards-compat shims. No premature abstractions.

---

## Target Folder Layout

```
src/
├── app.ts                      # express bootstrap, route mounting, error handler
├── auth.ts                     # better-auth (existing — unchanged)
├── env.ts                      # NEW — typed env loader, throws on missing required vars
├── db/
│   ├── index.ts                # drizzle client (existing)
│   └── schema/
│       ├── index.ts            # re-exports — keeps `./db/schema.js` import path stable
│       ├── auth.ts             # users, sessions, accounts, verifications (moved from schema.ts)
│       ├── merchants.ts        # merchants, merchant_bank_accounts
│       ├── collections.ts      # collections, collection_fields, templates, template_fields, customer_fields
│       ├── transactions.ts     # transactions, transaction_fields, payment_accounts
│       ├── payouts.ts          # payouts, refunds
│       ├── platform.ts         # bank_codes, webhook_events, audit_logs
│       └── enums.ts            # shared pgEnum / text-union types
├── gateways/
│   ├── types.ts                # PaymentGateway interface, NormalizedEvent, shared types
│   ├── registry.ts             # gateway lookup by name
│   └── flutterwave/
│       ├── client.ts           # raw HTTP wrapper + OAuth token cache
│       ├── adapter.ts          # implements PaymentGateway
│       └── webhook.ts          # signature verification + payload normalization
├── modules/
│   ├── merchants/              # routes, controller, service, schemas
│   ├── collections/
│   ├── templates/
│   ├── payments/               # customer-facing pay flow
│   ├── transactions/           # merchant-facing list/detail
│   ├── payouts/
│   ├── refunds/
│   ├── admin/                  # admin-only: approve merchants, view all, manage platform templates
│   └── webhooks/               # gateway webhook ingress
├── middleware/
│   ├── error.ts                # central error handler
│   ├── validate.ts             # zod body/query/params validator
│   ├── require-auth.ts         # better-auth session check
│   ├── require-merchant.ts     # require approved merchant
│   ├── require-admin.ts        # require users.role = 'admin'
│   └── raw-body.ts             # for webhook signature verification
├── jobs/
│   ├── scheduler.ts            # node-cron / setInterval registry
│   ├── settle-wallet.ts        # T+1 wallet → payouts
│   ├── scheduled-payouts.ts    # auto_daily / auto_weekly sweepers
│   ├── notification-batcher.ts # flush queued emails per merchant cadence
│   └── refresh-banks.ts        # nightly bank_codes refresh from gateway
├── lib/
│   ├── short-code.ts           # nanoid-based public ids (collection short_code, merchant_id)
│   ├── money.ts                # store amounts as integer minor units (kobo); helpers
│   ├── fees.ts                 # computeTotalCharge(collection, gateway) → { platform_fee, gateway_fee, total }
│   ├── cloudinary.ts           # signed upload params + delete
│   ├── email.ts                # Resend client + template renderer
│   └── logger.ts               # pino or console with request_id
└── types/
    └── express.d.ts            # augments req.user, req.merchant
```

---

## Final Schema (Drizzle)

Money is stored as **integer minor units** (kobo for NGN). `currency` is ISO 4217 (`'NGN'`, `'USD'`). All new tables use `id` text PK from `nanoid()`. Timestamps `created_at`/`updated_at` with timezone everywhere.

### users (existing — add 2 columns)
| Column | Type | Notes |
|---|---|---|
| `role` | text not null default `'user'` | `'user'` \| `'admin'`. Set via DB seed for first admin. |
| `default_currency` | text not null default `'NGN'` | Used as default when merchant creates collection |

### merchants
| Column | Type | Notes |
|---|---|---|
| `id` | text PK | nanoid |
| `user_id` | text FK → users.uid, unique | one merchant row per user |
| `merchant_code` | text unique | 8-char public id for customer support |
| `display_name` | text | shown on payment pages |
| `status` | text not null default `'pending'` | pending / approved / rejected / suspended |
| `wallet_balance_ngn` | bigint not null default 0 | pending, in kobo |
| `payouts_balance_ngn` | bigint not null default 0 | withdrawable, in kobo |
| `payout_mode` | text not null default `'manual'` | manual / auto_daily / auto_weekly |
| `default_bank_account_id` | text FK → merchant_bank_accounts.id nullable | for auto payouts |
| `email_notification_for_transactions` | boolean not null default true | |
| `email_notification_period` | text not null default `'immediate'` | immediate/hourly/6hourly/12hourly/daily |
| `application_note` | text | reason submitted with application |
| `admin_review_note` | text | admin's approve/reject comment |
| `reviewed_by_uid` | text FK → users.uid nullable | admin who decided |
| `reviewed_at` | timestamptz nullable | |
| `gateway_customer_ids` | jsonb default `'{}'` | { flutterwave: "...", paystack: "..." } cached per-gateway customer IDs |
| `created_at`, `updated_at` | timestamptz | |

**Why added fields:** `gateway_customer_ids` caches FW `customer_id` to avoid recreation. `admin_review_note` / `reviewed_by_uid` give an audit trail. Separate `wallet_balance_ngn` / `payouts_balance_ngn` keep the hot path index-free; multi-currency expansion adds `..._usd` columns or migrates to a normalized `merchant_balances` table later.

### merchant_bank_accounts
`id` PK, `merchant_id` FK, `account_number` text, `account_name` text, `bank_code` text FK → bank_codes.code, `currency` text default `'NGN'`, `is_default` boolean, `verified_at` timestamptz, `created_at` timestamptz

**Why:** Merchants may save multiple payout destinations. Account name is verified via `resolveAccountName()` before saving — hence `verified_at`.

### collections
| Column | Type | Notes |
|---|---|---|
| `id` | text PK | nanoid |
| `merchant_id` | text FK → merchants.id not null | **changed from user's `user_id`** — collections belong to merchants |
| `short_code` | text unique not null | public URL slug, e.g. `/pay/abc123` |
| `name` | text not null | |
| `description` | text | |
| `amount` | bigint not null | minor units (kobo for NGN) |
| `currency` | text not null default `'NGN'` | |
| `cover_image_url` | text | replaces `cover_id` — direct Cloudinary URL |
| `is_active` | boolean not null default true | pause without deleting |
| `created_at`, `updated_at` | timestamptz | |

### collection_fields
`id` PK, `collection_id` FK, `position` int, `display_name` text, `field_id` text (form variable name), `type` text, `required` boolean default true, `options` jsonb nullable, `created_at`

**`type` enum values:** `'short_text'`, `'long_text'`, `'number'`, `'email'`, `'phone'`, `'select'`, `'multiselect'`, `'image'`, `'file'`, `'date'`. `options` holds choices for select/multiselect.

**Unique index:** `(collection_id, field_id)`.

### templates
`id` PK, `merchant_id` FK nullable (null = platform-wide), `name` text, `description` text, `created_at`, `updated_at`

**Why:** Need a parent row for name/owner. Only admins create platform templates (`merchant_id = null`).

### template_fields
`id` PK, `template_id` FK, `position` int, `display_name` text, `field_id` text, `type` text, `required` boolean, `options` jsonb

### customer_fields (autofill cache)
`id` PK, `user_id` FK → users.uid, `field_id` text, `display_name` text, `type` text, `value` text, `last_used_at` timestamptz

**Why:** Saves customer-submitted form values for autofill, keyed by `(user_id, field_id)` unique index. `last_used_at` enables staleness pruning.

### payment_accounts (virtual accounts)
`id` PK, `transaction_id` FK → transactions.id, `for_user_id` FK → users.uid, `gateway` text, `gateway_account_id` text, `account_number` text, `account_name` text, `bank_code` text, `bank_name` text, `currency` text, `expiry_at` timestamptz, `created_at`

**Why:** 1:1 with `transaction` since each payment attempt gets a fresh account. `gateway` + `gateway_account_id` makes it gateway-portable. `collection_id` removed (reachable via transaction).

### bank_codes
`code` text + `gateway` text (composite PK), `country` text, `name` text, `updated_at`

**Why:** Bank codes differ between gateways — composite PK avoids future collisions. Seeded from gateway, refreshed nightly.

### transactions (merged Payments + Transactions)
| Column | Type | Notes |
|---|---|---|
| `id` text PK | nanoid | |
| `reference` text unique not null | our idempotency key sent to gateway | |
| `customer_id` text FK → users.uid | the payer | |
| `merchant_id` text FK → merchants.id | denormalized for fast merchant queries | |
| `collection_id` text FK | | |
| `status` text not null default `'pending'` | pending / processing / success / failed / cancelled / expired | |
| `amount` bigint not null | collection amount snapshot in minor units — frozen so later edits don't change history | |
| `platform_fee` bigint not null | snapshot of PLATFORM_FEE at time of payment | |
| `gateway_fee` bigint not null default 0 | reported by gateway via webhook | |
| `total_charged` bigint not null | amount + platform_fee + gateway_fee — what the customer paid | |
| `currency` text not null | | |
| `gateway` text not null | fixed at creation | |
| `gateway_ref` text | gateway's own tx reference | |
| `gateway_id` text | gateway's tx id | |
| `payment_account_id` text FK nullable | back-ref convenience | |
| `paid_at` timestamptz nullable | from webhook | |
| `settled_at` timestamptz nullable | when promoted to payouts_balance | |
| `created_at`, `updated_at` | timestamptz | |

### transaction_fields
`id` PK, `transaction_id` FK, `field_id` text, `display_name` text (snapshot), `value` text, `created_at`

**Why:** `display_name` is snapshotted so deleted/renamed `collection_fields` don't break historical receipts.

### payouts
| Column | Type | Notes |
|---|---|---|
| `id` text PK | | |
| `merchant_id` text FK | FK is to merchants, not raw users | |
| `bank_account_id` text FK → merchant_bank_accounts.id | | |
| `account_number`, `account_name`, `bank_code` text | snapshotted for history | |
| `amount` bigint, `currency` text | | |
| `status` text not null default `'pending'` | pending / processing / success / failed | |
| `gateway` text, `gateway_tx_id` text, `gateway_ref` text unique | our idempotency ref | |
| `failure_reason` text nullable | from gateway | |
| `initiated_by` text not null | `'merchant'` \| `'cron'` | |
| `initiated_by_uid` text FK → users.uid | who clicked withdraw (null if cron) | |
| `created_at`, `updated_at` | | |

### refunds
`id` PK, `transaction_id` FK, `merchant_id` FK, `amount` bigint, `reason` text, `status` text (`pending`/`success`/`failed`), `gateway_ref` text, `initiated_by_uid` FK, `created_at`, `updated_at`

### webhook_events (idempotency log)
`id` PK, `gateway` text, `event_id` text, `event_type` text, `signature_verified` boolean, `payload` jsonb, `processed_at` timestamptz nullable, `processing_error` text nullable, `created_at`

**Unique index:** `(gateway, event_id)` — drops duplicate webhook redelivery.

### audit_logs
`id` PK, `actor_uid` text FK nullable, `action` text, `entity_type` text, `entity_id` text, `metadata` jsonb, `created_at`

**Why:** Critical for: admin merchant approval/rejection, manual payouts, refunds, balance adjustments.

---

## Gateway Abstraction

`src/gateways/types.ts` defines the interface every adapter implements. Business logic in `src/modules/` only depends on this interface — never imports Flutterwave types directly.

```ts
export interface PaymentGateway {
  readonly name: 'flutterwave' | 'paystack' | 'monnify';

  ensureCustomer(args: { uid: string; email: string; name: string }): Promise<{ customerId: string }>;

  createVirtualAccount(args: {
    reference: string;
    customerId: string;
    amount: number;
    currency: string;
    narration: string;
    expirySeconds: number;
  }): Promise<{
    gatewayAccountId: string;
    accountNumber: string;
    accountName: string;
    bankCode: string;
    bankName: string;
    expiryAt: Date;
  }>;

  resolveAccountName(args: { bankCode: string; accountNumber: string; currency: string }):
    Promise<{ accountName: string }>;

  listBanks(country: string):
    Promise<Array<{ code: string; name: string }>>;

  initiateTransfer(args: {
    reference: string;
    amount: number;
    currency: string;
    bankCode: string;
    accountNumber: string;
    narration: string;
  }): Promise<{ gatewayTxId: string; status: 'pending' | 'success' | 'failed' }>;

  verifyWebhookSignature(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): boolean;
  parseWebhookEvent(payload: unknown): NormalizedEvent | null;
}

export type NormalizedEvent =
  | { type: 'charge.success'; gatewayId: string; reference: string; amountPaid: number; gatewayFee: number; currency: string; paidAt: Date; raw: unknown }
  | { type: 'charge.failed'; gatewayId: string; reference: string; reason: string; raw: unknown }
  | { type: 'transfer.completed'; gatewayId: string; reference: string; raw: unknown }
  | { type: 'transfer.failed'; gatewayId: string; reference: string; reason: string; raw: unknown };
```

`src/gateways/registry.ts` exposes `getGateway(name)` and `getDefaultGateway()` (reads `DEFAULT_GATEWAY` env). All business code goes through this.

Flutterwave specifics (OAuth client-credentials at `idp.flutterwave.com`, requests against `f4bexperience.flutterwave.com`) live entirely inside `src/gateways/flutterwave/`. Token caching with TTL belongs in `client.ts`.

**Webhook signature for Flutterwave:** Use the `verif-hash` header compared against `FLUTTERWAVE_WEBHOOK_SECRET`. The webhook route MUST mount `express.raw({ type: 'application/json' })` *before* the global JSON parser so signature verification works on exact bytes.

---

## Required Env Vars (declared in `src/env.ts`)

```
DATABASE_URL                       (existing)
BETTER_AUTH_SECRET                 (existing)
BETTER_AUTH_URL                    (existing)
GOOGLE_CLIENT_ID                   (existing)
GOOGLE_CLIENT_SECRET               (existing)
PORT                               (default 3300)

PLATFORM_FEE_NGN=75
DEFAULT_GATEWAY=flutterwave

FLUTTERWAVE_CLIENT_ID
FLUTTERWAVE_CLIENT_SECRET
FLUTTERWAVE_BASE_URL=https://f4bexperience.flutterwave.com
FLUTTERWAVE_IDP_URL=https://idp.flutterwave.com
FLUTTERWAVE_WEBHOOK_SECRET
FLUTTERWAVE_VIRTUAL_ACCOUNT_BANK_CODE=090772
FLUTTERWAVE_VIRTUAL_ACCOUNT_EXPIRY_SECONDS=1200

CLOUDINARY_CLOUD_NAME
CLOUDINARY_API_KEY
CLOUDINARY_API_SECRET

RESEND_API_KEY
RESEND_FROM_EMAIL
```

---

## Build Phases

Each phase is independently shippable and Bruno-verifiable. Do not start phase N+1 until phase N's verification passes.

### Phase 1 — Schema, env, foundations
- Split [src/db/schema.ts](src/db/schema.ts) into `src/db/schema/` folder; re-export from `index.ts` to preserve `auth.ts` import.
- Add `role` and `default_currency` to users.
- Add all new tables.
- Create `src/env.ts` with typed env loader, throw on missing.
- Add `lib/short-code.ts`, `lib/money.ts`, `lib/fees.ts`.
- Generate + run migration.

**Verify:** `pnpm db:generate` creates migration; `pnpm db:migrate` applies; `pnpm db:studio` shows all tables.

### Phase 2 — Folder layout, middleware, error handling
- Create `src/middleware/{error,validate,require-auth,require-merchant,require-admin,raw-body}.ts`.
- Standard JSON error shape: `{ error: { code, message, details? } }`.
- Mount `express.json()` AFTER `/api/webhooks/*` raw-body routes.

**Verify:** Bad-JSON request returns the standard error shape, not a stack trace.

### Phase 3 — Gateway abstraction + Flutterwave adapter
- `src/gateways/types.ts`, `registry.ts`.
- `src/gateways/flutterwave/{client,adapter,webhook}.ts` implementing the interface.
- OAuth token caching in `client.ts`.
- Script `pnpm tsx scripts/test-fw.ts` calls `listBanks()` end-to-end.

**Verify:** Script prints banks list. Sandbox virtual-account creation succeeds.

### Phase 4 — Merchant module
- `POST /api/merchants/apply`, `GET /api/merchants/me`, `PATCH /api/merchants/me/settings`.
- Bank accounts: `POST/GET/DELETE /api/merchants/me/bank-accounts` (verifies via `resolveAccountName()`).
- Admin endpoints under `/api/admin`: list merchants by status, approve, reject (with note), suspend.
- Bruno specs for every endpoint.

**Verify:** Sign up → apply → admin approves → status flips → audit log written.

### Phase 5 — Banks, Templates, Collections
- `GET /api/banks` proxies cached `bank_codes` (lazy-seed from gateway on first call).
- Templates: admin CRUD platform-wide; merchant CRUD own. `POST /api/templates/:id/fields` manages `template_fields`.
- Collections: merchant CRUD on `/api/collections`, optional `template_id` seeds fields.
- `GET /api/collections/by-code/:short_code` is **public** — returns collection + fields for the pay page.

**Verify:** Approved merchant creates a template, then a collection from it; public endpoint returns the data.

### Phase 6 — Customer payment flow (the core)
- `POST /api/payments/init` (customer auth) — body `{ collection_short_code, field_values }`. Steps: look up collection, validate fields, compute `total_charged`, insert `transactions` (pending), insert `transaction_fields`, upsert `customer_fields`, ensure gateway customer (cached in `merchants.gateway_customer_ids`), call `createVirtualAccount()`, insert `payment_accounts`, return account details + breakdown.
- `GET /api/transactions/:id` — customer or owning merchant can view.
- `POST /api/webhooks/flutterwave` (raw body, no auth): verify signature → insert into `webhook_events` → if `event_id` already processed return 200 → parse to NormalizedEvent → on `charge.success` mark tx success, set paid_at/gateway_fee/gateway_id, credit `merchants.wallet_balance_ngn` by `transactions.amount`, audit log, queue receipt email (Phase 10) → on `charge.failed` mark tx failed → set `webhook_events.processed_at`.

**Verify (most critical phase):**
- Bruno: create collection → init payment as customer → receive virtual account.
- Use Flutterwave sandbox payment OR `curl` synthetic signed webhook.
- Confirm: transaction → success; merchant `wallet_balance_ngn` increased by exactly `amount`; `webhook_events` marked processed; replay is no-op.

### Phase 7 — Background jobs / scheduler
- `src/jobs/scheduler.ts` registers crons (node-cron). Schedules in env, sensible defaults.
- `settle-wallet.ts` (daily 02:00): for `status='success' AND settled_at IS NULL AND paid_at < now()-24h`, move `amount` from `wallet_balance_ngn` → `payouts_balance_ngn`, set `settled_at`. Wrap in DB transaction.
- `refresh-banks.ts` (daily 03:00).
- `scheduled-payouts.ts` (daily/weekly): for merchants with `payout_mode='auto_daily'`/`auto_weekly` and `payouts_balance > minimum`, initiate to `default_bank_account_id`.
- `notification-batcher.ts` (every 15min): flush queued notifications per merchant cadence.

**Verify:** Backdate a `paid_at` >24h, trigger settle-wallet, balances move. Re-trigger — idempotent (no double-credit).

### Phase 8 — Payouts module + Refunds
- `POST /api/payouts` (merchant) — `{ bank_account_id, amount, currency }`. Validates `amount <= payouts_balance`, deducts (escrow), inserts pending `payouts`, calls `initiateTransfer()`, persists `gateway_tx_id`. Gateway error → refund balance + mark failed.
- Auto-payout cron uses same internal `initiatePayout()` with `initiated_by='cron'`.
- Webhook handles `transfer.completed` / `transfer.failed`; on failure credits balance back.
- `GET /api/payouts`, `GET /api/payouts/:id`.
- `POST /api/admin/transactions/:id/refund` (admin or owning merchant) — `{ reason }`. Deducts from `payouts_balance`, inserts `refunds`, calls gateway refund.

**Verify:** Merchant withdraws partial → `payouts_balance` decreases, payout pending, webhook success → completed. Replay idempotent. Refund flow similarly.

### Phase 9 — File uploads (Cloudinary)
- `POST /api/uploads/sign` — returns signed upload params for client direct upload. Auth required.
- At `/api/payments/init`, image/file field values must be Cloudinary URLs under our cloud.

**Verify:** Sign → direct upload to Cloudinary → submit URL as a transaction field.

### Phase 10 — Resend emails + notification batching
- `src/lib/email.ts`: Resend client + templates (receipt, merchant-payment-notification, merchant-application-status, payout-status).
- Customer receipt sent immediately on `charge.success`.
- Merchant payment notification respects `email_notification_period`: `immediate` → send now; others → queue in `email_outbox` table (add here) flushed by `notification-batcher.ts`.
- Admin notification on new merchant applications.

**Verify:** With `immediate` → emails arrive. With `daily` → emails queue and flush on batcher trigger.

### Phase 11 — Admin reporting
- `GET /api/admin/stats`, `GET /api/admin/transactions`, `GET /api/admin/audit-logs`.

**Verify:** Numbers match a hand-run SQL query.

---

## Verification Approach (cross-phase)

1. **Bruno-first**: every endpoint ships with a `.yml` in [api/](api/). Match existing pattern.
2. **Webhook simulation**: `scripts/simulate-fw-webhook.ts` crafts a valid signed payload for a given `reference` so the payment flow can be tested without sandbox.
3. **Idempotency tests**: replay every webhook handler / balance mutation twice and confirm DB state is identical.
4. **Balance invariant**: `sum(transactions.amount where status=success and settled) == sum(merchants.payouts_balance) + sum(payouts.amount where status=success) + sum(refunds.amount where status=success)`. Worth a periodic check script in Phase 11.
5. **DB studio walkthroughs**: after each phase, eyeball `pnpm db:studio`.

---

## Deferred / out of scope (flag if scope changes)

- **SMS notifications**: not in scope.
- **Multi-currency wallet columns**: starting with `_ngn` columns; if USD becomes real, migrate to a normalized `merchant_balances` table.
- **Webhook payload shapes**: Flutterwave Bruno docs don't include them. `flutterwave/webhook.ts` is written against FW's public webhook docs in Phase 3, refined in Phase 6 once a real test event is captured.
- **Rate limiting**: not in v1. Add `express-rate-limit` on public payment endpoints when traffic warrants.
- **API versioning**: skip for v1; add `/api/v2/...` only on breaking change.
