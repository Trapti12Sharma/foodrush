// Wraps an async route/controller so rejected promises reach the centralized error handler
// instead of requiring a try/catch in every controller.
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = asyncHandler;
