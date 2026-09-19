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

`backend/render.yaml` describes the service; either point Render at this repo
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
