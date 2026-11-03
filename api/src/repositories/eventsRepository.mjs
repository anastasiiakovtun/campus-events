import { Event } from '../models/index.mjs';

// Repository = the "storage room": all database work for events.
// No rules here, only reading and saving.

// Turn a database row into a plain object (or null when nothing was found).
// Then the service doesn't need to know Sequelize, and the cache can store it easily.
const toPlain = (row) => (row ? row.toJSON() : null);

// All events, soonest first.
export async function findAll() {
  const events = await Event.findAll({ order: [['startsAt', 'ASC']] });
  return events.map(toPlain);
}

// One event by its id, or null.
export async function findById(id) {
  return toPlain(await Event.findByPk(id));
}

// Save a new event.
export async function create(data) {
  return toPlain(await Event.create(data));
}

// Change an event. Returns null when it doesn't exist.
export async function updateById(id, data) {
  const event = await Event.findByPk(id);
  if (!event) return null;
  return toPlain(await event.update(data));
}

// Delete an event. Returns true when something was deleted.
export async function deleteById(id) {
  const deleted = await Event.destroy({ where: { id } });
  return deleted > 0;
}