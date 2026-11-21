import { env } from '../config/env.mjs';
import { processEmailJobs } from '../services/emailDeliveryService.mjs';
import { logger } from '../utils/logger.mjs';

export function startEmailWorker({
  processBatch = processEmailJobs, enabled = Boolean(env.smtpUrl),
  intervalMs = env.mailPollIntervalMs, setTimer = setTimeout, clearTimer = clearTimeout
} = {}) {
  let stopped = !enabled;
  let timer;
  let current = Promise.resolve();

  async function poll() {
    if (stopped) return;
    try {
      await processBatch();
    } catch (error) {
      logger.error('email worker poll failed', { code: String(error?.code || error?.name || 'POLL_FAILED') });
    }
    // Schedule after completion so a slow SMTP batch never overlaps the next poll.
    if (!stopped) {
      timer = setTimer(() => { current = poll(); }, intervalMs);
      timer.unref();
    }
  }

  if (enabled) current = poll();
  return {
    async stop() {
      stopped = true;
      clearTimer(timer);
      await current;
    }
  };
}
