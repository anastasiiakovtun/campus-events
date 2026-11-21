import { Op, Transaction } from 'sequelize';
import { EmailJob, Event, Registration, sequelize } from '../models/index.mjs';

// All database work for registrations. No rules here, only reading and saving.

const toPlain = (row) => (row ? row.toJSON() : null);

let sqliteWrites = Promise.resolve();

function inRegistrationTransaction(work) {
  if (sequelize.getDialect() === 'postgres') {
    return sequelize.transaction({ isolationLevel: Transaction.ISOLATION_LEVELS.READ_COMMITTED }, work);
  }
  // SQLite has one writer. Queue local transactions (also needed for :memory:)
  // and acquire its write lock before reading, including across file-DB processes.
  const result = sqliteWrites.then(() => sequelize.transaction({ type: Transaction.TYPES.IMMEDIATE }, work));
  sqliteWrites = result.catch(() => {});
  return result;
}

export function withEventLock(eventId, work) {
  return inRegistrationTransaction(async (transaction) => {
    const event = await Event.findByPk(eventId, { transaction, lock: transaction.LOCK.UPDATE });
    // Only plain data and transaction-bound repository operations reach services.
    return work(toPlain(event), {
      findByEmail: (email) => findByEventAndEmail(eventId, email, transaction),
      count: () => countByEvent(eventId, transaction),
      createWithConfirmation: (attendee, message) => createWithConfirmation({ ...attendee, eventId }, message, transaction)
    });
  });
}

export async function findByEvent(eventId) {
  const registrations = await Registration.findAll({ where: { eventId }, order: [['createdAt', 'ASC']] });
  return registrations.map(toPlain);
}

export async function findByEventAndEmail(eventId, email, transaction) {
  return toPlain(await Registration.findOne({
    where: { eventId, [Op.and]: sequelize.where(sequelize.fn('lower', sequelize.col('email')), email.toLowerCase()) }, transaction
  }));
}

export async function countByEvent(eventId, transaction) {
  return Registration.count({ where: { eventId }, transaction });
}

export async function create(data) {
  return toPlain(await Registration.create(data));
}

export function createWithConfirmation(data, message, transaction) {
  if (!transaction) return inRegistrationTransaction((current) => createWithConfirmation(data, message, current));
  return insertWithConfirmation(data, message, transaction);
}

async function insertWithConfirmation(data, message, transaction) {
  const registration = await Registration.create(data, { transaction });
  const emailJob = await EmailJob.create({
    registrationId: registration.id,
    recipient: registration.email,
    subject: message.subject,
    text: message.text
  }, { transaction });
  return { registration: toPlain(registration), emailJob: toPlain(emailJob) };
}
