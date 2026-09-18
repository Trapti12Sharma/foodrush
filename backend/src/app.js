const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const mongoSanitize = require('express-mongo-sanitize');

const errorHandler = require('./middleware/errorHandler');
const notFound = require('./middleware/notFound');
const { apiLimiter } = require('./middleware/rateLimiter');
const routes = require('./routes');

const app = express();

app.use(helmet());
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

app.use('/api', routes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
