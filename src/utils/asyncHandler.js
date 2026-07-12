// Wraps an async route/middleware handler so rejected promises reach
// errorHandler.middleware.js instead of crashing the process.
module.exports = function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
