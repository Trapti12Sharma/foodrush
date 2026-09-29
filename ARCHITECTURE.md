# FoodRush — Architecture

How the system is built and why. Operational setup lives in
[DEPLOYMENT.md](DEPLOYMENT.md); the endpoint reference is Swagger at
`/api/docs`, generated from the routes themselves so it cannot drift.

This document describes what the code **does**, not what it was hoped to do.
Where something is absent or partial, it says so.

---

## 1. Shape of the system

A single Express API and a single React SPA, sharing one MongoDB.

```
React SPA (Vite)  ──HTTP/JSON──▶  Express API  ──▶  MongoDB
      │                               │
      └───────Socket.IO───────────────┘
                                      ├──▶ Cloudinary   (images)
                                      ├──▶ Razorpay     (payments, refunds)
                                      ├──▶ Google Maps  (geocoding, search)
                                      └──▶ SMTP/Resend  (email)
```

Every external provider is optional. With none configured the platform still
runs: images fall back to local disk, only Cash on Delivery is offered, address
search is disabled in favour of typed addresses, and email is skipped. This is
deliberate — a developer should be able to clone the repo and place an order
without signing up for four services.

### Request path

```
route → middleware (auth, permission, rate limit, validator) → controller → service → model
```

The layer that matters is **service**. Controllers unwrap the request and wrap
the response; they contain no business rules. Anything that decides something —
what an order may transition to, who may reply to a review, what counts as a
sale — lives in a service, which is why the same rule holds whether it is
reached from a customer route, an admin route, or a background path.

**Backend**: 25 models · 32 services · 25 controllers · 24 route files ·
16 validators · 6 scripts · 132 documented paths / 159 operations.
**Frontend**: 44 pages · 34 components · 41 build chunks.

### Folder layout

```
backend/src/
  config/      db connection, env validation, swagger, cors
  controllers/ thin request/response handlers
  middleware/  auth, permissions, rate limiting, uploads, error handling
  models/      Mongoose schemas — the only place field shapes are defined
  realtime/    Socket.IO server, auth, and room management
  routes/      Express routers + the Swagger JSDoc for each endpoint
  services/    business logic; the authoritative layer
  utils/       ApiError/ApiResponse, permissions table, constants, pagination,
               date ranges, geo helpers
  validators/  express-validator chains, one per resource
backend/scripts/  one-off operational scripts (migrations, bootstrap, smoke test)
backend/tests/    40 Jest files

frontend/src/
  pages/       route-level views, grouped by audience (admin/, owner/, delivery/)
  components/  reusable UI, incl. charts/ and analytics/
  context/     auth, cart, favorites, location, notifications
  layouts/     per-audience shells
  services/    Axios clients, one per resource
```

---

## 2. Roles and permissions

Nine roles, eighteen permissions. Authorization asks *"may this user do X?"*,
never *"is this user an admin?"* — so adding a staff role is an edit to one
table (`utils/permissions.js`) rather than a hunt through the codebase.

| Role | How it is created | Holds |
|---|---|---|
| `CUSTOMER` | self-registration | no platform permissions |
| `RESTAURANT_OWNER` | self-registration | no platform permissions |
| `DELIVERY_PARTNER` | self-registration + KYC | no platform permissions |
| `SUPER_ADMIN` | bootstrap script, or promoted by a super admin | everything |
| `ADMIN` | super admin | everything except `settings:manage`, `admins:manage`, `audit:read` |
| `OPERATIONS_MANAGER` | super admin | dashboard, users read, restaurants read, orders |
| `RESTAURANT_MANAGER` | super admin | restaurants (incl. approve), reviews:moderate |
| `DELIVERY_MANAGER` | super admin | orders read, delivery partners/assignments/settlements |
| `SUPPORT_AGENT` | super admin | dashboard, users read, orders read, support tickets |

