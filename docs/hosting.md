# Hosting & running the API

The API is an Express 5 app (`src/app.ts`) that talks to Postgres through Drizzle.
Both local development and Render run the same two commands: migrate, then start.

## 1. Local development

```bash
pnpm install
cp .env.example .env      # or create .env by hand (see table below)
pnpm db:migrate           # applies ./drizzle migrations
pnpm dev                  # tsx watch src/app.ts
```

Health check: `curl http://localhost:3001/health` → `{"status":"ok"}`

### Required env vars

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | Postgres connection string. The app exits on boot without it. |
| `BETTER_AUTH_SECRET` | yes | Session signing key. `openssl rand -hex 32`. |
| `BETTER_AUTH_URL` | no | Public origin of **this** API, e.g. `http://localhost:3001`. Defaults to `http://localhost:3001`. |
| `PORT` | no | Defaults to `3001`, which is what the dashboard expects. |
| `ALLOWED_ORIGINS` | no | Comma-separated browser origins allowed to call the API. Defaults to the local dashboard/landing plus `https://app-jeneviv.onrender.com`. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | no | Google sign-in. When unset the API logs a warning and disables that provider; email + password keeps working. |
| `PLATFORM_FEE_NGN`, `DEFAULT_GATEWAY` | no | `75`, `flutterwave`. |
| `FLUTTERWAVE_CLIENT_ID` / `_SECRET` / `_WEBHOOK_SECRET` | for payments | Needed by `/api/banks` and virtual accounts. Without them `/api/banks` returns `500`. |
| `PAYSTACK_SECRET_KEY` | for payments | Only when `DEFAULT_GATEWAY=paystack`. |
| `CLOUDINARY_*` | for uploads | `/api/uploads/sign`. |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | for email | Notification batcher. |
| `CRON_SECRET` | for jobs | See [cron-jobs.md](./cron-jobs.md). |

### Two local gotchas

- **`PORT` in your shell wins over `.env`.** `dotenv` does not overwrite variables that are
  already exported, and some shells export `PORT=0`. A `PORT` of `0` binds a random ephemeral
  port, so the server looks "down" at the address clients use. `src/env.ts` ignores
  out-of-range ports and logs the value it substituted, but check `echo $PORT` if the API is
  not where you expect.
- **The dashboard calls the API cross-origin.** The Vite app runs on `:5173` while the API runs
  on `:3001`, and it sends the better-auth session cookie with `credentials: "include"`. That
  needs the CORS middleware in `src/middleware/cors.ts` plus the same-origin allowance in
  better-auth's `trustedOrigins`. If you serve the dashboard from another host, add that origin
  to `ALLOWED_ORIGINS` — otherwise the browser blocks every request and the app silently falls
  back to its demo dataset.

## 2. Render

The API runs as a Render **Web Service**, the dashboard as a Render **Static Site**, and the
scheduled jobs as Render **Cron Jobs** that call the job endpoints over HTTP.

1. **Create the Web Service** from the GitHub repo `jeneviv-com/jeneviv-backend`.
   - Runtime: Node (Render reads the pnpm lockfile).
   - Build: `pnpm install --frozen-lockfile && pnpm build`
   - Start: `node dist/app.js`
   - Health check path: `/health`
2. **Add the Postgres instance** and set `DATABASE_URL` from its *Internal* connection string
   (same-region services), so the API does not pay for an external round trip.
3. **Run migrations.** Either append `&& pnpm db:migrate` to the build command, or run
   `pnpm db:migrate` once against the production `DATABASE_URL`. `drizzle.config.ts` prints the
   URL it is about to use, so check that output in the deploy logs.
4. **Set the remaining env vars** in the service's *Environment* tab. `PORT` is injected by
   Render — do not set it. Set `BETTER_AUTH_URL` to the public API origin
   (`https://api-jeneviv.onrender.com` or a custom domain), because better-auth builds redirect
   and callback URLs from it.
5. **Register the Paystack webhook** at `https://api-jeneviv.onrender.com/api/webhooks/paystack`,
   using the same secret key that is set on the service.
6. **Configure cron jobs** for the background work — see [cron-jobs.md](./cron-jobs.md).
7. **Point the dashboard at it.** In the Vite webapp set `VITE_API_URL=https://api-jeneviv.onrender.com`
   and rebuild, then make sure the dashboard origin (`https://app-jeneviv.onrender.com` or the
   custom domain) is in `ALLOWED_ORIGINS` on the API.

> Render's free instance type suspends a service after a period of inactivity, so the first
> request after a quiet spell takes a few seconds. Cron jobs keep the API awake only if their
> schedule is frequent enough.

## 3. Deploy checklist

- [ ] `pnpm build` passes (this is the typecheck).
- [ ] `GET /health` returns `{"status":"ok"}` on the deployed origin.
- [ ] `DATABASE_URL` points at the intended database and `pnpm db:migrate` has run.
- [ ] Sign-up, session, and a protected route work from the deployed dashboard origin.
- [ ] `ALLOWED_ORIGINS` contains the deployed dashboard origin.
- [ ] Gateway, Cloudinary, Resend and `CRON_SECRET` vars are present if those features are used.
- [ ] The Paystack webhook URL on the dashboard matches the deployed origin.
- [ ] Every job listed by `GET /api/jobs` has a Render cron job, and the two lists agree.
