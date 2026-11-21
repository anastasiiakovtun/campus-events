import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { z } from 'zod';
import { listEventsByPeriod } from '../services/eventsService.mjs';
import { register } from '../services/registrationsService.mjs';
import { registrationSchema } from '../middleware/validate.mjs';
import { AppError } from '../utils/AppError.mjs';
import { logger } from '../utils/logger.mjs';

function createServer() {
  const server = new McpServer({ name: 'campus-events', version: '1.0.0' });
  for (const period of ['upcoming', 'past']) {
    server.registerTool(`get_${period}_events`, {
      description: period === 'upcoming'
        ? 'List campus events starting now or later, soonest first, with remaining seats.'
        : 'List campus events that started before now, oldest first, with registration counts.',
      inputSchema: z.strictObject({}),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    }, async () => {
      try {
        const data = { events: await listEventsByPeriod(period) };
        return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
      } catch {
        // The SDK would otherwise expose thrown database messages to the client.
        logger.error('MCP event query failed', { period });
        const data = { error: { code: 'INTERNAL_ERROR', message: 'Unable to load events' } };
        return { isError: true, content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
      }
    });
  }
  server.registerTool('register_for_event', {
    description: 'Register exactly one attendee for a campus event and queue a confirmation email. ' +
      'Confirm the event ID, name and email with the user before calling; never guess identities. ' +
      'For a group request, establish every identity and obtain agreement before making separate calls; calls are not a group transaction.',
    inputSchema: registrationSchema.extend({ eventId: z.number().int().positive() }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, async ({ eventId, name, email }) => {
    try {
      const data = { registration: await register(eventId, { name, email }) };
      return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
    } catch (error) {
      const known = error instanceof AppError;
      if (!known) logger.error('MCP registration failed');
      const data = { error: known
        ? { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) }
        : { code: 'INTERNAL_ERROR', message: 'Unable to register attendee' } };
      return { isError: true, content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
    }
  });
  return server;
}

const handler = toNodeHandler(createMcpHandler(createServer));

export function handleMcp(req, res) {
  return handler(req, res, req.body);
}