**The three resource-scoped roles hold no platform permissions at all.** What a
customer, owner or rider may touch is decided by an ownership check against the
specific record (`utils/ownership.js`), never by their role. A restaurant owner
has no blanket "manage restaurants" power; they have power over restaurants
whose `owner` field is their own id, re-read from the database on every request.

Hiding a button is never the boundary. The frontend filters admin nav links by
permission for usability, and the API re-checks on every call regardless.

---

## 3. Lifecycles

### Order

```
PLACED ──▶ CONFIRMED ──▶ PREPARING ──▶ READY_FOR_PICKUP ──▶ OUT_FOR_DELIVERY ──▶ DELIVERED
   │            │             │
   ├────────────┴─────────────┴──▶ CANCELLED        (customer, or staff)
   └──▶ REJECTED                                    (restaurant declines)

any of CANCELLED / REJECTED / DELIVERED ──▶ REFUND_PENDING ──▶ REFUNDED
```

Ten statuses. Transitions are an explicit allow-list in `utils/constants.js`
enforced in `order.service.js` — never `order.status = req.body.status`. A
customer cannot advance their own order; the restaurant drives it to
`READY_FOR_PICKUP`, and from there the **rider** drives it, not the restaurant.

There is no separate `PICKED_UP` status. A rider accepting an offer moves the
order straight to `OUT_FOR_DELIVERY`; pickup is tracked on the *assignment*
(`acceptedAt`, `assignedAt`), not on the order. One fact, one owner.

`READY_FOR_PICKUP` is the dispatch trigger — reaching it fires rider search.

### Delivery

```
rider registers ──▶ KYC SUBMITTED ──▶ admin VERIFIED ──▶ ACTIVE ──▶ may go ONLINE
                                          └──▶ REJECTED

order READY_FOR_PICKUP
   └─▶ geospatial search for ONLINE, ACTIVE, KYC-VERIFIED riders within range
         └─▶ OFFERED ──accept──▶ ACCEPTED ──claim order──▶ ASSIGNED ──▶ COMPLETED
               ├──reject──▶ REJECTED  → immediately re-dispatched to the next rider
               └──no response──▶ EXPIRED (detected lazily, never by a timer)
```

A rider cannot go online before KYC verification. At most one *active*
assignment per order, enforced by a partial unique index in the database rather
than by application checks alone. `ACCEPTED` and `ASSIGNED` are distinct because
claiming the order is a separate atomic step that can lose a race; the loser is
`CANCELLED` rather than left stuck.

Completion requires the **customer's OTP**: six digits, generated when the rider
accepts, stored AES-256-GCM-encrypted with every field `select: false`, capped
attempts, and compared in constant time. A rider cannot declare a delivery done.

### Payment

```
COD    ─▶ order placed, paymentStatus pending, settled in cash
ONLINE ─▶ Razorpay order created ─▶ Payment attempt (CREATED)
              ├─ browser returns ─▶ signature verified ─▶ PAID
              └─ browser never returns ─▶ webhook payment.captured ─▶ PAID
```

`Payment` is one row per **attempt**, not per order — a customer who fails once
and retries has two rows and one paid order. Both confirmation paths converge:
the attempt only advances if not already `PAID`, the order update is
conditional, and both build the same notification `eventKey` from the Razorpay
payment id, so one real payment produces one notification.

Signature verification (both the browser callback and the webhook) uses
`crypto.timingSafeEqual`. The webhook route is mounted **before** the JSON body
parser because the signature is over raw bytes.

### Refund

```
paid order in CANCELLED / REJECTED / DELIVERED
   └─▶ Refund PENDING ─▶ Razorpay ─▶ COMPLETED   (or PROCESSING → webhook → COMPLETED)
                                   └─▶ FAILED
```

A completed refund moves the order to `REFUNDED`. **One refund per order**: the
service is idempotent and a second call returns the first, which is what stops a
doubled cancellation path refunding twice. A single *partial* amount works; a
sequence of partial refunds does not. A cancelled COD order produces no refund —
a cancelled order is never assumed to be a refunded one.

