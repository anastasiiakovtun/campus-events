import { Registration } from '../models/index.mjs';

// All database work for registrations. No rules here, only reading and saving.

const toPlain = (row) => (row ? row.toJSON() : null);

export async function findByEvent(eventId) {
  const registrations = await Registration.findAll({ where: { eventId }, order: [['createdAt', 'ASC']] });
  return registrations.map(toPlain);
}

export async function findByEventAndEmail(eventId, email) {
  return toPlain(await Registration.findOne({ where: { eventId, email } }));
}

export async function countByEvent(eventId) {
  return Registration.count({ where: { eventId } });
}

export async function create(data) {
  return toPlain(await Registration.create(data));
}