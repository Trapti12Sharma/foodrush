# FoodRush

An original food-delivery platform (MERN stack) — customers browse restaurants, order food, and track deliveries; restaurant owners manage menus and orders; admins oversee the platform.

> Work in progress, built phase by phase. This README is updated as each phase lands.

## Tech stack

- **Frontend**: React 18, Vite, Tailwind CSS, React Router, Axios, React Hook Form, Lucide React
- **Backend**: Node.js, Express, MongoDB, Mongoose, JWT, bcryptjs, Multer
- **Security**: Helmet, CORS, express-rate-limit, express-mongo-sanitize, express-validator

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
      services/      # business logic reused across controllers
      utils/         # ApiError, ApiResponse, asyncHandler
      validators/    # express-validator chains
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
cd backend
npm test                  # runs the full Jest suite against a local MongoDB
```

Requires a MongoDB server reachable at `MONGODB_URI` (the same one `npm run dev`
uses) — tests run against a separate `foodrush_test` database on that server,
never the real one, and drop it automatically when the run finishes. No
external test infra (e.g. mongodb-memory-server) is used, since it would
require downloading a MongoDB binary that may not be reachable in every
environment; pointing at a real local MongoDB with an isolated database name
is the more portable choice here.

## API documentation

With the backend running, interactive Swagger UI is at
`http://localhost:5000/api/docs` (the raw OpenAPI 3.0 document is at
`/api/docs.json`). Every endpoint is documented — parameters, request body,
auth requirement, and response/error shapes — and "Try it out" executes
real requests against the running server.

## Status

Phase 1 (project setup) complete. See conversation history / commit log for phase-by-phase progress notes.
