# FoodRush

An original food-delivery platform (MERN stack) — customers browse restaurants, order food, and track deliveries; restaurant owners manage menus and orders; admins oversee the platform.

Six audiences share one platform: customers, restaurant owners, delivery
partners, and three tiers of staff (support/operations, admins, super admins).

- **[ARCHITECTURE.md](./ARCHITECTURE.md)** — how it is built, every lifecycle
  (order, delivery, payment, refund, coupon, review, KYC), the permission model,
  known limitations and an operational runbook.
- **[DEPLOYMENT.md](./DEPLOYMENT.md)** — deploying it, and the manual dashboard
  configuration each integration needs.
- **Swagger** at `/api/docs` — every endpoint, generated from the routes.

## Tech stack

- **Frontend**: React 18, Vite, Tailwind CSS, React Router, Axios, React Hook Form,
  Lucide React, Socket.IO client
- **Backend**: Node.js, Express, MongoDB, Mongoose, JWT, bcryptjs, Multer, Socket.IO
- **Integrations**: Cloudinary (images), Razorpay (payments/refunds), Google Maps
  (geocoding), Nodemailer/Resend (email) — every one of them optional; the platform
  runs with none configured
- **Security**: Helmet, CORS, express-rate-limit, express-mongo-sanitize, express-validator
- **Docs**: swagger-jsdoc + swagger-ui-express, generated from the route definitions
- **Tests**: Jest + supertest (backend), Vitest + React Testing Library (frontend)

## Folder structure

```
foodrush/
  backend/
    src/
      config/       # DB connection, env-driven config
      controllers/   # request handlers
      middleware/    # auth, error handling, rate limiting
      models/        # Mongoose schemas
      routes/        # Express routers
      realtime/      # Socket.IO server, auth, room management
      services/      # business logic — the authoritative layer
      utils/         # ApiError, ApiResponse, permissions table, constants, date ranges
      validators/    # express-validator chains
    scripts/         # migrations, super-admin bootstrap, post-deploy smoke test
    tests/           # Jest suites
    uploads/         # local dev file storage (Cloudinary-ready)
    seeds/           # demo data seeding script
  frontend/
    src/
      pages/         # route-level views
      components/    # reusable UI
      layouts/       # shared page shells (navbar/footer, dashboards)
      context/       # auth/cart/global state
      services/      # Axios API clients
      hooks/ utils/ routes/ constants/
```

## Getting started

### Backend

```bash
cd backend
cp .env.example .env      # edit MONGODB_URI / JWT_SECRET
npm install
npm run dev               # http://localhost:5000
```

### Frontend

```bash
cd frontend
cp .env.example .env
npm install
npm run dev               # http://localhost:5173
```

### Demo data (optional)

```bash
cd backend
npm run seed               # creates demo accounts + a sample restaurant/menu/order/review/coupon
```

Prints the demo login credentials (`admin@example.com`, `restaurant@example.com`,
`customer@example.com`) when it finishes. Safe to re-run.

## Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for a free-tier path (MongoDB Atlas +
Render + Vercel), including the cross-origin auth-cookie configuration a
split-domain deployment needs and what to expect from image uploads on a
free-tier host's ephemeral disk.

## Testing

```bash
cd backend  && npm test    # 40 files, 763 tests (Jest + supertest)
cd frontend && npm test    # 6 files, 36 tests (Vitest + React Testing Library)
```

Backend tests need a MongoDB server reachable at `MONGODB_URI` — the same one
`npm run dev` uses. Each run gets its **own** database (`foodrush_test_<pid>_<random>`),
printed at the start and dropped when the run finishes, so two runs cannot
interfere with each other. The real database is never touched. No in-memory
MongoDB is used: it would require downloading a binary that is not reachable in
every environment.

Almost nothing is mocked. An order in a test is placed by a real customer over
real HTTP, driven through the real status machine by the real restaurant, and
delivered by a real rider with a real OTP. `tests/e2eJourney.test.js` walks the
entire lifecycle in one test, because each milestone having its own passing
tests does not prove they connect.

`--forceExit` is deliberately not used — it hid a connection leak for months by
killing the process before the leak could show.

## API documentation

With the backend running, interactive Swagger UI is at
`http://localhost:5000/api/docs` (the raw OpenAPI 3.0 document is at
`/api/docs.json`). Every endpoint is documented — parameters, request body,
auth requirement, and response/error shapes — and "Try it out" executes
real requests against the running server.

## Status

Feature-complete for the scope described in ARCHITECTURE.md, and honest about
what it is not: no live payment has been taken, there is no restaurant payout or
commission model, and there is no `RESTAURANT_STAFF` role. The full list is in
[ARCHITECTURE.md § Known limitations](./ARCHITECTURE.md#6-known-limitations) —
worth reading before treating anything here as production-verified.
