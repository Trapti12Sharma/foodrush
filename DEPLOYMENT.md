# Deploying FoodRush

A free-tier deployment path: **MongoDB Atlas** (database) + **Render** (backend) +
**Vercel** (frontend). Nothing here requires a paid plan.

## 1. Database — MongoDB Atlas

1. Create a free M0 cluster at [cloud.mongodb.com](https://cloud.mongodb.com).
2. Database Access → add a database user (username/password).
3. Network Access → allow `0.0.0.0/0` (Atlas's free tier has no static-IP
   allowlisting for a Render app, so this is the practical choice — Atlas
   still requires the correct username/password on every connection).
4. Copy the connection string:
   `mongodb+srv://<user>:<password>@<cluster>.mongodb.net/foodrush`

## 2. Backend — Render

`render.yaml` describes the service; either point Render at this repo
and let it read that file, or configure manually:

- Root directory: `backend`
- Build command: `npm install`
- Start command: `npm start`
- Environment variables:
  | Key | Value |
  |---|---|
  | `NODE_ENV` | `production` |
  | `MONGODB_URI` | the Atlas connection string from step 1 |
  | `JWT_SECRET` | a long random string (Render can generate one) |
  | `JWT_EXPIRES_IN` | `7d` |
  | `CLIENT_URL` | your Vercel URL — add this *after* step 3, then redeploy |
  | `CLIENT_URLS` | optional — extra allowed frontend origins, comma-separated (e.g. a custom domain). Exact match; `https://` required in production |
  | `EMAIL_PROVIDER` | `smtp` or `resend` to enable password-reset emails (default `none` = disabled) — see [Email](#email-password-reset) |
  | `EMAIL_FROM` | sender, e.g. `FoodRush <no-reply@yourdomain.com>` (required for `smtp`/`resend`) |
  | `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` | for `EMAIL_PROVIDER=smtp` |
  | `RESEND_API_KEY` | for `EMAIL_PROVIDER=resend` |
  | `APP_URL` | optional — public web-app URL used in emailed links (defaults to the first `CLIENT_URL`) |
  | `UPLOAD_DIR` | `uploads` |
  | `MAX_UPLOAD_SIZE_MB` | `5` |
  | `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | leave blank unless you have real Razorpay test-mode keys — see [Payments](#payments) below |

Deploy, then note the URL (e.g. `https://foodrush-backend.onrender.com`).

**Image uploads on Render's free tier do not persist.** Render's free
instances use an ephemeral filesystem — anything written to `backend/uploads/`
(every image uploaded through the app) is wiped on the next deploy or restart.
Local disk storage (`storage.service.js`) is correct and sufficient for local
development, but a real deployment needs Cloudinary or S3 configured instead.
The abstraction is already in place for this (see `storage.service.js`'s
`isCloudinaryConfigured()` guard) — the Cloudinary upload call itself is not
implemented, since it can't be tested without a real Cloudinary account; see
the comment in that file for exactly what to add.

## 3. Frontend — Vercel

`frontend/vercel.json` sets the build command, output directory, and the SPA
rewrite rule React Router needs (without it, refreshing on any route other
than `/` would 404).

- Root directory: `frontend`
- Framework preset: Vite
- Environment variable: `VITE_API_URL` = `https://foodrush-backend.onrender.com/api`

Deploy, then note the URL (e.g. `https://foodrush.vercel.app`) and go back to
Render to set `CLIENT_URL` to it, then redeploy the backend so CORS allows it.

### Startup checks and health probe

On start the backend validates its configuration and **refuses to boot** (printing which
variable is wrong, never its value) if `MONGODB_URI` or `JWT_SECRET` is missing, if
`JWT_SECRET` is a placeholder or shorter than 32 characters in production, or if a client
URL is not a valid `https://` origin. `CLIENT_URL`/`CLIENT_URLS` are trimmed and reduced to
a bare origin, so a stray space or trailing slash pasted into the dashboard is tolerated.

`GET /health` returns `200` when the database is connected and `503` when it is not — point
Render's health check or an uptime monitor at it. (`GET /api/health` is unchanged.)

### Creating the real super admin

The public demo `ADMIN` account should not be your production admin. From `backend/`, with
`MONGODB_URI` pointing at the target database:

```bash
# dry run — prints what it would do, changes nothing
SUPER_ADMIN_EMAIL=you@yourdomain.com npm run bootstrap:admin
# apply — promotes that user (or creates it; then SUPER_ADMIN_PASSWORD, 12+ chars, is required)
SUPER_ADMIN_EMAIL=you@yourdomain.com npm run bootstrap:admin -- --apply
```

It modifies only that one user and records an audit-log entry. Only a `SUPER_ADMIN` can read
`GET /api/admin/audit-logs` or change the status of staff accounts.

### Email (password reset)

Password reset and the "your password was changed" notice are sent through the provider named by
`EMAIL_PROVIDER`; switching provider is a settings change, not a code change.

| `EMAIL_PROVIDER` | Needs | Notes |
|---|---|---|
| `none` (default) | — | Email disabled. The forgot-password endpoint still answers normally but nothing is delivered, and the backend logs a warning at boot in production. |
| `smtp` | `SMTP_HOST`, `EMAIL_FROM` (+ `SMTP_USER`/`SMTP_PASS` if the server needs a login) | Works with any SMTP service, including a Gmail app password (`smtp.gmail.com`, port 587). |
| `resend` | `RESEND_API_KEY`, `EMAIL_FROM` | Resend's HTTP API; `EMAIL_FROM` must be on a domain you've verified with them. |
| `log` | — | **Development only** — prints the email (including the reset link) to the console. Refused in production. |

The reset link is valid for 30 minutes and works once; only a hash of the token is stored. The
forgot-password endpoint gives the same reply whether or not an email is registered, and sends at
most one email per minute per account. Changing or resetting a password signs out every other
session. If reset emails don't arrive, check the Render logs for `Password reset email failed:`
(the provider's error, never the link).

## 4. Cross-origin auth cookie

The frontend and backend are on different domains in this setup (unlike local
dev, where `localhost:5173`/`:5000` count as the same *site*). The auth cookie
is set with `SameSite=None; Secure` whenever `NODE_ENV=production`
(`token.service.js`) specifically so it's still sent on cross-site API calls —
this requires HTTPS on both sides, which Render and Vercel provide by default.
If login appears to succeed but `/api/auth/me` immediately reports logged-out,
the most likely cause is `CLIENT_URL` on the backend not exactly matching the
frontend's origin (protocol + domain, no trailing slash).

## 5. Demo data

```bash
# from the backend/ directory, with MONGODB_URI pointed at your Atlas cluster
npm run seed
```

Creates the three demo accounts (`admin@example.com`, `restaurant@example.com`,
`customer@example.com`, all password `password123`) plus a sample restaurant,
menu, order, review, and coupon. Safe to re-run — it upserts rather than
duplicating. **Do not run this against a database you intend to put real users
in** — the credentials are public (they're printed in this document).

## Payments

Real online payments require a Razorpay account. Set `RAZORPAY_KEY_ID` and
`RAZORPAY_KEY_SECRET` and the app will accept `ONLINE` as a payment method up
to the point of actually creating a Razorpay order — `payment.service.js`'s
`createRazorpayOrder()` is an intentional `501 NOT IMPLEMENTED` (a real
Razorpay order-creation call can't be verified without a live account); the
signature-verification half of the flow (`POST /orders/:id/verify-payment`)
*is* fully implemented and tested. Without those two env vars, only Cash on
Delivery is offered — the frontend's checkout page disables the Online option
automatically (`GET /api/config`), rather than presenting a dead end.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Frontend loads but every API call fails with a CORS error | `CLIENT_URL` on the backend doesn't match the frontend's actual origin |
| Login succeeds but the session doesn't persist | `NODE_ENV` isn't set to `production` on the backend (cookie stays `SameSite=Lax`, which cross-site calls drop), or the frontend isn't served over HTTPS |
| Uploaded images vanish after a while | Expected on Render's free tier (ephemeral disk) — configure Cloudinary |
| `/api/auth/register` with `role: "ADMIN"` fails | Intentional — see `auth.validator.js`; provision admins via `npm run seed` or directly in the database |
