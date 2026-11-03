import express from 'express';
import { errorHandler, notFoundRoute } from './middleware/errorHandler.mjs';
import { requestLogger } from './middleware/requestLogger.mjs';
import { eventsRoutes } from './routes/eventsRoutes.mjs';
import { healthRoutes } from './routes/healthRoutes.mjs';
import { statsRoutes } from './routes/statsRoutes.mjs';

// The app only wires the pieces together. Every job lives in its own folder:
// routes → controllers → services → repositories → models.
export const app = express();

// 1. Before the routes: read JSON bodies, log every request.
app.use(express.json());
app.use(requestLogger);

// 2. The menus: each router handles everything under its URL.
app.use('/api/health', healthRoutes);
app.use('/api/events', eventsRoutes);
app.use('/api/stats', statsRoutes);

// 3. After the routes: unknown URL → 404, and every error → errorHandler.
// The order matters: the error handler must be the last one.
app.use(notFoundRoute);
app.use(errorHandler);