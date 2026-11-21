import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import request from 'supertest';
import { EmailJob, Registration, sequelize } from '../../src/models/index.mjs';
import { createTestApp, validEvent } from '../helpers/testApp.mjs';

describe('MCP registration outbox', () => {
  let app;
  let eventId;
  const attendee = { name: 'MCP Attendee', email: 'mcp@example.com' };

  beforeEach(async () => {
    ({ app } = await createTestApp());
    const event = await request(app).post('/api/events').send(validEvent());
    eventId = event.body.id;
  });
  after(() => sequelize.close());

  async function register(args = {}) {
    const response = await request(app).post('/api/mcp')
      .set('Accept', 'application/json, text/event-stream')
      .set('MCP-Protocol-Version', '2025-11-25')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
        name: 'register_for_event', arguments: { eventId, ...attendee, ...args }
      } });
    assert.equal(response.status, 200);
    return response.headers['content-type'].includes('text/event-stream')
      ? JSON.parse(response.text.split('\n').find((line) => line.startsWith('data: ')).slice(6)).result
      : response.body.result;
  }

  it('saves one normalized registration and one pending mail job before SMTP', async () => {
    const result = await register({ email: 'MCP@EXAMPLE.COM' });
    assert.ok(!result.isError);
    assert.equal(await Registration.count(), 1);
    assert.equal(await EmailJob.count(), 1);
    const job = await EmailJob.findOne();
    assert.equal(job.registrationId, result.structuredContent.registration.id);
    assert.equal(job.recipient, attendee.email);
    assert.equal(job.status, 'pending');
    assert.equal(job.attempts, 0);
    assert.match(job.subject, /Backend Bootcamp/);
    assert.match(job.text, /MCP Attendee/);
    assert.equal((await register()).isError, true);
    assert.equal(await EmailJob.count(), 1);
  });

  it('does not create mail jobs for invalid, missing-event or full-event calls', async () => {
    assert.equal((await register({ email: 'invalid' })).isError, true);
    assert.equal((await register({ eventId: 999999 })).isError, true);
    await register();
    await request(app).patch(`/api/events/${eventId}`).send({ capacity: 1 }).expect(200);
    assert.equal((await register({ name: 'Other Person', email: 'other@example.com' })).isError, true);
    assert.equal(await Registration.count(), 1);
    assert.equal(await EmailJob.count(), 1);
  });

  it('rolls back the registration and hides internal details when enqueueing fails', async (t) => {
    t.mock.method(EmailJob, 'create', async () => { throw new Error('private-database-connection-string'); });
    const result = await register();
    assert.equal(result.isError, true);
    assert.deepEqual(result.structuredContent.error, {
      code: 'INTERNAL_ERROR', message: 'Unable to register attendee'
    });
    assert.doesNotMatch(JSON.stringify(result), /private-database-connection-string/);
    assert.equal(await Registration.count(), 0);
    assert.equal(await EmailJob.count(), 0);
  });
});
