# Cron Jobs

Background work in Jeneviv runs as HTTP endpoints, not in-process timers. **Render cron jobs** call these endpoints on a schedule, which keeps job execution decoupled from the app process, survives deploys cleanly, and gives us per-run logs in Render's dashboard.

## How it works

- `GET /api/jobs` — public discovery endpoint. Returns the list of all jobs with their recommended UTC cron expressions. Use this when configuring Render.
- `POST /api/jobs/:name/run` — runs the named job. Requires `Authorization: Bearer ${CRON_SECRET}`. Returns `{ job, status, duration_ms, result }` on success, or `{ job, status: "error", message }` on failure (HTTP 500).

The secret check uses constant-time comparison. A missing `CRON_SECRET` returns 503 `cron_secret_not_configured` rather than silently letting requests through.

## Setup (one-time, per environment)

1. **Generate a strong secret** and set it as `CRON_SECRET` in the API service's Render env vars:
   ```bash
   openssl rand -hex 32
   ```

2. **List the jobs** to see exactly what to configure:
   ```bash
   curl https://api-jeneviv.onrender.com/api/jobs
   ```

3. **Create one Render cron job per entry**. In Render → New → Cron Job, for each job:
   - **Schedule:** the `cron` expression from `/api/jobs` (Render evaluates it in UTC).
   - **Command:**
     ```bash
     curl -fsS -X POST \
       -H "Authorization: Bearer $CRON_SECRET" \
       https://api-jeneviv.onrender.com/api/jobs/<job-name>/run
     ```
   - **Env:** add `CRON_SECRET` to the cron job's own environment group as well; the command
     runs in the cron job container, not inside the web service.

The `-f` flag makes curl exit non-zero on HTTP errors so Render marks the run as failed.

## Job catalog

| Name | Cron (UTC) | What it does | Owner phase |
|---|---|---|---|
| `settle-wallet` | `0 2 * * *` | Promote `status='success' AND settled_at IS NULL AND paid_at < now()-24h` transactions from `wallet_balance_ngn` to `payouts_balance_ngn`. Idempotent — re-running is a no-op. | Phase 7 |
| `refresh-banks` | `0 3 * * *` | Re-pull bank codes from the default gateway and upsert into `bank_codes`. | Phase 7 |
| `scheduled-payouts-daily` | `0 4 * * *` | For approved merchants with `payout_mode='auto_daily'`, non-null `default_bank_account_id`, and `payouts_balance >= AUTO_PAYOUT_MIN_NGN_MAJOR * 100`, initiate a payout via `initiatePayout({ initiatedBy: 'cron' })`. | Phase 7 (query) / Phase 8 (transfer) |
| `scheduled-payouts-weekly` | `0 4 * * MON` | Same as above, for `payout_mode='auto_weekly'`. | Phase 7 / Phase 8 |
| `notification-batcher` | `*/15 * * * *` | Flush queued merchant email notifications per `email_notification_period`. | Phase 10 |
| `reconcile-pending` | `*/10 * * * *` | Re-verify old `pending` transactions with the gateway and record any that were paid while the webhook was missed. | Phase 9 |

The payout jobs (`settle-wallet`, `scheduled-payouts-daily`, `scheduled-payouts-weekly`) are
only registered when `DEFAULT_GATEWAY` is not `paystack` — split gateways settle straight to
the merchant's subaccount, so Jeneviv never holds those funds. Everything else is always
registered.

`GET /api/jobs` is the source of truth — if a job's cron changes in code, the answer there updates.

## Required env vars

| Var | Purpose | Default |
|---|---|---|
| `CRON_SECRET` | Bearer token Render sends in the `Authorization` header. | (none — endpoints return 503 if unset) |
| `AUTO_PAYOUT_MIN_NGN_MAJOR` | Minimum `payouts_balance` (in naira) before `scheduled-payouts-*` will sweep a merchant. | `1000` (₦1,000 = 100,000 kobo) |

## Manual invocation (debugging / one-off backfills)

Same endpoint, just call it directly:

```bash
curl -fsS -X POST \
  -H "Authorization: Bearer $CRON_SECRET" \
  http://localhost:3001/api/jobs/settle-wallet/run | jq
```

Response shape:

```json
{
  "job": "settle-wallet",
  "status": "ok",
  "duration_ms": 164,
  "result": { "settled": 1, "total_amount_ngn": 150000 }
}
```

Errors return HTTP 500 with:

```json
{
  "job": "settle-wallet",
  "status": "error",
  "duration_ms": 12,
  "message": "<error message>"
}
```

## Idempotency contract

Every job in the registry must be safe to invoke multiple times within its cadence — Render may retry on failure, and operators sometimes manually re-run after fixing a bug. Specifically:

- `settle-wallet`: uses a per-row `settled_at IS NULL` guard inside the UPDATE — already-settled rows are skipped atomically.
- `refresh-banks`: `INSERT ... ON CONFLICT DO NOTHING` on `(code, gateway)`.
- `scheduled-payouts-*`: each payout has a unique `gateway_ref` sent to the gateway as an idempotency key.
- `notification-batcher`: rows are marked sent before the next batch runs.
- `reconcile-pending`: hands each verified charge to the same idempotent success handler the
  webhook uses, so a webhook that arrives late is a no-op.

If you add a new job, preserve this contract.

## Adding a new job

1. Create `src/jobs/<name>.ts` exporting an async `run()` function. Wrap any state mutation in a DB transaction with a guard that makes re-runs no-ops.
2. Register it in [src/jobs/registry.ts](../src/jobs/registry.ts):
   ```ts
   "<name>": {
     name: "<name>",
     description: "<one-liner>",
     cron: "<utc cron expression>",
     run: () => runYourJob(),
   }
   ```
3. Ship the change. An operator then adds the corresponding Render cron job using the new `/api/jobs` entry.
