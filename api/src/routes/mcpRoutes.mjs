import { Router } from 'express';
import { handleMcp } from '../controllers/mcpController.mjs';
import { validateMcpHeaders } from '../middleware/validateMcpHeaders.mjs';

export const mcpRoutes = Router();
mcpRoutes.all('/', validateMcpHeaders, handleMcp);
