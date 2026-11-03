import * as eventsRepository from '../repositories/eventsRepository.mjs';
import * as registrationsRepository from '../repositories/registrationsRepository.mjs';

// Service = the numbers for the Stats page: how full is each event?

// Decide the status of one event.
// "full" is checked first: a full event stays "full", even when it's in the past.
function statusOf(event, registered, now) {
  if (registered >= event.capacity) return 'full';
  if (new Date(event.startsAt) < now) return 'past';
  return 'open';
}

export async function getStats() {
  const events = await eventsRepository.findAll();
  const now = new Date();

  // Promise.all: count the registrations of all events at the same time, not one by one.
  // We only ask "how many?" (count), instead of loading every registration like the old code.
  return Promise.all(events.map(async (event) => {
    const registered = await registrationsRepository.countByEvent(event.id);
    return {
      id: event.id,
      title: event.title,
      registered,
      capacity: event.capacity,
      occupancy: `${Math.round((registered / event.capacity) * 100)}%`,
      status: statusOf(event, registered, now)
    };
  }));
}