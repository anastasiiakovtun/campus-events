import assert from 'node:assert/strict';
import { it } from 'node:test';
import { startRedisNotificationBus } from '../../src/utils/redisNotificationBus.mjs';
import {
  publishNotification, receiveRemoteNotification, setNotificationTransport, subscribeNotifications
} from '../../src/services/notificationsService.mjs';

const notification = {
  id: '2f1c8f0e-8a8e-4d2b-9a43-0f0b8c7d6e5a',
  occurredAt: '2026-11-21T10:00:00.000Z',
  type: 'registration.created',
  eventId: 1,
  title: 'Hack Night',
  registered: 3,
  spotsLeft: 2
};

// In-memory stand-in for a Redis server: every client created from it shares the same channels.
function createFakeRedis({ failPublish = false } = {}) {
  const channels = new Map();
  function createClient() {
    return {
      on() {},
      duplicate: () => createClient(),
      async connect() {},
      async close() {},
      async subscribe(channel, listener) {
        if (!channels.has(channel)) channels.set(channel, new Set());
        channels.get(channel).add(listener);
      },
      async publish(channel, message) {
        if (failPublish) throw new Error('Redis unavailable');
        // Real Redis delivers asynchronously; so does the fake.
        for (const listener of channels.get(channel) ?? []) queueMicrotask(() => listener(message));
      }
    };
  }
  return createClient;
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

it('delivers one published notification exactly once on every instance', async () => {
  const createClient = createFakeRedis();
  const receivedA = [];
  const receivedB = [];
  const busA = startRedisNotificationBus({ url: 'redis://fake', createClient, onMessage: (n) => receivedA.push(n) });
  const busB = startRedisNotificationBus({ url: 'redis://fake', createClient, onMessage: (n) => receivedB.push(n) });
  await Promise.all([busA.ready, busB.ready]);

  busA.publish(notification);
  await flush();

  assert.deepEqual(receivedA, [notification]);
  assert.deepEqual(receivedB, [notification]);
  await Promise.all([busA.close(), busB.close()]);
});

it('ignores messages on the channel that are not valid JSON', async () => {
  const createClient = createFakeRedis();
  const received = [];
  const bus = startRedisNotificationBus({ url: 'redis://fake', createClient, onMessage: (n) => received.push(n) });
  await bus.ready;
  const raw = createClient();
  await raw.publish('campus-events:notifications', 'not json');
  await flush();
  assert.deepEqual(received, []);
  await bus.close();
});

it('still notifies browsers on this instance when Redis rejects the publish', async () => {
  const received = [];
  const bus = startRedisNotificationBus({
    url: 'redis://fake', createClient: createFakeRedis({ failPublish: true }), onMessage: (n) => received.push(n)
  });
  await bus.ready;
  bus.publish(notification);
  await flush();
  assert.deepEqual(received, [notification]);
  await bus.close();
});

it('sends notifications through the configured transport instead of delivering them directly', () => {
  const sent = [];
  const local = [];
  const stop = subscribeNotifications((n) => local.push(n));
  setNotificationTransport({ publish: (n) => sent.push(n) });
  try {
    publishNotification({ type: 'event.created', eventId: 2, title: 'Design Workshop', startsAt: '2026-12-12T10:00:00Z' });
    assert.equal(sent.length, 1);
    assert.equal(local.length, 0);
  } finally { setNotificationTransport(null); stop(); }
});

it('validates remote notifications and strips identity before delivering them locally', () => {
  const local = [];
  const stop = subscribeNotifications((n) => local.push(n));
  try {
    receiveRemoteNotification({ ...notification, name: 'Private Name', email: 'private@example.com' });
    receiveRemoteNotification({ ...notification, type: 'unknown' });
    assert.equal(local.length, 1);
    assert.equal(local[0].id, notification.id);
    assert.doesNotMatch(JSON.stringify(local), /Private Name|private@example.com/);
  } finally { stop(); }
});
