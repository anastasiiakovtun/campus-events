import { Router } from 'express';
import { sequelize } from '../models/index.mjs';

// The menu for /api/health (mounted in app.mjs).
// A health check answers one question: "is the API alive and can it reach the database?"
// Hosting platforms call it to know if the app is running. It has no business rules,
// so it doesn't need a controller or service: one small handler is enough.
export const healthRoutes = Router();

// GET /api/health → 200 { status: 'ok' }
// authenticate() fails when the database can't be reached; the error handler then sends 500.
healthRoutes.get('/', async (req, res) => {
  await sequelize.authenticate();
  res.json({ status: 'ok' });
});