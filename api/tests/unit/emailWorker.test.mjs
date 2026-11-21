import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { describe, it } from 'node:test';
import { startEmailWorker } from '../../src/workers/emailWorker.mjs';

describe('Email worker scheduling', () => {
  it('leaves work untouched when SMTP is not configured', async () => {
    let calls = 0;
    const worker = startEmailWorker({ enabled: false, processBatch: async () => { calls += 1; } });
    await worker.stop();
    assert.equal(calls, 0);
  });

  it('waits for a batch to finish before scheduling another poll', async () => {
    let release;
    let scheduled = 0;
    const batch = new Promise((resolve) => { release = resolve; });
    const worker = startEmailWorker({
      enabled: true, processBatch: () => batch,
      setTimer: () => { scheduled += 1; return { unref() {} }; }, clearTimer: () => {}
    });
    assert.equal(scheduled, 0);
    release();
    await setImmediate();
    assert.equal(scheduled, 1);
    await worker.stop();
  });

  it('schedules recovery after a poll error and stops scheduling when stopped', async () => {
    let scheduled = 0;
    let callback;
    let calls = 0;
    const worker = startEmailWorker({
      enabled: true,
      processBatch: async () => { calls += 1; throw new Error('Database unavailable'); },
      setTimer: (next) => { callback = next; scheduled += 1; return { unref() {} }; },
      clearTimer: () => {}
    });
    await setImmediate();
    assert.equal(scheduled, 1);
    callback();
    await worker.stop();
    assert.equal(calls, 2);
    assert.equal(scheduled, 1);
  });
});
