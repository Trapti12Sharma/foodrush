const ApiError = require('../utils/ApiError');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal server error';
  let errors = err.errors || [];

  // Mongoose invalid ObjectId
  if (err.name === 'CastError') {
    statusCode = 400;
    message = `Invalid value for field "${err.path}"`;
  }

  // Mongoose validation errors
  if (err.name === 'ValidationError') {
    statusCode = 422;
    errors = Object.values(err.errors).map((e) => e.message);
    message = 'Validation failed';
  }

  // Mongoose duplicate key
  if (err.code === 11000) {
    statusCode = 409;
    const field = Object.keys(err.keyValue || {})[0];
    message = field ? `${field} already in use` : 'Duplicate value';
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Invalid authentication token';
  }
  if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Session expired. Please login again.';
  }

  if (process.env.NODE_ENV !== 'test' && statusCode >= 500) {
    console.error(err);
  }

  // M23 — an UNEXPECTED server error must not describe our internals to the
  // caller. The stack was never sent, but `message` was: a TypeError reads
  // "Cannot read properties of undefined (reading 'owner')", and a driver error
  // can quote the document it choked on. Both name internal fields.
  //
  // The discriminator is whether the error chose its own status. Anything that
  // set `statusCode` deliberately decided to be seen — every ApiError, and the
  // payment/geo gateways' 502/503, whose messages are written for the customer
  // ("The payment gateway is temporarily unavailable"). An error with no
  // statusCode fell through to the default 500, meaning nothing anticipated it,
  // so its message is for the log only. Mongoose's Cast/Validation/duplicate and
  // the JWT errors are unaffected: the branches above already rewrote them to
  // safe messages at 4xx, below this threshold.
  if (!err.statusCode && statusCode >= 500) {
    message = 'Internal server error';
    errors = [];
  }

  const body = { success: false, message, errors };
  // Lets a specific error (e.g. cart's cross-restaurant conflict) attach a small
  // structured payload the frontend can act on, beyond just the message string.
  if (err.data !== undefined) body.data = err.data;

  res.status(statusCode).json(body);
}

module.exports = errorHandler;
module.exports.ApiError = ApiError;
