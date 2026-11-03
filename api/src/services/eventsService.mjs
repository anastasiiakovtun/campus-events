import * as eventsRepository from '../repositories/eventsRepository.mjs';
import * as registrationsRepository from '../repositories/registrationsRepository.mjs';
import { notFound } from '../utils/AppError.mjs';

// Service = the "cook": the rules for events.
// No Express (no req/res) and no database code here: it only makes decisions.
// It gets data from the repository and throws an AppError when something is wrong.

// Find an event, or stop with a 404 error.
// Used in many places, so it's written only once.
export async function findEventOrFail(id) {
  const event = await eventsRepository.findById(id);
  if (!event) throw notFound(`Event with id ${id} not found`);
  return event;
}

// All events, soonest first.
export function listEvents() {
  return eventsRepository.findAll();
}

// One event, plus how many people are registered and how many seats are left.
export async function getEvent(id) {
  const event = await findEventOrFail(id);
  const registered = await registrationsRepository.countByEvent(id);
  // Math.max(..., 0): seats left can never be negative.
  return { ...event, registered, spotsLeft: Math.max(event.capacity - registered, 0) };
}

// Create a new event. The data was already checked by the validation middleware.
export function createEvent(data) {
  return eventsRepository.create(data);
}

// Change an event. The repository returns null when the event doesn't exist → 404.
export async function updateEvent(id, data) {
  const event = await eventsRepository.updateById(id, data);
  if (!event) throw notFound(`Event with id ${id} not found`);
  return event;
}

// Delete an event (its registrations are deleted too, see the model: CASCADE).
export async function deleteEvent(id) {
  const deleted = await eventsRepository.deleteById(id);
  if (!deleted) throw notFound(`Event with id ${id} not found`);
}