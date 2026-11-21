import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import request from 'supertest';
import { EmailJob, Event, Registration, sequelize } from '../../src/models/index.mjs';
import { createTestApp, validEvent } from '../helpers/testApp.mjs';
import { countDuplicateRegistrationGroups, ensureRegistrationUniqueness } from '../../src/repositories/registrationSchemaRepository.mjs';

describe('Registration database constraints', () => {
  let app;
  let event;
  beforeEach(async () => {
    ({ app } = await createTestApp());
    event = await Event.create(validEvent({ capacity: 1 }));
  });
  after(() => sequelize.close());

  it('enforces case-insensitive email uniqueness per event even outside the service', async () => {
    await Registration.create({ eventId: event.id, name: 'First Person', email: 'RAW@example.com' });
    await assert.rejects(() => Registration.create({
      eventId: event.id, name: 'Second Person', email: 'raw@example.com'
    }), { name: 'SequelizeUniqueConstraintError' });
    const other = await Event.create(validEvent());
    await Registration.create({ eventId: other.id, name: 'First Person', email: 'raw@example.com' });
    assert.equal(await Registration.count(), 2);
  });

  it('recognizes pre-existing mixed-case emails as duplicates through HTTP', async () => {
    await Registration.create({ eventId: event.id, name: 'Existing Person', email: 'RAW@example.com' });
    const response = await request(app).post(`/api/events/${event.id}/registrations`)
      .send({ name: 'Other Person', email: 'raw@example.com' });
    assert.equal(response.status, 409);
    assert.match(response.body.error.message, /already registered/);
    assert.equal(await EmailJob.count(), 0);
  });

  it('adds the unique index to an existing table and is safe to run twice', async () => {
    await sequelize.getQueryInterface().removeIndex('Registrations', 'registrations_event_email_unique');
    const existing = await Registration.create({ eventId: event.id, name: 'Existing Person', email: 'existing@example.com' });
    await ensureRegistrationUniqueness();
    await ensureRegistrationUniqueness();
    assert.equal(await Registration.count(), 1);
    assert.equal((await Registration.findByPk(existing.id)).email, 'existing@example.com');
    await assert.rejects(() => Registration.create({
      eventId: event.id, name: 'Duplicate Person', email: 'EXISTING@EXAMPLE.COM'
    }), { name: 'SequelizeUniqueConstraintError' });
  });

  it('refuses to migrate legacy duplicates without deleting or merging records', async () => {
    await sequelize.getQueryInterface().removeIndex('Registrations', 'registrations_event_email_unique');
    await Registration.bulkCreate([
      { eventId: event.id, name: 'First Person', email: 'same@example.com' },
      { eventId: event.id, name: 'Second Person', email: 'SAME@example.com' }
    ]);
    assert.equal(await countDuplicateRegistrationGroups(), 1);
    await assert.rejects(() => ensureRegistrationUniqueness(), { code: 'REGISTRATION_DUPLICATES' });
    assert.equal(await Registration.count(), 2);
  });

  it('releases the lock and preserves the seat when the mail transaction fails', async (t) => {
    const create = EmailJob.create;
    let first = true;
    t.mock.method(EmailJob, 'create', function (...args) {
      if (first) {
        first = false;
        throw new Error('Injected mail storage failure');
      }
      return create.apply(this, args);
    });
    const url = `/api/events/${event.id}/registrations`;
    const results = await Promise.all([
      request(app).post(url).send({ name: 'First Person', email: 'first@example.com' }),
      request(app).post(url).send({ name: 'Second Person', email: 'second@example.com' })
    ]);
    assert.deepEqual(results.map((response) => response.status).sort(), [201, 500]);
    assert.equal(await Registration.count(), 1);
    assert.equal(await EmailJob.count(), 1);
    assert.equal((await Registration.findOne()).email, 'second@example.com');
  });
});
