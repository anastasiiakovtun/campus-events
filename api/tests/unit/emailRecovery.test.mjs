import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { it } from 'node:test';
import { QueryTypes, Sequelize } from 'sequelize';
import { createSmtpServer } from '../helpers/smtpServer.mjs';

async function waitFor(check) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await delay(25);
  }
  throw new Error('Email recovery check timed out');
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exit = once(child, 'exit');
  child.kill('SIGTERM');
  await exit;
}

it('retries a failed HTTP registration email after restarting the API process', { timeout: 30_000 }, async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'campus-events-mail-recovery-'));
  const storage = join(directory, 'events.sqlite');
  const smtp = await createSmtpServer({ failures: 1 });
  const database = new Sequelize({ dialect: 'sqlite', storage, logging: false });
  let child;
  t.after(async () => {
    await stop(child);
    await smtp.close();
    await database.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const base = `http://127.0.0.1:${port}`;

  async function start() {
    child = fork(new URL('../../src/server.mjs', import.meta.url), [], {
      cwd: new URL('../../', import.meta.url), execArgv: [], silent: true,
      env: {
        NODE_ENV: 'development', DATABASE_URL: '', DB_STORAGE: storage,
        PORT: String(port), LOG_LEVEL: 'error', MAIL_FROM: 'test@example.com',
        SMTP_URL: `smtp://127.0.0.1:${smtp.port}`,
        MAIL_POLL_INTERVAL_SECONDS: '0.1', MAIL_RETRY_BASE_SECONDS: '30', MAIL_RETRY_MAX_SECONDS: '30'
      }
    });
    child.stdout.resume();
    child.stderr.resume();
    await waitFor(async () => {
      assert.equal(child.exitCode, null, 'API exited before it became ready');
      return fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1000) })
        .then((response) => response.ok).catch(() => false);
    });
  }

  async function request(path, data) {
    const response = await fetch(`${base}/api${path}`, {
      method: data ? 'POST' : 'GET',
      headers: data ? { 'Content-Type': 'application/json' } : undefined,
      body: data ? JSON.stringify(data) : undefined,
      signal: AbortSignal.timeout(5000)
    });
    assert.equal(response.status, data ? 201 : 200);
    return response.json();
  }

  await start();
  const event = await request('/events', {
    title: 'Email restart check', location: 'Test room',
    startsAt: '2027-01-15T14:00:00Z', capacity: 2
  });
  const registration = await request(`/events/${event.id}/registrations`, {
    name: 'Restart Test', email: 'restart@example.com'
  });
  const readJob = async () => (await database.query(
    'SELECT * FROM "EmailJobs" WHERE "registrationId" = :registrationId',
    { replacements: { registrationId: registration.id }, type: QueryTypes.SELECT }
  ))[0];
  const pending = await waitFor(async () => {
    const job = await readJob();
    return job?.status === 'pending' && job.attempts === 1 ? job : null;
  });
  assert.equal(smtp.accepted.length, 0);
  await stop(child);
  assert.equal((await readJob()).id, pending.id);

  // Advance only this fixture's retry time instead of waiting the full backoff.
  await database.query('UPDATE "EmailJobs" SET "nextAttemptAt" = CURRENT_TIMESTAMP WHERE id = :id', {
    replacements: { id: pending.id }
  });
  await start();
  const sent = await waitFor(async () => {
    const job = await readJob();
    return job?.status === 'sent' ? job : null;
  });
  assert.equal(sent.id, pending.id);
  assert.equal(sent.messageId, pending.messageId);
  assert.equal(sent.attempts, 2);
  assert.equal(smtp.accepted.length, 1);
  assert.equal((await request(`/events/${event.id}/registrations`)).length, 1);
});