### Coupon

Validated at three points — when applied to the cart, again at order creation,
and against a `CouponUsage` row unique per order. The re-validation at order
creation is what stops a coupon that expired, was exhausted, or stopped
qualifying between "apply" and "place" from being honoured. Scope can be global,
per-restaurant or per-city, with global and per-user usage limits.

### Review

```
customer reviews a DELIVERED order ─▶ PENDING ─▶ APPROVED ─▶ HIDDEN ─▶ APPROVED
                                            └──▶ REJECTED               (restore)
```

One review per **order**, enforced by a unique index — which also proves the
reviewer actually ordered. Only `APPROVED` reviews are public and only they move
the restaurant's rating. Editing a review's content resets it to `PENDING`, so
approved text cannot be swapped for something unreviewed.

Moderation transitions are **atomic conditional updates** (the required source
status is part of the query filter), so two moderators acting at once have
exactly one winner.

Restaurants may reply to approved reviews. Writing a reply is restricted to the
restaurant's **owner** — not to staff holding `restaurants:manage`, who may edit
the profile and submit KYC. Editing a profile is administration; publishing
words under a business's name is speech. Deleting a reply is allowed to the
owner *or* a moderator, because replies are published without a queue and
removing an abusive one cannot depend on its author.

Reports are one per (review, reporter), unique-indexed. **Reporter identity is
never returned by any API response, including admin ones.**

### Restaurant onboarding

```
owner registers ─▶ creates restaurant (not live) ─▶ KYC SUBMITTED ─▶ admin approve
                                                          └──▶ REJECTED ─▶ resubmit
```

Approval requires KYC to be submitted, and sets `isApproved` and
`kycStatus: VERIFIED` in one action. `kycStatus` is deliberately **decoupled**
from `isApproved`/`isActive`: a live restaurant renewing an expiring FSSAI
licence, or having that renewal rejected, never goes offline as a side effect.
Taking a restaurant offline remains an explicit admin action.

---

## 4. Cross-cutting systems

**Notifications** — 38 types through one service. Every call creates an in-app
row, pushes it over Socket.IO to the recipient's own room, and *optionally*
emails it. An `eventKey` with a unique index makes duplicates impossible: a
retried request or a redelivered webhook returns the existing notification.
`notify()` never throws, so a notification failure cannot fail the order or
payment that triggered it. Email is gated by user preference; the in-app record
never is.

**Audit log** — append-only, with Mongoose hooks blocking edits and deletes.
Keys matching a credential pattern are redacted before storage, so the audit
trail cannot become a place secrets leak from. Writes are best-effort: a failed
audit write is logged but never fails the action it describes.

**Analytics** — MongoDB aggregations only; nothing loads a collection into Node.
Every figure is date-ranged through one shared parser, explicitly **UTC** and
half-open `[start, end)`. A metric that cannot be computed returns `null`, not
`0` — "no orders to divide by" is not "a 0% completion rate". Each slice is
gated by the permission governing that data domain, so a support agent sees
customer counts but not payment figures.

**Realtime** — Socket.IO shares the HTTP server and the same JWT resolution as
REST, so a deactivated account loses both transports at once. Clients join their
own `user:<id>` room; rooms are server-assigned, never client-chosen.

**Images** — streamed to Cloudinary, never written to disk in production. Upload
purpose is an allow-list checked against the caller's role; files are validated
by content, not extension. Each stored image keeps its Cloudinary `public_id`,
always derived server-side, so a replacement deletes exactly the right asset.

**Location** — the Google Maps key is server-side only; the browser never sees
it. All geocoding goes through a backend proxy with its own rate limit.

---

## 5. Testing

```
cd backend  && npm test    # 40 files, 763 tests
cd frontend && npm test    # 6 files, 36 tests
```

