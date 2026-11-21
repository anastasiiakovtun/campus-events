import { randomUUID } from 'node:crypto';
import { literal, Op } from 'sequelize';
import { EmailJob } from '../models/index.mjs';

const dueJobs = (now, staleBefore) => ({
  [Op.or]: [
    { status: 'pending', nextAttemptAt: { [Op.lte]: now } },
    { status: 'processing', lockedAt: { [Op.lte]: staleBefore } }
  ]
});

export async function findDueIds(now, staleBefore, limit) {
  const rows = await EmailJob.findAll({
    attributes: ['id'], where: dueJobs(now, staleBefore),
    order: [['nextAttemptAt', 'ASC'], ['id', 'ASC']], limit
  });
  return rows.map((row) => row.id);
}

export async function claim(id, now, staleBefore) {
  const lockToken = randomUUID();
  // One conditional UPDATE decides ownership, even when two workers found the row.
  const [count] = await EmailJob.update({
    status: 'processing', lockedAt: now, lockToken, attempts: literal('attempts + 1')
  }, { where: { id, ...dueJobs(now, staleBefore) } });
  if (!count) return null;
  const job = await EmailJob.findOne({ where: { id, status: 'processing', lockToken } });
  return job ? job.toJSON() : null;
}

export async function renew(id, lockToken, now) {
  const [count] = await EmailJob.update({ lockedAt: now }, {
    where: { id, status: 'processing', lockToken }
  });
  return count === 1;
}

export async function markSent(id, lockToken, now) {
  const [count] = await EmailJob.update({
    status: 'sent', sentAt: now, lockedAt: null, lockToken: null, lastError: null
  }, { where: { id, status: 'processing', lockToken } });
  return count === 1;
}

export async function retry(id, lockToken, nextAttemptAt, errorCode) {
  const [count] = await EmailJob.update({
    status: 'pending', nextAttemptAt, lastError: errorCode, lockedAt: null, lockToken: null
  }, { where: { id, status: 'processing', lockToken } });
  return count === 1;
}
