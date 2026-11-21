import { EmailJob, Registration, sequelize } from '../models/index.mjs';

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

export async function createWithConfirmation(data, message) {
  // Both writes commit together: a successful registration must have a mail job.
  return sequelize.transaction(async (transaction) => {
    const registration = await Registration.create(data, { transaction });
    const emailJob = await EmailJob.create({
      registrationId: registration.id,
      recipient: registration.email,
      subject: message.subject,
      text: message.text
    }, { transaction });

    return { registration: toPlain(registration), emailJob: toPlain(emailJob) };
  });
}
