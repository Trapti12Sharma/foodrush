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

## Status

Phase 1 (project setup) complete. See conversation history / commit log for phase-by-phase progress notes.
