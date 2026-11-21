import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { env } from '../../src/config/env.mjs';
import { EmailJob, Event, Registration, sequelize } from '../../src/models/index.mjs';
import { countDuplicateRegistrationGroups, ensureRegistrationUniqueness } from '../../src/repositories/registrationSchemaRepository.mjs';

// Opt-in only: use a disposable Neon clone, never production. The expected host
// must be supplied independently of DATABASE_URL. Local env files are not edited.
const expectedHost = process.argv[2];
assert.ok(expectedHost, 'Supply the disposable branch hostname');
const target = new URL(env.databaseUrl);
assert.equal(target.hostname, expectedHost, 'Unexpected database target');
assert.ok(!target.hostname.includes('-pooler'), 'Schema verification needs a direct connection');

const children = [];
const fixtureIds = [];
let original;

async function snapshot() {
  const rows = await Promise.all([Event, Registration, EmailJob].map((model) =>
    model.findAll({ raw: true, order: [['id', 'ASC']] })));
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

async function startServer() {
  const child = fork(new URL('../helpers/registrationServer.mjs', import.meta.url), [], {
    stdio: ['ignore', 'ignore', 'inherit', 'ipc']
  });
  children.push(child);
  const [{ port }] = await once(child, 'message', { signal: AbortSignal.timeout(15000) });
  return `http://127.0.0.1:${port}`;
}

async function fixture(capacity) {
  const event = await Event.create({
    title: 'Isolated registration verification', location: 'Test only',
    startsAt: '2099-01-01T12:00:00Z', capacity
  });
  fixtureIds.push(event.id);
  return event.id;
}

async function register(base, eventId, index, email, mcp) {
  const attendee = { name: `Test Attendee ${index}`, email };
  const response = await fetch(`${base}${mcp ? '/api/mcp' : `/api/events/${eventId}/registrations`}`, {
    method: 'POST', signal: AbortSignal.timeout(15000),
    headers: {
      'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2025-11-25'
    },
    body: JSON.stringify(mcp ? {
      jsonrpc: '2.0', id: index, method: 'tools/call',
      params: { name: 'register_for_event', arguments: { eventId, ...attendee } }
    } : attendee)
  });
  const text = await response.text();
  const data = response.headers.get('content-type').includes('text/event-stream')
    ? JSON.parse(text.split('\n').find((line) => line.startsWith('data: ')).slice(6)) : JSON.parse(text);
  return mcp
    ? { saved: Boolean(data.result?.structuredContent?.registration), code: data.result?.structuredContent?.error?.code }
    : { saved: response.status === 201, code: data.error?.code };
}

async function burst(bases, capacity, sameEmail = false) {
  const eventId = await fixture(capacity);
  const results = await Promise.all(Array.from({ length: 12 }, (_, index) => register(
    bases[index % 2], eventId, index,
    sameEmail ? (index % 2 ? 'SAME@EXAMPLE.COM' : 'same@example.com') : `attendee${index}@example.com`,
    index % 2 === 1
  )));
  const expected = sameEmail ? 1 : capacity;
  assert.equal(results.filter((result) => result.saved).length, expected);
  assert.ok(results.every((result) => result.saved || result.code === 'CONFLICT'));
  assert.equal(await Registration.count({ where: { eventId } }), expected);
  const registrations = await Registration.findAll({ where: { eventId }, attributes: ['id'], raw: true });
  assert.equal(await EmailJob.count({ where: { registrationId: registrations.map((row) => row.id) } }), expected);
  console.log(JSON.stringify({ twoProcesses: true, capacity, sameEmail, registrations: expected, mailJobs: expected, passed: true }));
}

try {
  original = await snapshot();
  assert.equal(await countDuplicateRegistrationGroups(), 0, 'Existing duplicate groups prevent the unique index; no data was removed');
  const schema = sequelize.getQueryInterface();
  const indexes = await schema.showIndex('Registrations');
  if (indexes.some((index) => index.name === 'registrations_event_email_unique')) {
    await schema.removeIndex('Registrations', 'registrations_event_email_unique');
  }
  await ensureRegistrationUniqueness();
  await ensureRegistrationUniqueness();
  assert.equal(await snapshot(), original, 'Schema synchronization must preserve existing rows');
  console.log(JSON.stringify({ schemaApplied: true, existingDataPreserved: true, duplicateGroups: 0 }));
  const bases = await Promise.all([startServer(), startServer()]);
  await burst(bases, 1);
  await burst(bases, 3);
  await burst(bases, 20, true);
  const eventId = await fixture(10);
  await Registration.create({ eventId, name: 'Raw test', email: 'RAW@example.com' });
  await assert.rejects(() => Registration.create({
    eventId, name: 'Raw duplicate', email: 'raw@example.com'
  }), { name: 'SequelizeUniqueConstraintError' });
  const duplicate = await register(bases[0], eventId, 99, 'raw@example.com', false);
  assert.deepEqual(duplicate, { saved: false, code: 'CONFLICT' });
  console.log(JSON.stringify({ databaseUniqueness: 'passed', mixedCaseLookup: 'passed' }));
} finally {
  for (const child of children) {
    const closed = once(child, 'exit', { signal: AbortSignal.timeout(15000) });
    child.send('stop');
    await closed;
  }
  if (fixtureIds.length) await Event.destroy({ where: { id: fixtureIds } });
  if (original) {
    assert.equal(await snapshot(), original, 'Existing rows changed during verification');
    console.log(JSON.stringify({ fixturesRemoved: true, originalRowsUnchanged: true }));
  }
  await sequelize.close();
}
