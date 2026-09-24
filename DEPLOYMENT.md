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
  | `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | permanent image storage — set **all three** (a partial set stops the server from starting). See [Images (Cloudinary)](#images-cloudinary) |
  | `GOOGLE_MAPS_API_KEY` | optional — server-side key for address search and reverse geocoding. See [Location (Google Maps)](#location-google-maps) |
  | `GEO_COUNTRY` | two-letter country that address suggestions are limited to (default `in`) |
  | `UPLOAD_DIR` | `uploads` |
  | `MAX_UPLOAD_SIZE_MB` | `5` |
  | `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | leave blank unless you have real Razorpay test-mode keys — see [Payments](#payments) below |

Deploy, then note the URL (e.g. `https://foodrush-backend.onrender.com`).

**Images need Cloudinary on Render.** Render's free instances use an ephemeral filesystem, so
anything written to disk is wiped on the next deploy or restart. Set the three `CLOUDINARY_*`
variables (see [Images (Cloudinary)](#images-cloudinary)) and every upload is stored permanently
there; without them the app falls back to local disk, which is fine for development only.

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

### Images (Cloudinary)

1. Create a free account at [cloudinary.com](https://cloudinary.com) and copy the **cloud name**, **API key**
   and **API secret** from the dashboard.
2. Add them to Render as `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` and redeploy.
   The API secret stays on the backend only — never put it in Vercel or in git.

What happens once it's on:
- Uploads are streamed straight to Cloudinary (nothing is written to Render's disk) as
  `foodrush/<purpose>/<uploader-id>/<random>`; the database stores only the returned `https://` URL.
- The site asks Cloudinary for right-sized, auto-format (`f_auto,q_auto`) versions, so phones don't download
  full-size originals.
- When an owner replaces or deletes an image, the old Cloudinary file is deleted too — only if it sits under that
  owner's id on your own cloud, so nobody can delete another user's image by pasting its URL.
- Who may upload: profile photos (`avatar`) — any signed-in user; `restaurant`, `food`, `category` images —
  restaurant owners and restaurant-management staff. Files must really be JPEG/PNG/WEBP (checked by content, not
  just the extension), up to `MAX_UPLOAD_SIZE_MB`.

**Giving the seeded restaurants real pictures.** The demo catalog has no photos, and they can't be generated for
you — supply your own (or properly licensed stock). Arrange them like this, named after the restaurant / dish:

```
my-photos/
  restaurants/napoli-wood-fire-pizza.jpg        # card thumbnail
  covers/napoli-wood-fire-pizza.jpg             # wide banner (optional)
  logos/napoli-wood-fire-pizza.png              # logo (optional)
  foods/napoli-wood-fire-pizza/margherita-pizza.jpg
```

Then, from `backend/` with `MONGODB_URI` and the `CLOUDINARY_*` variables set:

```bash
npm run import:images -- ../my-photos            # dry run: shows what would be uploaded, changes nothing
npm run import:images -- ../my-photos --apply    # uploads and saves
```

It only fills images that are **empty** (it never overwrites), can be re-run safely, reports files that match no
record, and refuses to run without Cloudinary configured. Until photos exist, cards show a designed placeholder
(a cuisine emoji on a soft gradient) rather than an empty box.

### Location (Google Maps)

Customers choose a "Deliver to" location using GPS, an address search, a saved address, or a list of popular
cities. Only the **address search** and the **GPS-to-address lookup** need Google; without a key the app still
works — GPS coordinates find nearby restaurants and the popular-cities list needs no key at all — and the search
box simply says it's unavailable.

**Design:** the key lives only on the backend. The browser calls FoodRush's own `/api/geo/*` endpoints and never
sees a Google key (so there is no browser key to leak or restrict). Those endpoints are public — guests choose a
location before logging in — and rate-limited per IP (60/min) to protect your quota; the site debounces typing.

Setup:
1. In [Google Cloud Console](https://console.cloud.google.com), create a project and **enable billing** (Maps
   Platform requires it; there is a monthly free credit).
2. Enable **Places API (New)**, **Geocoding API**, and **Maps Static API** (the third is used only for the small
   map image on the delivery-tracking page — see §6).
3. Create an API key and **restrict it to just those APIs**. (Render's free tier has no fixed IP, so an IP
   restriction isn't practical — the API restriction plus the steps below are your protection.)
4. Under *Quotas*, set a **daily request cap**, and create a **budget alert** in Billing, so a bug or abuse can't
   run up a bill.
5. Set `GOOGLE_MAPS_API_KEY` on Render (optionally `GEO_COUNTRY`) and redeploy. `GET /api/config` then reports
   `locationSearchEnabled: true`.

What is (and isn't) stored: a customer's saved address keeps the coordinates they confirmed, as their own delivery
data. FoodRush does not import, list or cache Google's place data, and only **partner restaurants** can take orders —
Google is used purely to turn what someone types, or their GPS position, into an address.

**Restaurants need a location to be found.** "Near me" results only include restaurants that have coordinates.
Owners set theirs on the restaurant profile (address search, or "I'm at the restaurant — use my current location")
together with a **delivery radius** (default 5 km). A restaurant with no location no longer defaults to `[0, 0]`;
it simply doesn't appear in nearby results until one is set. Seeded demo restaurants already have coordinates.

**Delivery range** is enforced when an order is placed: an address that has confirmed coordinates and is farther than
the restaurant's radius is refused. Older addresses saved without coordinates aren't blocked (they can't be
measured); customers are prompted to confirm them. Delivery-time figures are an estimate (the restaurant's own time
plus about 3 minutes per km) until live routing arrives with the delivery milestone.

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

## 6. Real-time delivery tracking (Socket.IO)

Socket.IO attaches to the SAME Express server/port — there is no separate service, process, or port to expose on
Render. `CLIENT_URL`/`CLIENT_URLS` (already required for REST CORS) is the only configuration it needs; it reads
the identical allow-list, so nothing new to set. `LOCATION_UPDATE_MIN_INTERVAL_MS` (default `5000`) is optional —
raise it if you want riders' location updates persisted/broadcast less often.

**What works out of the box:** authenticated live location updates from an assigned, active, KYC-verified rider to
the customer/owner/admin watching that specific order, over a real WebSocket (falling back to HTTP long-polling if
a network in between blocks WebSocket upgrades, which Socket.IO handles automatically).

**Render free-tier limitation — read before relying on this in production.** The `free` plan (see `render.yaml`)
spins the instance down after ~15 minutes with no HTTP traffic, and cold-starts (up to ~50s) on the next request.
Any open Socket.IO connection is dropped the moment the instance spins down. In practice, an active delivery keeps
generating HTTP/socket traffic (location updates, order-status polling) that should keep the instance awake for the
duration of that delivery — but a rider who goes idle mid-shift with no active delivery, or a customer who opens
the tracking page and then the backend happens to spin down between updates, will see their connection drop and
have to reconnect (the frontend's socket client does this automatically, and the customer's tracking page reloads
the last-known position from `GET /orders/:id/tracking` on reconnect — but there will be a visible gap, and a
cold-start delay, until the instance is back up). This is a genuine gap, not a hidden one: **do not represent this
setup as providing always-on, production-grade live tracking on the free plan.** A paid Render plan (no spin-down)
removes this specific issue. Horizontal scaling to multiple instances would additionally need a Socket.IO adapter
(e.g. Redis) plus sticky sessions at the load balancer — not required at a single free-tier instance, and not
implemented here.

## 7. Delivery lifecycle and the delivery-completion OTP (M9)

Full order lifecycle:

```
PLACED -> CONFIRMED -> PREPARING -> READY_FOR_PICKUP -> OUT_FOR_DELIVERY -> DELIVERED
                  \-> CANCELLED               \-> CANCELLED (REFUND_PENDING -> REFUNDED if paid)
       \-> REJECTED (REFUND_PENDING -> REFUNDED if paid)
```

Delivery assignment lifecycle (one order can accumulate several of these — one per
rider it was offered to — but at most one is ever active at a time):

```
OFFERED -> ACCEPTED -> ASSIGNED -> COMPLETED
   \-> REJECTED          \-> CANCELLED
   \-> EXPIRED
```

`READY_FOR_PICKUP -> OUT_FOR_DELIVERY` happens automatically the moment a rider
accepts an offer (M7); a 6-digit delivery OTP is generated in that exact same
instant, never earlier. `OUT_FOR_DELIVERY -> DELIVERED` (and `ASSIGNED ->
COMPLETED`) now happens the moment that rider correctly verifies the OTP — the
**only** way a rider can complete their own assigned delivery. The pre-existing
restaurant/admin manual `PATCH /orders/:id/status` transition to `DELIVERED` is
**unchanged and still works** (e.g. for self-delivery, or if an OTP has expired
with no self-service resend built yet) — M9 did not restrict it, so the
established manual fallback remains available exactly as before.

**OTP security design.** The OTP is AES-256-GCM **encrypted**, not hashed —
deliberately: the customer must be able to re-view the exact code on demand from
`GET /orders/:id/delivery-otp`, which a one-way hash cannot support (nothing can
turn a hash back into what produced it). The encryption key is derived from the
existing `JWT_SECRET` (no new secret to provision, nothing new that can leak), so
a raw database dump alone still cannot recover any OTP — the app's own secret
would also have to leak, exactly the same guarantee a hash would give. The
comparison itself uses a constant-time check. Every verification attempt — right
or wrong — counts against a configurable limit (`DELIVERY_OTP_MAX_ATTEMPTS`,
default 5); exceeding it permanently locks that OTP (no self-service resend in
this milestone — the restaurant/admin manual completion path is the intended
fallback). The OTP expires after `DELIVERY_OTP_EXPIRY_MINUTES` (default 30). Only
the customer who placed the order can ever retrieve it — never the restaurant
owner, the assigned rider, or an admin.

## 8. Delivery earnings and settlement foundation (M10)

Each completed delivery (the exact moment `DeliveryAssignment` reaches
`COMPLETED` — the same single hook both the OTP-verify path and the
restaurant/admin manual-completion fallback funnel through) creates one
`DeliveryEarning` row for the rider who delivered it. This is a **server-side
calculation only**: the amount is derived from `DELIVERY_BASE_EARNING` plus
`DELIVERY_PER_KM_RATE × Order.deliveryDistanceKm` (the same real distance
computed once at order placement in M5 — never a fresh GPS/Maps lookup, never
invented). If the order has no reliable distance, the earning falls back to
base-only rather than guessing one. A configured `DELIVERY_MIN_EARNING` floor
and optional `DELIVERY_MAX_EARNING` ceiling are applied last. A client can
never influence the amount — any `amount`/`netAmount` sent in a request body
is ignored.

Optional environment variables (all have safe defaults; none are required to
deploy):

| Variable | Default | Meaning |
|---|---|---|
| `DELIVERY_BASE_EARNING` | `20` | Flat amount (₹) earned per completed delivery. |
| `DELIVERY_PER_KM_RATE` | `6` | Amount (₹) earned per km of `Order.deliveryDistanceKm`. |
| `DELIVERY_MIN_EARNING` | `20` | Floor applied to the final net amount. |
| `DELIVERY_MAX_EARNING` | unset (no cap) | Optional ceiling applied to the final net amount. |

Earning lifecycle: `PENDING` (created, unsettled) → `SETTLED` (moved there
only when its settlement is marked `PAID`). Settlement lifecycle (admin-only,
gated by the `delivery_settlements:manage` permission — never given to a
rider, restaurant owner, or customer):

```
PENDING -> APPROVED -> PAID
              \-> FAILED -> APPROVED (retry)
```

`PAID` is terminal (no reversal architecture exists yet). An admin generates a
settlement for one rider over a date range; generation atomically claims every
`PENDING`, not-yet-settled earning in that range for that rider before the
settlement document is created, so two concurrent generate requests for the
same rider/period can never both succeed or double-claim the same earnings.
`payoutReference` on `markPaid` is an admin-entered note for bookkeeping only —
**this milestone does not integrate any real bank/UPI/payment-gateway payout**;
it is a settlement-tracking foundation, not a money-transfer system.

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
| Uploaded images vanish after a while | Cloudinary isn't configured, so uploads are on Render's ephemeral disk — set the three `CLOUDINARY_*` variables |
| Server won't start: "Cloudinary is partially configured" | Only one or two of the three `CLOUDINARY_*` variables are set — set all three, or clear them |
| "Address search isn't available right now" | `GOOGLE_MAPS_API_KEY` isn't set on Render (GPS and popular cities still work), or the key isn't restricted to/allowed for Places API (New) and Geocoding API — check the Render logs for `Google Places … failed: <STATUS>` |
| A restaurant doesn't show up in "near me" | It has no location set, or the customer is farther away than the restaurant's delivery radius — owners set both on the restaurant profile |
| Uploading a restaurant/food image returns 403 | Only restaurant owners and restaurant-management staff may upload those; customers can upload profile photos only |
| `/api/auth/register` with `role: "ADMIN"` fails | Intentional — see `auth.validator.js`; provision admins via `npm run seed` or directly in the database |
