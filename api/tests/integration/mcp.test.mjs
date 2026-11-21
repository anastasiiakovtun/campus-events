import assert from 'node:assert/strict';
import { once } from 'node:events';
import { beforeEach, describe, it } from 'node:test';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import request from 'supertest';
import { createTestApp, validEvent } from '../helpers/testApp.mjs';

describe('MCP event tools over HTTP', () => {
  let app;
  let id;

  beforeEach(async () => {
    ({ app } = await createTestApp());
    id = 0;
  });

  async function rpc(method, params = {}, headers = {}) {
    const response = await request(app).post('/api/mcp')
      .set('Accept', 'application/json, text/event-stream')
      .set('MCP-Protocol-Version', '2025-11-25')
      .set(headers)
      .send({ jsonrpc: '2.0', id: ++id, method, params });
    const data = response.headers['content-type']?.includes('text/event-stream')
      ? JSON.parse(response.text.split('\n').find((line) => line.startsWith('data: ')).slice(6))
      : response.body;
    return { response, data };
  }

  async function createEvent(overrides = {}) {
    const response = await request(app).post('/api/events').send(validEvent(overrides));
    assert.equal(response.status, 201);
    return response.body;
  }

  async function callTool(name, args = {}) {
    const { response, data } = await rpc('tools/call', { name, arguments: args });
    assert.equal(response.status, 200);
    return data.result;
  }

  it('initializes and discovers the two read-only tools and registration tool', async () => {
    const { response, data } = await rpc('initialize', {
      protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' }
    });
    assert.equal(response.status, 200);
    assert.equal(data.result.serverInfo.name, 'campus-events');
    const listed = await rpc('tools/list');
    assert.deepEqual(listed.data.result.tools.map((tool) => tool.name).sort(), ['get_past_events', 'get_upcoming_events', 'register_for_event']);
    for (const tool of listed.data.result.tools) {
      assert.equal(tool.annotations.readOnlyHint, tool.name !== 'register_for_event');
    }
  });

  it('lists the right period in date order with seats and no attendee details', async () => {
    const future = (days) => new Date(Date.now() + days * 86_400_000).toISOString();
    await createEvent({ title: 'Future Later', startsAt: future(20) });
    const soon = await createEvent({ title: 'Future Sooner', startsAt: future(2), capacity: 3 });
    await createEvent({ title: 'Past Recent', startsAt: future(-1) });
    await createEvent({ title: 'Past Older', startsAt: future(-20) });
    await request(app).post(`/api/events/${soon.id}/registrations`)
      .send({ name: 'Private Attendee', email: 'private@example.com' }).expect(201);

    const upcoming = await callTool('get_upcoming_events');
    assert.deepEqual(upcoming.structuredContent.events.map((event) => event.title), ['Future Sooner', 'Future Later']);
    assert.equal(upcoming.structuredContent.events[0].registered, 1);
    assert.equal(upcoming.structuredContent.events[0].spotsLeft, 2);
    assert.deepEqual(JSON.parse(upcoming.content[0].text), upcoming.structuredContent);
    const past = await callTool('get_past_events');
    assert.deepEqual(past.structuredContent.events.map((event) => event.title), ['Past Older', 'Past Recent']);
    assert.doesNotMatch(JSON.stringify([upcoming, past]), /Private Attendee|private@example.com/);
  });

  it('moves a cached event from upcoming to past when time advances', async (t) => {
    const now = new Date('2030-01-01T12:00:00Z');
    t.mock.timers.enable({ apis: ['Date'], now });
    await createEvent({ title: 'Starting Now', startsAt: now.toISOString() });
    assert.equal((await callTool('get_upcoming_events')).structuredContent.events.length, 1);
    assert.equal((await callTool('get_past_events')).structuredContent.events.length, 0);
    t.mock.timers.tick(1);
    assert.equal((await callTool('get_upcoming_events')).structuredContent.events.length, 0);
    assert.equal((await callTool('get_past_events')).structuredContent.events.length, 1);
  });

  it('returns empty lists when no events exist', async () => {
    for (const name of ['get_upcoming_events', 'get_past_events']) {
      assert.deepEqual((await callTool(name)).structuredContent, { events: [] });
    }
  });

  it('reflects REST registrations and updates after the cache is populated', async () => {
    const event = await createEvent({ capacity: 2 });
    assert.equal((await callTool('get_upcoming_events')).structuredContent.events[0].spotsLeft, 2);
    await request(app).post(`/api/events/${event.id}/registrations`)
      .send({ name: 'Test Attendee', email: 'test@example.com' }).expect(201);
    assert.equal((await callTool('get_upcoming_events')).structuredContent.events[0].spotsLeft, 1);
    await request(app).patch(`/api/events/${event.id}`).send({ startsAt: '2020-01-01T00:00:00Z' }).expect(200);
    assert.deepEqual((await callTool('get_upcoming_events')).structuredContent.events, []);
    assert.equal((await callTool('get_past_events')).structuredContent.events[0].id, event.id);
  });

  it('rejects unknown tools and unexpected arguments', async () => {
    const unknown = await rpc('tools/call', { name: 'unknown_tool', arguments: {} });
    assert.equal(unknown.data.error.code, -32602);
    const invalid = await callTool('get_upcoming_events', { period: 'past' });
    assert.equal(invalid.isError, true);
  });

  it('rejects untrusted hosts and browser origins', async () => {
    for (const headers of [{ Host: 'untrusted.invalid' }, { Origin: 'https://untrusted.invalid' }, { Origin: 'null' }]) {
      const { response, data } = await rpc('tools/list', {}, headers);
      assert.equal(response.status, 403);
      assert.equal(data.error.code, 'FORBIDDEN');
    }
    assert.equal((await rpc('tools/list', {}, { Origin: 'http://localhost:5173' })).response.status, 200);
  });

  it('does not serve the Vue page for unsupported MCP HTTP methods', async () => {
    const response = await request(app).delete('/api/mcp');
    assert.equal(response.status, 405);
    assert.doesNotMatch(response.headers['content-type'], /html/);
  });

  it('works with the official MCP client over a real HTTP connection', async () => {
    const event = await createEvent();
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const client = new Client({ name: 'campus-events-test', version: '1.0.0' });
    try {
      const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.address().port}/api/mcp`));
      await client.connect(transport);
      assert.equal((await client.listTools()).tools.length, 3);
      const result = await client.callTool({ name: 'get_upcoming_events', arguments: {} });
      assert.equal(result.structuredContent.events[0].id, event.id);
      assert.deepEqual((await client.callTool({ name: 'get_past_events', arguments: {} })).structuredContent.events, []);
    } finally {
      await client.close();
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
