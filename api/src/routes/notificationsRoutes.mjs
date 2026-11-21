import { Router } from 'express';
import { streamNotifications } from '../controllers/notificationsController.mjs';

export const notificationsRoutes = Router();
notificationsRoutes.get('/', streamNotifications);
