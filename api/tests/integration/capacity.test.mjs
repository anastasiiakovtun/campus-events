import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import request from 'supertest';
import { createTestApp, validEvent } from '../helpers/testApp.mjs';

// Bug fix: the old code checked "count > capacity", so a full event still accepted one more person.
describe('Event capacity', () => {
  let app;

  beforeEach(async () => {
    ({ app } = await createTestApp());
  });

  it('refuses a registration when every seat is taken', async () => {
    const event = await request(app).post('/api/events').send(validEvent({ capacity: 2 }));
    const url = `/api/events/${event.body.id}/registrations`;

    await request(app).post(url).send({ name: 'Ada', email: 'ada@example.com' });
    await request(app).post(url).send({ name: 'Grace', email: 'grace@example.com' });
    const third = await request(app).post(url).send({ name: 'Alan', email: 'alan@example.com' });

    assert.equal(third.status, 409);
    assert.equal(third.body.error.message, 'Event is full');

    const list = await request(app).get(url);
    assert.equal(list.body.length, 2);
  });
});