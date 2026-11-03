import { env } from '../config/env.mjs';
import * as eventsRepository from '../repositories/eventsRepository.mjs';
import * as registrationsRepository from '../repositories/registrationsRepository.mjs';
import { notFound } from '../utils/AppError.mjs';
import * as cache from '../utils/cache.mjs';

// Service = the "cook": the rules for events.
// No Express (no req/res) and no database code here: it only makes decisions.
// GETs use the cache (cache-aside); every change deletes the cache keys that are now wrong.

// Cache keys, in one place so reads and deletes always use the same names.
export const keys = {
  allEvents: 'events:all',
  event: (id) => `events:${id}`,
  registrations: (id) => `events:${id}:registrations`,
  stats: 'stats'
};

// Find an event, or stop with a 404 error. Not cached: it's used before writes,
// which need the real data from the database.
export async function findEventOrFail(id) {
  const event = await eventsRepository.findById(id);
  if (!event) throw notFound(`Event with id ${id} not found`);
  return event;
}

// All events, soonest first.
export function listEvents() {
  return cache.remember(keys.allEvents, env.cacheTtlSeconds, () => eventsRepository.findAll());
}

// One event, plus how many people are registered and how many seats are left.
// A 404 throws inside load(), so "not found" is never stored in the cache.
export function getEvent(id) {
  return cache.remember(keys.event(id), env.cacheTtlSeconds, async () => {
    const event = await findEventOrFail(id);
    const registered = await registrationsRepository.countByEvent(id);
    // Math.max(..., 0): seats left can never be negative.
    return { ...event, registered, spotsLeft: Math.max(event.capacity - registered, 0) };
  });
}

// Create a new event. The list and the stats are now out of date.
export async function createEvent(data) {
  const event = await eventsRepository.create(data);
  cache.del(keys.allEvents, keys.stats);
  return event;
}

// Change an event. The repository returns null when the event doesn't exist → 404.
export async function updateEvent(id, data) {
  const event = await eventsRepository.updateById(id, data);
  if (!event) throw notFound(`Event with id ${id} not found`);
  cache.del(keys.allEvents, keys.event(id), keys.stats);
  return event;
}

// Delete an event (its registrations are deleted too, see the model: CASCADE).
export async function deleteEvent(id) {
  const deleted = await eventsRepository.deleteById(id);
  if (!deleted) throw notFound(`Event with id ${id} not found`);
  cache.del(keys.allEvents, keys.event(id), keys.registrations(id), keys.stats);
}
