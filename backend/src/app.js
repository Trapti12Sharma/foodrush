const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const mongoSanitize = require('express-mongo-sanitize');
const swaggerUi = require('swagger-ui-express');

const errorHandler = require('./middleware/errorHandler');
const notFound = require('./middleware/notFound');
const { apiLimiter } = require('./middleware/rateLimiter');
const routes = require('./routes');
const swaggerSpec = require('./config/swagger');

const app = express();

// Render (and most PaaS hosts) terminate TLS at a single reverse proxy in front
// of the app. Trusting exactly one hop makes req.ip / req.secure reflect the
// real client from X-Forwarded-*, which the rate limiter keys on — without this
// every user shares the proxy's IP and one rate-limit bucket.
app.set('trust proxy', 1);

// Helmet's default Cross-Origin-Resource-Policy is "same-origin", which blocks
// the SPA frontend (a different origin/port in dev, and typically a different
// domain in production) from loading anything this server serves — including
// uploaded images meant to be publicly displayed. They're not sensitive, so
// "cross-origin" is the correct policy here, not a weakening of anything else
// Helmet sets.
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(
  cors({
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    credentials: true,
  })
);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(mongoSanitize());

if (process.env.NODE_ENV !== 'test') {
  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
}

// General API rate limit; auth routes apply a stricter limit of their own (rateLimiter.js).
app.use('/api', apiLimiter);

app.use('/uploads', express.static('uploads'));

app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'FoodRush API is running', data: null });
});

// Interactive API docs at /api/docs; the raw OpenAPI document at /api/docs.json
// (handy for importing into Postman/Insomnia, or for CI contract checks).
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.get('/api/docs.json', (req, res) => res.json(swaggerSpec));

app.use('/api', routes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
