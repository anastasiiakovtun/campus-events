import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { z } from 'zod';
import { listEventsByPeriod } from '../services/eventsService.mjs';
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
  return server;
}

const handler = toNodeHandler(createMcpHandler(createServer));

export function handleMcp(req, res) {
  return handler(req, res, req.body);
}
