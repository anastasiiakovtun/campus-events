import { Router } from 'express';
import * as statsController from '../controllers/statsController.mjs';

// The menu for /api/stats (mounted in app.mjs).
export const statsRoutes = Router();

// GET /api/stats → occupancy and status of every event. Nothing to check.
statsRoutes.get('/', statsController.show);