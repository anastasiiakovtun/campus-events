import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import * as models from '../../src/models/index.mjs';
import * as registrationsRepository from '../../src/repositories/registrationsRepository.mjs';

const participant = { name: 'Test Attendee', email: 'attendee@example.com' };
const message = { subject: 'Registration confirmed', text: 'Your place is reserved.' };

describe('Confirmation email outbox storage', () => {
  let eventId;

  beforeEach(async () => {
    await models.sequelize.sync({ force: true });
    const event = await models.Event.create({
      title: 'Outbox test event', location: 'Test room',
      startsAt: new Date('2027-01-15T14:00:00Z'), capacity: 10
    });
    eventId = event.id;
  });

  after(() => models.sequelize.close());

  it('saves a registration and its complete pending email together', async () => {
    const result = await registrationsRepository.createWithConfirmation({
      eventId, ...participant
    }, message);
    const registration = await models.Registration.findByPk(result.registration.id);
    const job = await models.EmailJob.findByPk(result.emailJob.id);

    assert.equal(registration.email, participant.email);
    assert.equal(job.registrationId, registration.id);
    assert.equal(job.recipient, participant.email);
    assert.equal(job.subject, message.subject);
    assert.equal(job.text, message.text);
    assert.equal(job.status, 'pending');
    assert.equal(job.attempts, 0);
    assert.ok(job.nextAttemptAt instanceof Date);
    assert.match(job.messageId, /^[a-f0-9-]{36}$/i);
    assert.equal(job.lockedAt, null);
    assert.equal(job.lockToken, null);
    assert.equal(job.lastError, null);
    assert.equal(job.sentAt, null);
    assert.equal(Object.getPrototypeOf(result.registration), Object.prototype);
    assert.equal(Object.getPrototypeOf(result.emailJob), Object.prototype);
  });

  it('rolls back the registration if its email job cannot be saved', async () => {
    await assert.rejects(() => registrationsRepository.createWithConfirmation({
      eventId, ...participant
    }, { ...message, subject: null }), { name: 'SequelizeValidationError' });

    assert.equal(await models.Registration.count(), 0);
    assert.equal(await models.EmailJob.count(), 0);
    assert.equal(await models.Event.count(), 1);
  });

  it('preserves the original message when event or attendee details change', async () => {
    const { registration, emailJob } = await registrationsRepository.createWithConfirmation({
      eventId, ...participant
    }, message);
    await models.Event.update({ title: 'Changed title' }, { where: { id: eventId } });
    await models.Registration.update({ email: 'updated@example.com' }, {
      where: { id: registration.id }
    });

    const saved = await models.EmailJob.findByPk(emailJob.id);

    assert.equal(saved.recipient, participant.email);
    assert.equal(saved.subject, message.subject);
    assert.equal(saved.text, message.text);
    assert.equal(saved.messageId, emailJob.messageId);
  });

  it('does not save an email when the registration is invalid', async () => {
    await assert.rejects(() => registrationsRepository.createWithConfirmation({
      eventId, ...participant, name: null
    }, message), { name: 'SequelizeValidationError' });

    assert.equal(await models.Registration.count(), 0);
    assert.equal(await models.EmailJob.count(), 0);
  });

  it('allows only one confirmation job per registration', async () => {
    const { registration } = await registrationsRepository.createWithConfirmation({
      eventId, ...participant
    }, message);

    await assert.rejects(() => models.EmailJob.create({
      registrationId: registration.id, recipient: participant.email, ...message
    }), { name: 'SequelizeUniqueConstraintError' });

    assert.equal(await models.EmailJob.count(), 1);
  });

  it('removes the email job when its registration is deleted', async () => {
    const { registration } = await registrationsRepository.createWithConfirmation({
      eventId, ...participant
    }, message);

    await models.Registration.destroy({ where: { id: registration.id } });

    assert.equal(await models.EmailJob.count(), 0);
  });
});
