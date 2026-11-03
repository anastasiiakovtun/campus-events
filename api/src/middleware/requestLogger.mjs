import { logger } from '../utils/logger.mjs';

// Logs every request when it finishes: method, URL, status and how long it took.
export function requestLogger(req, res, next) {
  const start = performance.now();
  res.on('finish', () => {
    logger.info('request', {
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      durationMs: Math.round(performance.now() - start)
    });
  });
  next();
}