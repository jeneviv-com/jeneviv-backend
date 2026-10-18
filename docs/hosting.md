# Hosting & running the API

The API is an Express 5 app (`src/app.ts`) that talks to Postgres through Drizzle.
Both local development and Railway run the same two commands: migrate, then start.

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
| `ALLOWED_ORIGINS` | no | Comma-separated browser origins allowed to call the API. Defaults to the local dashboard/landing plus `https://jeneviv.up.railway.app`. |
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

## 2. Railway

1. **Create the service** from the GitHub repo `jeneviv-com/jeneviv-backend` (Railway detects
   the pnpm lockfile).
   - Build: `pnpm install --frozen-lockfile && pnpm build`
   - Start: `node dist/app.js`
   - Health check path: `/health`
2. **Add the Postgres plugin** and reference its variable, so `DATABASE_URL` is injected:
   `DATABASE_URL=${{Postgres.DATABASE_URL}}`
3. **Run migrations.** Either add `pnpm db:migrate` to the build command
   (`pnpm install --frozen-lockfile && pnpm build && pnpm db:migrate`), or run it once from a
   shell against the production `DATABASE_URL`. `drizzle.config.ts` prints the URL it is about
   to use, so check that output in the deploy logs.
4. **Set the remaining env vars** listed above. `PORT` is injected by Railway — do not set it.
   Set `BETTER_AUTH_URL` to the public API origin (`https://<service>.up.railway.app` or your
   custom domain), because better-auth builds redirect and callback URLs from it.
5. **Configure cron jobs** for the background work — see [cron-jobs.md](./cron-jobs.md).
6. **Point the dashboard at it.** In the Vite webapp set `VITE_API_URL=https://<api-origin>`
   and rebuild, then make sure that dashboard origin is in `ALLOWED_ORIGINS` on the API.

> Note: no Railway service is currently live at `jeneviv.up.railway.app` for the API — that
> host answers requests with `x-railway-fallback: true` and `{"message":"Application not found"}`,
> which is Railway's edge saying nothing is deployed there.

## 3. Deploy checklist

- [ ] `pnpm build` passes (this is the typecheck).
- [ ] `GET /health` returns `{"status":"ok"}` on the deployed origin.
- [ ] `DATABASE_URL` points at the intended database and `pnpm db:migrate` has run.
- [ ] Sign-up, session, and a protected route work from the deployed dashboard origin.
- [ ] `ALLOWED_ORIGINS` contains the deployed dashboard origin.
- [ ] Gateway, Cloudinary, Resend and `CRON_SECRET` vars are present if those features are used.
