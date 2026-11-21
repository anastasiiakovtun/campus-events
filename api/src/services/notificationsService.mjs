import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { logger } from '../utils/logger.mjs';

const common = { id: z.uuid(), occurredAt: z.iso.datetime(), eventId: z.number().int().positive(), title: z.string().max(120) };
const notificationSchema = z.discriminatedUnion('type', [
  z.object({ ...common, type: z.literal('event.created'), startsAt: z.coerce.date().transform((date) => date.toISOString()) }),
  z.object({ ...common, type: z.literal('registration.created'), registered: z.number().int().nonnegative(), spotsLeft: z.number().int().nonnegative() })
]);
const listeners = new Set();
// Default: one API process delivers straight to its own browsers. With Redis
// configured, the transport fans the message out to every API instance first.
const localTransport = { publish: deliverLocally };
let transport = localTransport;

export function subscribeNotifications(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setNotificationTransport(next) {
  transport = next ?? localTransport;
}

export function publishNotification(data) {
  // Zod strips unknown fields so an attendee's identity cannot enter the stream.
  const parsed = notificationSchema.safeParse({ ...data, id: randomUUID(), occurredAt: new Date().toISOString() });
  if (!parsed.success) {
    logger.warn('Invalid notification omitted');
    return;
  }
  const notification = Object.freeze(parsed.data);
  transport.publish(notification);
  return notification;
}

// Messages from another instance are validated again: the channel is outside
// this process, so it must not be able to push identity fields or bad shapes.
export function receiveRemoteNotification(data) {
  const parsed = notificationSchema.safeParse(data);
  if (!parsed.success) {
    logger.warn('Invalid remote notification omitted');
    return;
  }
  deliverLocally(Object.freeze(parsed.data));
}

function deliverLocally(notification) {
  for (const listener of listeners) {
    try {
      listener(notification);
    } catch {
      listeners.delete(listener);
      logger.warn('Notification subscriber disconnected');
    }
  }
}
