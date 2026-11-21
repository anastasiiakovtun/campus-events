import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import request from 'supertest';
import { createTestApp, validEvent } from '../helpers/testApp.mjs';

describe('Concurrent registrations', () => {
  let app;
  beforeEach(async () => { ({ app } = await createTestApp()); });

  async function createEvent(capacity) {
    const response = await request(app).post('/api/events').send(validEvent({ capacity }));
    assert.equal(response.status, 201);
    return response.body.id;
  }

  async function register(eventId, index, email, mcp = false) {
    const attendee = { name: `Attendee ${index}`, email };
    if (!mcp) {
      const response = await request(app).post(`/api/events/${eventId}/registrations`).send(attendee);
      return { saved: response.status === 201, code: response.body.error?.code };
    }
    const response = await request(app).post('/api/mcp')
      .set('Accept', 'application/json, text/event-stream')
      .set('MCP-Protocol-Version', '2025-11-25')
      .send({ jsonrpc: '2.0', id: index, method: 'tools/call', params: {
        name: 'register_for_event', arguments: { eventId, ...attendee }
      } });
    const data = response.headers['content-type'].includes('text/event-stream')
      ? JSON.parse(response.text.split('\n').find((line) => line.startsWith('data: ')).slice(6))
      : response.body;
    return { saved: Boolean(data.result?.structuredContent?.registration), code: data.result?.structuredContent?.error?.code };
  }

  async function assertResults(eventId, results, count) {
    assert.equal(results.filter((result) => result.saved).length, count);
    assert.ok(results.every((result) => result.saved || result.code === 'CONFLICT'), JSON.stringify(results));
    const list = await request(app).get(`/api/events/${eventId}/registrations`);
    assert.equal(list.body.length, count);
    const event = await request(app).get(`/api/events/${eventId}`);
    assert.equal(event.body.registered, count);
    assert.equal(event.body.spotsLeft, event.body.capacity - count);
  }

  it('allows exactly one of twelve mixed REST/MCP requests to take the last seat', async () => {
    const eventId = await createEvent(1);
    const results = await Promise.all(Array.from({ length: 12 }, (_, index) =>
      register(eventId, index, `attendee${index}@example.com`, index % 2 === 1)));
    await assertResults(eventId, results, 1);
  });

  it('fills three seats without overbooking under a burst of REST requests', async () => {
    const eventId = await createEvent(3);
    const results = await Promise.all(Array.from({ length: 12 }, (_, index) =>
      register(eventId, index, `attendee${index}@example.com`)));
    await assertResults(eventId, results, 3);
  });

  it('saves only one of ten simultaneous case-insensitive duplicate requests', async () => {
    const eventId = await createEvent(20);
    const results = await Promise.all(Array.from({ length: 10 }, (_, index) =>
      register(eventId, index, index % 2 ? 'SAME@EXAMPLE.COM' : 'same@example.com', index % 2 === 1)));
    await assertResults(eventId, results, 1);
  });

  it('allows the same email to register for two different events', async () => {
    const first = await createEvent(1);
    const second = await createEvent(1);
    const results = await Promise.all([
      register(first, 1, 'same@example.com'), register(second, 2, 'same@example.com', true)
    ]);
    assert.ok(results.every((result) => result.saved));
  });
});
