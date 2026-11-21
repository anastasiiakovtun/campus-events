import assert from 'node:assert/strict';
import { once } from 'node:events';
import { afterEach, beforeEach, describe, it } from 'node:test';
import request from 'supertest';
import { createTestApp, validEvent } from '../helpers/testApp.mjs';
import { connectSse } from '../helpers/sseClient.mjs';

describe('Live SSE notifications', () => {
  let app;
  let server;
  let base;
  let clients;
  beforeEach(async () => {
    ({ app } = await createTestApp());
    clients = [];
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = `http://127.0.0.1:${server.address().port}`;
  });
  afterEach(async () => {
    await Promise.all(clients.map((client) => client.close()));
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  async function connect(headers) {
    const client = await connectSse(base, headers);
    clients.push(client);
    await client.next('ready');
    return client;
  }
  async function createEvent(overrides = {}) {
    const response = await request(app).post('/api/events').send(validEvent(overrides));
    assert.equal(response.status, 201);
    return response.body;
  }

  it('sends the same public creation message to two open connections', async () => {
    const first = await connect();
    const second = await connect();
    assert.equal(first.response.status, 200);
    assert.match(first.response.headers.get('content-type'), /text\/event-stream/);
    assert.match(first.response.headers.get('cache-control'), /no-transform/);
    const event = await createEvent();
    const [one, two] = await Promise.all([first.next(), second.next()]);
    assert.deepEqual(one, two);
    assert.equal(one.data.type, 'event.created');
    assert.equal(one.data.eventId, event.id);
    assert.equal(one.data.title, event.title);
    assert.equal(one.data.startsAt, event.startsAt);
    assert.equal(one.id, one.data.id);
    assert.match(one.id, /^[a-f0-9-]{36}$/);
  });

  it('notifies both connections after registration with seat counts and no identity', async () => {
    const event = await createEvent({ capacity: 2 });
    const first = await connect();
    const second = await connect();
    await request(app).post(`/api/events/${event.id}/registrations`)
      .send({ name: 'Private Attendee', email: 'private@example.com' }).expect(201);
    const [one, two] = await Promise.all([first.next(), second.next()]);
    assert.deepEqual(one, two);
    assert.equal(one.data.type, 'registration.created');
    assert.equal(one.data.registered, 1);
    assert.equal(one.data.spotsLeft, 1);
    assert.deepEqual(Object.keys(one.data).sort(), ['eventId', 'id', 'occurredAt', 'registered', 'spotsLeft', 'title', 'type']);
    assert.doesNotMatch(JSON.stringify(one), /Private Attendee|private@example.com|registrationId/);
    const saved = await request(app).get(`/api/events/${event.id}`);
    assert.equal(saved.body.registered, one.data.registered);
  });

  it('uses the same notification path for MCP registration', async () => {
    const event = await createEvent();
    const client = await connect();
    const response = await request(app).post('/api/mcp')
      .set('Accept', 'application/json, text/event-stream').set('MCP-Protocol-Version', '2025-11-25')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
        name: 'register_for_event', arguments: { eventId: event.id, name: 'MCP Attendee', email: 'mcp@example.com' }
      } });
    assert.equal(response.status, 200);
    const notification = await client.next();
    assert.equal(notification.data.type, 'registration.created');
    assert.equal(notification.data.eventId, event.id);
    assert.equal(notification.data.registered, 1);
  });

  it('does not publish rejected writes', async () => {
    const client = await connect();
    await request(app).post('/api/events').send(validEvent({ capacity: 0 })).expect(400);
    await request(app).post('/api/events/999/registrations').send({ name: 'Ada', email: 'ada@example.com' }).expect(404);
    const event = await createEvent({ capacity: 1 });
    assert.equal((await client.next()).data.type, 'event.created');
    const url = `/api/events/${event.id}/registrations`;
    await request(app).post(url).send({ name: 'Ada', email: 'ada@example.com' }).expect(201);
    assert.equal((await client.next()).data.type, 'registration.created');
    await request(app).post(url).send({ name: 'Ada', email: 'ada@example.com' }).expect(409);
    await request(app).post(url).send({ name: 'Grace', email: 'grace@example.com' }).expect(409);
    const next = await createEvent({ title: 'Next successful event' });
    assert.equal((await client.next()).data.eventId, next.id);
  });

  it('does not replay old toasts on reconnect even with Last-Event-ID', async () => {
    const old = await connect();
    await createEvent();
    const previous = await old.next();
    await old.close();
    await createEvent({ title: 'While disconnected' });
    const fresh = await connect({ 'Last-Event-ID': previous.id });
    const latest = await createEvent({ title: 'After reconnect' });
    const notification = await fresh.next();
    assert.equal(notification.data.eventId, latest.id);
    assert.notEqual(notification.id, previous.id);
  });
});
