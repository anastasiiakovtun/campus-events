import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import request from 'supertest';
import { createTestApp, validEvent } from '../helpers/testApp.mjs';

// The cache must never show old data after a change.
// Every test first reads (so the answer is cached), then changes something, then reads again.
describe('Cache stays correct after changes', () => {
  let app;

  beforeEach(async () => {
    ({ app } = await createTestApp());
  });

  it('shows the new seat count after a registration', async () => {
    const event = await request(app).post('/api/events').send(validEvent({ capacity: 5 }));
    const url = `/api/events/${event.body.id}`;

    assert.equal((await request(app).get(url)).body.spotsLeft, 5);
    await request(app).post(`${url}/registrations`).send({ name: 'Ada', email: 'ada@example.com' });

    assert.equal((await request(app).get(url)).body.spotsLeft, 4);
    assert.equal((await request(app).get(`${url}/registrations`)).body.length, 1);
  });

  it('shows the new title after an update, in the detail and in the list', async () => {
    const event = await request(app).post('/api/events').send(validEvent({ title: 'Old title' }));
    const url = `/api/events/${event.body.id}`;

    await request(app).get(url);
    await request(app).get('/api/events');
    await request(app).patch(url).send({ title: 'New title' });

    assert.equal((await request(app).get(url)).body.title, 'New title');
    assert.equal((await request(app).get('/api/events')).body[0].title, 'New title');
  });

  it('shows a new event in the list right away', async () => {
    assert.equal((await request(app).get('/api/events')).body.length, 0);
    await request(app).post('/api/events').send(validEvent());

    assert.equal((await request(app).get('/api/events')).body.length, 1);
  });

  it('returns 404 after a delete, even if the event was cached', async () => {
    const event = await request(app).post('/api/events').send(validEvent());
    const url = `/api/events/${event.body.id}`;

    assert.equal((await request(app).get(url)).status, 200);
    await request(app).delete(url);

    assert.equal((await request(app).get(url)).status, 404);
  });
});
