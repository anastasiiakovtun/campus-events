import { createClient as createRedisClient } from 'redis';
import { logger } from './logger.mjs';

const CHANNEL = 'campus-events:notifications';

// Fans notifications out to every API instance through Redis Pub/Sub. Each
// instance (including the sender) receives the message once from Redis and
// hands it to its own SSE clients, so a browser sees it exactly once.
// Pub/Sub is not durable: messages sent while an instance is disconnected are
// missed. That is acceptable because browsers re-read state from the database.
export function startRedisNotificationBus({ url, onMessage, createClient = createRedisClient }) {
  // A subscribed Redis connection cannot run other commands, so publish on a second one.
  const publisher = createClient({ url });
  const subscriber = publisher.duplicate();
  // Log only the error code: messages can include connection details.
  publisher.on('error', (error) => logger.warn(`Redis publisher error: ${error.code ?? error.name}`));
  subscriber.on('error', (error) => logger.warn(`Redis subscriber error: ${error.code ?? error.name}`));

  function receive(message) {
    let data;
    try {
      data = JSON.parse(message);
    } catch {
      logger.warn('Unreadable Redis notification omitted');
      return;
    }
    onMessage(data);
  }

  // Connecting runs in the background so a slow Redis cannot block API startup;
  // the client queues publishes until the connection is ready.
  const ready = Promise.all([
    publisher.connect(),
    subscriber.connect().then(() => subscriber.subscribe(CHANNEL, receive))
  ]);
  ready.catch((error) => logger.warn(`Redis notification bus failed to connect: ${error.code ?? error.name}`));

  return {
    ready,
    publish(notification) {
      publisher.publish(CHANNEL, JSON.stringify(notification)).catch((error) => {
        // Other instances miss this one, but browsers on this instance still get it.
        logger.warn(`Redis publish failed, delivering locally only: ${error.code ?? error.name}`);
        onMessage(notification);
      });
    },
    async close() {
      await Promise.all([subscriber.close(), publisher.close()]);
    }
  };
}
