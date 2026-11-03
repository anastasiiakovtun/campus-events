import { AppError } from '../utils/AppError.mjs';
import { logger } from '../utils/logger.mjs';

// No route matched the URL → 404 in the same error format as everything else.
export function notFoundRoute(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.originalUrl} not found` } });
}

// Every error ends here. Express recognises an error handler by its FOUR parameters.
export function errorHandler(err, req, res, _next) {
  // Our own errors (404, 409, 400 from services and validation): we know the status.
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  // The body is not valid JSON (express.json() could not read it).
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON' } });
  }
  // Anything else is a bug: log it for us, but don't show details to the user.
  logger.error(err.message, { stack: err.stack });
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } });
}