Backend tests run against a real local MongoDB in a **per-run database**
(`foodrush_test_<pid>_<random>`), dropped on completion. Two runs cannot collide.
No in-memory MongoDB — it would require downloading a binary that is not
reachable in every environment.

Tests exercise real HTTP through supertest against the real app. Almost nothing
is mocked: an order in a test is placed by a customer, driven through the real
status machine by the real restaurant, and delivered by a real rider with a real
OTP. `tests/e2eJourney.test.js` walks the entire lifecycle in a single test for
exactly this reason — the milestones each have their own passing tests, and what
that does not prove is that they connect.

`--forceExit` is deliberately **not** used. It masked a connection leak for
months by killing the process before the leak could show.

### What a green suite does and does not earn

Three separate incidents in this codebase found defects that a passing suite
could not have found, and it is worth stating them together:

- An end-to-end walk found two wrong assumptions about the API that the
  endpoints' own tests shared, because the same person wrote both.
- Running the app in a browser found a deployment-blocking config bug and an
  invite flag that never cleared — neither reachable from any test, because one
  needs a config shape the tests never construct and the other an account the
  tests never create.
- Two test suites sharing one database produced three phantom "bugs" that were
  purely interference.

A suite verifies what its authors thought to check. 763 passing tests is
evidence, not proof.

---

## 6. Known limitations

Honest list. None of these are hidden behind a "coming soon".

**Not built**
- No `RESTAURANT_STAFF` role — a restaurant is operated by its owner account.
- No restaurant-side payouts or commission. `netSales` is customer-facing money;
  there is no platform-take line anywhere.
- Multiple partial refunds against one order (a single partial amount works).
- Frontend tests cover units and permission boundaries, not full page flows.

**Verified only locally**
- Razorpay is a real integration exercised against real signature logic and 26
  tests, but **no live payment has been taken**. The webhook is verified by a
  read-only probe, not by a real captured payment.
- No load testing. Performance work was structural (indexes, aggregations),
  not measured under load.

**Operational**
- On a brand-new database there is a short window where `2dsphere` indexes are
  still building and `$geoNear` throws. Dispatch catches it by design, so the
  symptom is orders quietly getting no rider offers. The test suite waits for
  indexes; **the server deliberately does not**, and whether it should is an open
  decision recorded in DEPLOYMENT.md.
- A killed test run leaves its database behind. They are greppable by the
  `foodrush_test_` prefix and are deliberately not auto-swept, because a sweep
  cannot distinguish "abandoned" from "another run in flight".
- `ConfirmDialog` is not `aria-modal` and does not trap focus, so a background
  button with the same label remains reachable. A full accessibility pass has
  not been done.

---

## 7. Operational runbook

| Situation | Where to look |
|---|---|
| Orders getting no rider | `$geoNear` index window (§6); check logs for `Dispatch failed for order` |
| Customer charged, order unpaid | Razorpay webhook not configured — see DEPLOYMENT.md "Payments" |
| Images vanish after deploy | `CLOUDINARY_*` unset; Render's disk is ephemeral |
| Online payment unavailable | `RAZORPAY_KEY_ID`/`SECRET` unset — COD-only is the intended fallback |
| Address search dead | `GOOGLE_MAPS_API_KEY` unset; typed addresses still work |
| Nobody can administer the platform | Last super admin cannot be demoted or deactivated by design; if it happened anyway, re-run `npm run bootstrap:admin` |
| Verifying a deploy | `npm run smoke -- --url https://…` — read-only, safe against production |
| Who changed what | `GET /api/admin/audit-logs` (requires `audit:read`, super admin only) |

**Migrations** — three scripts in `backend/scripts/`, all dry-run by default and
requiring `--apply` to write, all idempotent:
`migrate-order-statuses.js`, `migrate-restaurant-kyc.js`,
`migrate-review-moderation.js`. None is run automatically; none drops anything.
