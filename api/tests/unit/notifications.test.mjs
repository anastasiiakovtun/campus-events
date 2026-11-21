import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { after, it } from 'node:test';
import request from 'supertest';
import { streamNotifications } from '../../src/controllers/notificationsController.mjs';
import { publishNotification, subscribeNotifications } from '../../src/services/notificationsService.mjs';
import { EmailJob, sequelize } from '../../src/models/index.mjs';
import { createTestApp, validEvent } from '../helpers/testApp.mjs';

const data = { type: 'registration.created', eventId: 1, title: 'Public event', registered: 1, spotsLeft: 2 };
after(() => sequelize.close());

it('strips identity fields and isolates failed subscribers', () => {
  const received = [];
  const stopBad = subscribeNotifications(() => { throw new Error('Client disconnected'); });
  const stop = subscribeNotifications((notification) => received.push(notification));
  try {
    publishNotification({ ...data, name: 'Private Name', email: 'private@example.com', registrationId: 4 });
    assert.equal(received.length, 1);
    assert.doesNotMatch(JSON.stringify(received), /Private Name|private@example.com|registrationId/);
    stop();
    publishNotification(data);
    assert.equal(received.length, 1);
  } finally { stopBad(); stop(); }
});

it('does not broadcast invalid notification payloads', () => {
  let calls = 0;
  const stop = subscribeNotifications(() => { calls += 1; });
  try {
    assert.equal(publishNotification({ ...data, type: 'unknown' }), undefined);
    assert.equal(publishNotification({ ...data, spotsLeft: -1 }), undefined);
    assert.equal(calls, 0);
  } finally { stop(); }
});

for (const backpressure of [false, true]) {
  it(`cleans up the stream on ${backpressure ? 'backpressure' : 'disconnect'}`, (t) => {
    let heartbeat;
    let cleared = 0;
    t.mock.method(globalThis, 'setInterval', (callback) => { heartbeat = callback; return { unref() {} }; });
    t.mock.method(globalThis, 'clearInterval', () => { cleared += 1; });
    const res = new EventEmitter();
    const frames = [];
    res.status = () => res;
    res.set = () => res;
    res.flushHeaders = () => {};
    res.write = (frame) => { frames.push(frame); return !backpressure; };
    res.end = () => {};
    res.destroy = () => {};
    streamNotifications({}, res);
    if (!backpressure) {
      heartbeat();
      assert.equal(frames.at(-1), ': heartbeat\n\n');
      res.emit('close');
    }
    const count = frames.length;
    publishNotification(data);
    heartbeat();
    assert.equal(frames.length, count);
    assert.equal(cleared, 1);
  });
}

it('does not publish a registration when saving its email job rolls back', async (t) => {
  const { app } = await createTestApp();
  const event = await request(app).post('/api/events').send(validEvent());
  let notifications = 0;
  const stop = subscribeNotifications(() => { notifications += 1; });
  t.mock.method(EmailJob, 'create', async () => { throw new Error('Injected storage failure'); });
  try {
    await request(app).post(`/api/events/${event.body.id}/registrations`)
      .send({ name: 'Private Name', email: 'private@example.com' }).expect(500);
    assert.equal(notifications, 0);
  } finally { stop(); }
});
