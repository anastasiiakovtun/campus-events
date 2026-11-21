import assert from 'node:assert/strict';
import { once } from 'node:events';
import { beforeEach, describe, it } from 'node:test';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import request from 'supertest';
import { createTestApp, validEvent } from '../helpers/testApp.mjs';

describe('MCP registration', () => {
  let app;
  let event;
  const attendee = { name: 'Ada Lovelace', email: 'ada@example.com' };

  beforeEach(async () => {
    ({ app } = await createTestApp());
    const response = await request(app).post('/api/events').send(validEvent({ capacity: 2 }));
    assert.equal(response.status, 201);
    event = response.body;
  });

  async function register(args = {}) {
    const response = await request(app).post('/api/mcp')
      .set('Accept', 'application/json, text/event-stream')
      .set('MCP-Protocol-Version', '2025-11-25')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
        name: 'register_for_event', arguments: { eventId: event.id, ...attendee, ...args }
      } });
    assert.equal(response.status, 200);
    const data = response.headers['content-type'].includes('text/event-stream')
      ? JSON.parse(response.text.split('\n').find((line) => line.startsWith('data: ')).slice(6))
      : response.body;
    return data.result;
  }

  async function registrations() {
    const response = await request(app).get(`/api/events/${event.id}/registrations`);
    assert.equal(response.status, 200);
    return response.body;
  }

  it('saves the requested person and normalizes input exactly like the website', async () => {
    const result = await register({ name: '  Ada Lovelace  ', email: 'ADA@EXAMPLE.COM' });
    assert.ok(!result.isError);
    const registration = result.structuredContent.registration;
    assert.equal(registration.eventId, event.id);
    assert.equal(registration.name, attendee.name);
    assert.equal(registration.email, attendee.email);
    assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
    assert.equal((await registrations())[0].id, registration.id);
    const updated = await request(app).get(`/api/events/${event.id}`);
    assert.equal(updated.body.spotsLeft, 1);
  });

  it('does not register a person for a different event', async () => {
    const other = await request(app).post('/api/events').send(validEvent({ title: 'Other Event' }));
    const result = await register({ eventId: other.body.id });
    assert.equal(result.structuredContent.registration.eventId, other.body.id);
    assert.deepEqual(await registrations(), []);
    const saved = await request(app).get(`/api/events/${other.body.id}/registrations`);
    assert.equal(saved.body.length, 1);
  });

  it('rejects duplicate emails across REST and MCP without a second registration', async () => {
    await request(app).post(`/api/events/${event.id}/registrations`).send(attendee).expect(201);
    const result = await register({ email: 'ADA@EXAMPLE.COM' });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.error.code, 'CONFLICT');
    assert.equal((await registrations()).length, 1);
  });

  it('rejects a repeated MCP call and the same registration through REST', async () => {
    await register();
    const result = await register();
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.error.code, 'CONFLICT');
    await request(app).post(`/api/events/${event.id}/registrations`).send(attendee).expect(409);
    assert.equal((await registrations()).length, 1);
  });

  it('rejects full events with the existing service error', async () => {
    await request(app).patch(`/api/events/${event.id}`).send({ capacity: 1 }).expect(200);
    await request(app).post(`/api/events/${event.id}/registrations`).send(attendee).expect(201);
    const result = await register({ name: 'Grace Hopper', email: 'grace@example.com' });
    assert.equal(result.isError, true);
    assert.deepEqual(result.structuredContent.error, { code: 'CONFLICT', message: 'Event is full' });
    assert.equal((await registrations()).length, 1);
  });

  it('rejects unknown events without creating registrations', async () => {
    const result = await register({ eventId: 999999 });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.error.code, 'NOT_FOUND');
    assert.deepEqual(await registrations(), []);
  });

  const invalidInputs = [
    { email: 'invalid' }, { name: ' ' }, { name: 'x'.repeat(101) }, { eventId: 0 },
    { eventId: -1 }, { eventId: 1.5 }, { eventId: '1' }, { email: undefined },
    { name: undefined }, { eventId: undefined }, { people: [attendee] }
  ];
  for (const input of invalidInputs) {
    it(`rejects invalid arguments ${JSON.stringify(input)} without writing`, async () => {
      const result = await register(input);
      assert.equal(result.isError, true);
      assert.deepEqual(await registrations(), []);
    });
  }

  it('registers through the official MCP client and exposes the result through REST', async () => {
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const client = new Client({ name: 'campus-registration-test', version: '1.0.0' });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.address().port}/api/mcp`)));
      const result = await client.callTool({ name: 'register_for_event', arguments: { eventId: event.id, ...attendee } });
      assert.ok(!result.isError);
      assert.equal((await registrations())[0].id, result.structuredContent.registration.id);
      const upcoming = await client.callTool({ name: 'get_upcoming_events', arguments: {} });
      assert.equal(upcoming.structuredContent.events[0].spotsLeft, 1);
    } finally {
      await client.close();
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
