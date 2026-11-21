import { env } from '../config/env.mjs';
import * as emailJobsRepository from '../repositories/emailJobsRepository.mjs';
import { logger } from '../utils/logger.mjs';
import { sendEmailJob } from '../utils/mailer.mjs';

export const EMAIL_LEASE_MS = 120_000;
const errorCode = (error) => String(error?.code || error?.name || 'SEND_FAILED').slice(0, 100);

function keepLeaseAlive(job, clock, leaseMs) {
  let renewing = false;
  let renewal = Promise.resolve();
  const timer = setInterval(() => {
    if (renewing) return;
    renewing = true;
    renewal = emailJobsRepository.renew(job.id, job.lockToken, clock())
      .catch((error) => logger.error('email lease renewal failed', { jobId: job.id, code: errorCode(error) }))
      .finally(() => { renewing = false; });
  }, Math.max(1, Math.floor(leaseMs / 3)));
  timer.unref();
  return async () => {
    clearInterval(timer);
    await renewal;
  };
}

async function deferJob(job, error, clock) {
  const delay = Math.min(env.mailRetryMaxMs, env.mailRetryBaseMs * 2 ** Math.min(job.attempts - 1, 32));
  const nextAttemptAt = new Date(clock().getTime() + delay);
  const code = errorCode(error);
  const updated = await emailJobsRepository.retry(job.id, job.lockToken, nextAttemptAt, code);
  if (!updated) return 'skipped';
  logger.warn('confirmation mail scheduled for retry', { jobId: job.id, attempts: job.attempts, code });
  return 'retried';
}

async function deliverClaimedJob(job, send, clock, leaseMs) {
  const stopRenewal = keepLeaseAlive(job, clock, leaseMs);
  try {
    let result;
    try {
      result = await send(job);
    } catch (error) {
      return await deferJob(job, error, clock);
    }
    // An acknowledgement failure leaves the lease for recovery, not an immediate resend.
    const updated = await emailJobsRepository.markSent(job.id, job.lockToken, clock());
    if (!updated) return 'skipped';
    const previewUrl = env.nodeEnv === 'development' ? result?.previewUrl : undefined;
    logger.info('confirmation mail sent', { jobId: job.id, registrationId: job.registrationId, previewUrl });
    return 'sent';
  } finally {
    await stopRenewal();
  }
}

async function processJob(id, send, clock, leaseMs) {
  try {
    const claimedAt = clock();
    const job = await emailJobsRepository.claim(id, claimedAt, new Date(claimedAt.getTime() - leaseMs));
    return job ? await deliverClaimedJob(job, send, clock, leaseMs) : 'skipped';
  } catch (error) {
    logger.error('email job processing failed', { jobId: id, code: errorCode(error) });
    return 'failed';
  }
}

export async function processEmailJobs({
  send = sendEmailJob, clock = () => new Date(), limit = 10, leaseMs = EMAIL_LEASE_MS
} = {}) {
  const now = clock();
  const ids = await emailJobsRepository.findDueIds(now, new Date(now.getTime() - leaseMs), limit);
  const counts = { sent: 0, retried: 0, skipped: 0, failed: 0 };
  for (const id of ids) {
    const outcome = await processJob(id, send, clock, leaseMs);
    counts[outcome] += 1;
  }
  return counts;
}
