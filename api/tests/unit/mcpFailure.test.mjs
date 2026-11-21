import assert from 'node:assert/strict';
import { after, it } from 'node:test';
import request from 'supertest';
import { Event, sequelize } from '../../src/models/index.mjs';
import { createTestApp } from '../helpers/testApp.mjs';

after(() => sequelize.close());

it('returns a safe MCP tool error when the database fails', async (t) => {
  const { app } = await createTestApp();
  t.mock.method(Event, 'findAll', async () => { throw new Error('private-database-connection-string'); });
  const response = await request(app).post('/api/mcp')
    .set('Accept', 'application/json, text/event-stream')
    .set('MCP-Protocol-Version', '2025-11-25')
    .send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_upcoming_events', arguments: {} } });
  assert.equal(response.status, 200);
  const data = response.headers['content-type'].includes('text/event-stream')
    ? JSON.parse(response.text.split('\n').find((line) => line.startsWith('data: ')).slice(6))
    : response.body;
  assert.equal(data.result.isError, true);
  assert.deepEqual(data.result.structuredContent, {
    error: { code: 'INTERNAL_ERROR', message: 'Unable to load events' }
  });
  assert.doesNotMatch(response.text, /private-database-connection-string/);
});
