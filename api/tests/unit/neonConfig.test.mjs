import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { describe, it } from 'node:test';

// Evaluate the real infrastructure config without connecting to Neon.
function branchSettings(branch) {
  const output = execFileSync(process.execPath, [
    '--experimental-strip-types', '--input-type=module', '--eval', `
      import config from './neon.ts';
      console.log(JSON.stringify(config.branch(${JSON.stringify(branch)})));
    `
  ], { cwd: new URL('../../../', import.meta.url), encoding: 'utf8' });

  return JSON.parse(output);
}

describe('Neon branch policy', () => {
  it('creates a lasting development branch from production', () => {
    assert.deepEqual(branchSettings({ name: 'development', exists: false, isDefault: false }), {
      parent: 'production'
    });
  });

  it('keeps temporary branches on the seven-day expiry', () => {
    assert.deepEqual(branchSettings({ name: 'feature-test', exists: false, isDefault: false }), {
      ttl: '7d'
    });
  });

  it('leaves the existing development branch unchanged', () => {
    assert.deepEqual(branchSettings({ name: 'development', exists: true, isDefault: false }), {});
  });

  it('leaves the default production branch unchanged', () => {
    assert.deepEqual(branchSettings({ name: 'production', exists: true, isDefault: true }), {});
  });
});
