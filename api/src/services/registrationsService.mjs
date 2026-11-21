import * as registrationsRepository from '../repositories/registrationsRepository.mjs';
import { env } from '../config/env.mjs';
import { conflict } from '../utils/AppError.mjs';
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
  const event = await findEventOrFail(eventId);

  const existing = await registrationsRepository.findByEventAndEmail(eventId, email);
  if (existing) throw conflict(`${email} is already registered for this event`);

  // >= and not >: with 2 seats and 2 people registered, the event is full.
  // (The old code used >, so a 3rd person could still register.)
  const registered = await registrationsRepository.countByEvent(eventId);
  if (registered >= event.capacity) throw conflict('Event is full');

  const message = buildRegistrationConfirmation({ name }, event);
  const { registration } = await registrationsRepository.createWithConfirmation({ eventId, name, email }, message);
  // Seats left, the list of people and the stats are now out of date.
  cache.del(keys.event(eventId), keys.registrations(eventId), keys.stats);
  // Only ids in the log, no name or email: personal data doesn't belong in logs (privacy).
  logger.info('new registration', { eventId, registrationId: registration.id });

  return registration;
}
