import * as registrationsRepository from '../repositories/registrationsRepository.mjs';
import { env } from '../config/env.mjs';
import { conflict, notFound } from '../utils/AppError.mjs';
import * as cache from '../utils/cache.mjs';
import { logger } from '../utils/logger.mjs';
import { buildRegistrationConfirmation } from '../utils/mailer.mjs';
import { findEventOrFail, keys } from './eventsService.mjs';

// Service = the rules for registrations.

// Everyone registered for one event, in the order they signed up.
// First check that the event exists, otherwise 404.
export function listRegistrations(eventId) {
  return cache.remember(keys.registrations(eventId), env.cacheTtlSeconds, async () => {
    await findEventOrFail(eventId);
    return registrationsRepository.findByEvent(eventId);
  });
}

// Register someone for an event.
// Checked like a list, from top to bottom (early returns, no nested ifs):
// 1. event exists?  2. not registered yet?  3. seats left?  4. save.
export async function register(eventId, { name, email }) {
  const registration = await registrationsRepository.withEventLock(eventId, async (event, store) => {
    if (!event) throw notFound(`Event with id ${eventId} not found`);
    const existing = await store.findByEmail(email);
    if (existing) throw conflict(`${email} is already registered for this event`);
    const registered = await store.count();
    if (registered >= event.capacity) throw conflict('Event is full');
    const message = buildRegistrationConfirmation({ name }, event);
    return (await store.createWithConfirmation({ name, email }, message)).registration;
  });
  // Seats left, the list of people and the stats are now out of date.
  cache.del(keys.event(eventId), keys.registrations(eventId), keys.stats);
  // Only ids in the log, no name or email: personal data doesn't belong in logs (privacy).
  logger.info('new registration', { eventId, registrationId: registration.id });

  return registration;
}
