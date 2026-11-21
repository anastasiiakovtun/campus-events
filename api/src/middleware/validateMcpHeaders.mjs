import { validateHostHeader, validateOriginHeader } from '@modelcontextprotocol/server';
import { env } from '../config/env.mjs';
import { AppError } from '../utils/AppError.mjs';

export function validateMcpHeaders(req, res, next) {
  const host = validateHostHeader(req.get('host'), env.mcpAllowedHosts);
  const origin = validateOriginHeader(req.get('origin'), env.mcpAllowedHosts);
  if (!host.ok || !origin.ok) {
    return next(new AppError(403, 'FORBIDDEN', 'MCP host or origin is not allowed'));
  }
  next();
}
