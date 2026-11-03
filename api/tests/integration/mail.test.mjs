import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import request from 'supertest';

// Simulate a mail server that is offline: nothing listens on port 1.
// Set before the app is loaded, because the config reads it at startup.
process.env.SMTP_URL = 'smtp://127.0.0.1:1';
const { createTestApp, validEvent } = await import('../helpers/testApp.mjs');

describe('Registration mail', () => {
  let app;

  beforeEach(async () => {
    ({ app } = await createTestApp());
  });

  it('still stores the registration when the mail server is offline', async () => {
    const event = await request(app).post('/api/events').send(validEvent());
    const url = `/api/events/${event.body.id}/registrations`;

    const res = await request(app).post(url).send({ name: 'Ada', email: 'ada@example.com' });
    assert.equal(res.status, 201);

    const list = await request(app).get(url);
    assert.equal(list.body.length, 1);
  });
});
