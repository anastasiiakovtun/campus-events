import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { errorHandler, notFoundRoute } from './middleware/errorHandler.mjs';
import { requestLogger } from './middleware/requestLogger.mjs';
import { eventsRoutes } from './routes/eventsRoutes.mjs';
import { healthRoutes } from './routes/healthRoutes.mjs';
import { statsRoutes } from './routes/statsRoutes.mjs';
import { mcpRoutes } from './routes/mcpRoutes.mjs';
import { notificationsRoutes } from './routes/notificationsRoutes.mjs';

// The app only wires the pieces together. Every job lives in its own folder:
// routes → controllers → services → repositories → models.
export const app = express();

const webDistPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../web/dist');
const webIndexPath = resolve(webDistPath, 'index.html');

// 1. Before the routes: read JSON bodies, log every request.
app.use(express.json());
app.use(requestLogger);

// 2. The menus: each router handles everything under its URL.
app.use('/api/health', healthRoutes);
app.use('/api/events', eventsRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/mcp', mcpRoutes);
app.use('/api/notifications', notificationsRoutes);

// In production Render builds the Vue app before starting this API. Serving it
// here keeps the website and API on one origin, while the JSON fallback keeps
// the API root useful when the frontend has not been built yet.
app.use(express.static(webDistPath));
app.get('/', (req, res) => {
  if (existsSync(webIndexPath)) {
    return res.sendFile(webIndexPath);
  }

  res.json({ name: 'Campus Events API', api: '/api', health: '/api/health' });
});

// Vue Router owns browser routes such as /events/new after the initial load.
app.use((req, res, next) => {
  const isApiRequest = req.path === '/api' || req.path.startsWith('/api/');
  if (req.method === 'GET' && !isApiRequest && req.accepts('html') && existsSync(webIndexPath)) {
    return res.sendFile(webIndexPath);
  }

  next();
});

// 3. After the routes: unknown URL → 404, and every error → errorHandler.
// The order matters: the error handler must be the last one.
app.use(notFoundRoute);
app.use(errorHandler);
