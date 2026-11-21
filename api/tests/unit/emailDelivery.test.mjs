import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import nodemailer from 'nodemailer';
import { env } from '../../src/config/env.mjs';
import { EmailJob, Registration, sequelize } from '../../src/models/index.mjs';
import * as emailJobsRepository from '../../src/repositories/emailJobsRepository.mjs';
import { processEmailJobs, EMAIL_LEASE_MS } from '../../src/services/emailDeliveryService.mjs';
import { register } from '../../src/services/registrationsService.mjs';
import { createEvent } from '../../src/services/eventsService.mjs';
import { createEmailSender } from '../../src/utils/mailer.mjs';
import { logger } from '../../src/utils/logger.mjs';
import { createTestApp, validEvent } from '../helpers/testApp.mjs';
import { createSmtpServer } from '../helpers/smtpServer.mjs';

describe('Durable confirmation delivery', () => {
  let job;
  let now;
  const clock = () => new Date(now);

  beforeEach(async () => {
    await createTestApp();
    const event = await createEvent(validEvent());
    await register(event.id, { name: 'Test Attendee', email: 'attendee@example.com' });
    job = (await EmailJob.findOne()).toJSON();
    now = new Date(job.nextAttemptAt);
  });

  after(() => sequelize.close());

  it('registration saves a pending message before any SMTP attempt', async () => {
    assert.equal(job.status, 'pending');
    assert.equal(job.attempts, 0);
    assert.equal(job.recipient, 'attendee@example.com');
    assert.match(job.subject, /Backend Bootcamp/);
    assert.match(job.text, /Test Attendee/);
    assert.equal(await Registration.count(), 1);
  });

  it('marks accepted mail sent and does not send it again on later polls', async () => {
    let sends = 0;
    const send = async () => { sends += 1; };
    const result = await processEmailJobs({ send, clock });
    await processEmailJobs({ send, clock });
    const saved = await EmailJob.findByPk(job.id);

    assert.equal(result.sent, 1);
    assert.equal(sends, 1);
    assert.equal(saved.status, 'sent');
    assert.equal(saved.attempts, 1);
    assert.equal(saved.sentAt.getTime(), now.getTime());
    assert.equal(saved.lockToken, null);
  });

  it('keeps failed mail pending and waits until its retry is due', async () => {
    let sends = 0;
    const send = async () => {
      sends += 1;
      throw Object.assign(new Error('Temporary SMTP failure'), { code: 'ECONNECTION' });
    };
    const result = await processEmailJobs({ send, clock });
    const saved = await EmailJob.findByPk(job.id);
    await processEmailJobs({ send, clock });

    assert.equal(result.retried, 1);
    assert.equal(saved.status, 'pending');
    assert.equal(saved.lastError, 'ECONNECTION');
    assert.equal(saved.attempts, 1);
    assert.equal(saved.nextAttemptAt.getTime(), now.getTime() + env.mailRetryBaseMs);
    assert.equal(saved.lockedAt, null);
    assert.equal(sends, 1);
    assert.equal(await Registration.count(), 1);
  });

  it('delivers after a real SMTP rejection and recovery with the same message ID', async (t) => {
    const smtp = await createSmtpServer({ failures: 1 });
    t.after(() => smtp.close());
    const transport = nodemailer.createTransport({
      host: '127.0.0.1', port: smtp.port, secure: false, ignoreTLS: true,
      connectionTimeout: 2000, socketTimeout: 2000
    });
    const send = createEmailSender(transport);
    assert.equal((await processEmailJobs({ send, clock })).retried, 1);
    const pending = await EmailJob.findByPk(job.id);
    assert.equal(pending.status, 'pending');
    now = pending.nextAttemptAt;
    assert.equal((await processEmailJobs({ send, clock })).sent, 1);
    const saved = await EmailJob.findByPk(job.id);

    assert.equal(saved.status, 'sent');
    assert.equal(saved.attempts, 2);
    assert.equal(saved.lastError, null);
    assert.equal(smtp.attempts.length, 2);
    assert.equal(smtp.accepted.length, 1);
    const messageId = (message) => message.match(/^Message-ID: (.+)$/im)?.[1];
    assert.ok(messageId(smtp.attempts[0]));
    assert.equal(messageId(smtp.attempts[0]), messageId(smtp.attempts[1]));
  });

  it('logs only safe SMTP diagnostics for authentication failures', async (t) => {
    const warnings = [];
    t.mock.method(logger, 'warn', (message, details) => warnings.push({ message, details }));
    const failures = [
      { responseCode: 525, command: 'AUTH LOGIN', smtpStage: 'AUTH' },
      { responseCode: 535, command: 'AUTH PLAIN sensitive-payload', smtpStage: 'AUTH' },
      { responseCode: '535 sensitive-payload', command: 'sensitive-payload', smtpStage: undefined }
    ];
    for (const failure of failures) {
      const send = async () => {
        throw Object.assign(new Error('sensitive-payload'), {
          code: 'EAUTH', command: failure.command, responseCode: failure.responseCode,
          response: 'sensitive-payload', password: 'sensitive-payload'
        });
      };
      assert.equal((await processEmailJobs({ send, clock })).retried, 1);
      const saved = await EmailJob.findByPk(job.id);
      const warning = warnings.at(-1);
      assert.equal(warning.details.responseCode, Number.isInteger(failure.responseCode) ? failure.responseCode : undefined);
      assert.equal(warning.details.smtpStage, failure.smtpStage);
      assert.equal(warning.details.nextAttemptAt, saved.nextAttemptAt.toISOString());
      assert.doesNotMatch(JSON.stringify(warning), /sensitive-payload/);
      assert.equal(saved.lastError, 'EAUTH');
      now = saved.nextAttemptAt;
    }
  });

  it('allows only one of two competing workers to send a pending job', async () => {
    let sends = 0;
    const send = async () => { sends += 1; };
    await Promise.all([processEmailJobs({ send, clock }), processEmailJobs({ send, clock })]);

    assert.equal(sends, 1);
    assert.equal((await EmailJob.findByPk(job.id)).attempts, 1);
  });

  it('recovers a job left processing by a crashed worker', async () => {
    await emailJobsRepository.claim(job.id, now, new Date(now.getTime() - EMAIL_LEASE_MS));
    let sends = 0;
    const send = async () => { sends += 1; };
    await processEmailJobs({ send, clock });
    assert.equal(sends, 0);
    now = new Date(now.getTime() + EMAIL_LEASE_MS + 1);
    await processEmailJobs({ send, clock });

    assert.equal(sends, 1);
    assert.equal((await EmailJob.findByPk(job.id)).attempts, 2);
  });

  it('does not let an expired owner overwrite a new worker claim', async () => {
    const old = await emailJobsRepository.claim(job.id, now, new Date(now.getTime() - EMAIL_LEASE_MS));
    now = new Date(now.getTime() + EMAIL_LEASE_MS + 1);
    const current = await emailJobsRepository.claim(job.id, now, new Date(now.getTime() - EMAIL_LEASE_MS));

    assert.equal(await emailJobsRepository.markSent(job.id, old.lockToken, now), false);
    assert.equal(await emailJobsRepository.retry(job.id, old.lockToken, now, 'STALE'), false);
    assert.equal((await EmailJob.findByPk(job.id)).lockToken, current.lockToken);
  });

  it('renews a live claim so it cannot be recovered as a crashed job', async () => {
    const claimed = await emailJobsRepository.claim(job.id, now, new Date(now.getTime() - EMAIL_LEASE_MS));
    now = new Date(now.getTime() + EMAIL_LEASE_MS - 1);
    assert.equal(await emailJobsRepository.renew(job.id, claimed.lockToken, now), true);
    now = new Date(now.getTime() + 2);

    const ids = await emailJobsRepository.findDueIds(now, new Date(now.getTime() - EMAIL_LEASE_MS), 10);
    assert.deepEqual(ids, []);
  });

  it('keeps the lease alive while a slow SMTP send is in progress', async (t) => {
    let heartbeat;
    let cleared = false;
    t.mock.method(globalThis, 'setInterval', (callback) => {
      heartbeat = callback;
      return { unref() {} };
    });
    t.mock.method(globalThis, 'clearInterval', () => { cleared = true; });
    let release;
    let started;
    const sending = new Promise((resolve) => { started = resolve; });
    const gate = new Promise((resolve) => { release = resolve; });
    const work = processEmailJobs({ send: async () => { started(); await gate; }, clock });
    try {
      await sending;
      now = new Date(now.getTime() + EMAIL_LEASE_MS - 1);
      heartbeat();
      const deadline = Date.now() + 1000;
      while ((await EmailJob.findByPk(job.id)).lockedAt.getTime() !== now.getTime()) {
        assert.ok(Date.now() < deadline, 'Expected the worker to renew its lease');
        await delay(1);
      }
      now = new Date(now.getTime() + 2);
      const result = await processEmailJobs({ send: async () => assert.fail('Claim is still owned'), clock });
      assert.equal(result.sent, 0);
    } finally {
      release();
      await work;
    }
    assert.equal(cleared, true);
    assert.equal((await EmailJob.findByPk(job.id)).attempts, 1);
  });

  it('caps exponential backoff instead of discarding repeatedly failing jobs', async () => {
    await EmailJob.update({ attempts: 30 }, { where: { id: job.id } });
    await processEmailJobs({ send: async () => { throw new Error('Still offline'); }, clock });
    const saved = await EmailJob.findByPk(job.id);

    assert.equal(saved.status, 'pending');
    assert.equal(saved.attempts, 31);
    assert.equal(saved.nextAttemptAt.getTime(), now.getTime() + env.mailRetryMaxMs);
  });

  it('does not count a missing SMTP transport or a JSON preview as delivered', async () => {
    await assert.rejects(() => createEmailSender(null)(job), { code: 'SMTP_NOT_CONFIGURED' });
    const send = createEmailSender(nodemailer.createTransport({ jsonTransport: true }));
    assert.equal((await processEmailJobs({ send, clock })).retried, 1);
    assert.equal((await EmailJob.findByPk(job.id)).status, 'pending');
  });

  it('retains the lease when SMTP succeeds but its database acknowledgement fails', async (t) => {
    const update = EmailJob.update;
    t.mock.method(EmailJob, 'update', async (values, options) => {
      if (values.status === 'sent') throw new Error('Database unavailable after SMTP acceptance');
      return update.call(EmailJob, values, options);
    });
    let sends = 0;
    const send = async () => { sends += 1; };
    assert.equal((await processEmailJobs({ send, clock })).failed, 1);
    assert.equal((await EmailJob.findByPk(job.id)).status, 'processing');
    await processEmailJobs({ send, clock });
    assert.equal(sends, 1);
    t.mock.restoreAll();
    now = new Date(now.getTime() + EMAIL_LEASE_MS + 1);
    assert.equal((await processEmailJobs({ send, clock })).sent, 1);
    assert.equal(sends, 2);
  });
});
