import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';

describe('Environment file loading', () => {
  let directory;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'campus-events-env-'));
    const configDirectory = join(directory, 'api/src/config');
    mkdirSync(configDirectory, { recursive: true });
    copyFileSync(new URL('../../src/config/env.mjs', import.meta.url), join(configDirectory, 'env.mjs'));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  function inspectEnvironment(cwd = directory, settings = {}) {
    const moduleUrl = pathToFileURL(join(directory, 'api/src/config/env.mjs')).href;
    const output = execFileSync(process.execPath, ['--input-type=module', '--eval', `
      const { env } = await import(${JSON.stringify(moduleUrl)});
      console.log(JSON.stringify(env));
    `], {
      cwd, env: { NODE_ENV: 'development', ...settings }, encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });

    return JSON.parse(output);
  }

  function writeEnvironment(file, content) {
    writeFileSync(join(directory, file), content);
  }

  for (const workspace of ['.', 'api']) {
    it(`loads Neon's root .env.local when started from ${workspace}`, () => {
      writeEnvironment('.env.local', 'DATABASE_URL=postgresql://fixture.invalid/campus\n');

      const env = inspectEnvironment(join(directory, workspace));

      assert.equal(env.databaseUrl, 'postgresql://fixture.invalid/campus');
    });
  }

  it('preserves API .env settings while loading the root database URL', () => {
    writeEnvironment('api/.env', 'PORT=4123\nLOG_LEVEL=error\n');
    writeEnvironment('.env.local', 'DATABASE_URL=postgresql://fixture.invalid/campus\n');

    const env = inspectEnvironment();

    assert.equal(env.port, 4123);
    assert.equal(env.logLevel, 'error');
    assert.equal(env.databaseUrl, 'postgresql://fixture.invalid/campus');
  });

  it('uses API files before root files and .env.local before .env', () => {
    writeEnvironment('.env', 'PORT=4100\nLOG_LEVEL=info\nDB_STORAGE=root.sqlite\n');
    writeEnvironment('.env.local', 'PORT=4200\nLOG_LEVEL=warn\n');
    writeEnvironment('api/.env', 'PORT=4300\n');
    writeEnvironment('api/.env.local', 'PORT=4400\n');

    const env = inspectEnvironment();

    assert.equal(env.port, 4400);
    assert.equal(env.logLevel, 'warn');
    assert.equal(env.dbStorage, 'root.sqlite');
  });

  it('gives injected environment variables priority over files', () => {
    writeEnvironment('api/.env.local', 'PORT=4400\nDATABASE_URL=postgresql://fixture.invalid/file\n');

    const env = inspectEnvironment(directory, {
      PORT: '4500', DATABASE_URL: 'postgresql://fixture.invalid/injected'
    });

    assert.equal(env.port, 4500);
    assert.equal(env.databaseUrl, 'postgresql://fixture.invalid/injected');
  });

  it('does not load any env files during tests', () => {
    writeEnvironment('api/.env', 'PORT=4400\nDATABASE_URL=postgresql://fixture.invalid/api\n');
    writeEnvironment('.env.local', 'PORT=4500\nDATABASE_URL=postgresql://fixture.invalid/root\n');

    const env = inspectEnvironment(directory, { NODE_ENV: 'test' });

    assert.equal(env.port, 3000);
    assert.equal(env.databaseUrl, '');
    assert.equal(env.dbStorage, ':memory:');
  });

  it('keeps defaults when optional env files are absent', () => {
    const env = inspectEnvironment();

    assert.equal(env.port, 3000);
    assert.equal(env.databaseUrl, '');
    assert.equal(env.dbStorage, './data/events.sqlite');
  });

  it('reports unreadable env paths instead of silently using another database', () => {
    mkdirSync(join(directory, 'api/.env.local'));

    assert.throws(() => inspectEnvironment(), (error) =>
      error.status === 1 && error.stderr.toString().includes('api/.env.local'));
  });

  it('reads email polling and retry intervals in seconds', () => {
    const env = inspectEnvironment(directory, {
      MAIL_POLL_INTERVAL_SECONDS: '2', MAIL_RETRY_BASE_SECONDS: '10', MAIL_RETRY_MAX_SECONDS: '120'
    });

    assert.equal(env.mailPollIntervalMs, 2000);
    assert.equal(env.mailRetryBaseMs, 10_000);
    assert.equal(env.mailRetryMaxMs, 120_000);
  });

  it('allows local MCP clients and the Render service hostname by default', () => {
    const env = inspectEnvironment(directory, { RENDER_EXTERNAL_HOSTNAME: 'campus-events.example.com' });
    assert.deepEqual(env.mcpAllowedHosts, ['localhost', '127.0.0.1', '[::1]', 'campus-events.example.com']);
  });

  it('uses explicitly configured MCP hostnames instead of the defaults', () => {
    const env = inspectEnvironment(directory, { MCP_ALLOWED_HOSTS: ' API.EXAMPLE.COM, localhost, ' });
    assert.deepEqual(env.mcpAllowedHosts, ['api.example.com', 'localhost']);
  });

  it('reads the Redis URL outside tests and ignores it during tests', () => {
    const settings = { REDIS_URL: 'redis://fixture.invalid:6379' };
    assert.equal(inspectEnvironment(directory, settings).redisUrl, 'redis://fixture.invalid:6379');
    assert.equal(inspectEnvironment(directory, { ...settings, NODE_ENV: 'test' }).redisUrl, '');
  });

  it('uses default email intervals for invalid timer values', () => {
    const env = inspectEnvironment(directory, {
      MAIL_POLL_INTERVAL_SECONDS: 'Infinity', MAIL_RETRY_BASE_SECONDS: '-1', MAIL_RETRY_MAX_SECONDS: '0'
    });

    assert.equal(env.mailPollIntervalMs, 5000);
    assert.equal(env.mailRetryBaseMs, 30_000);
    assert.equal(env.mailRetryMaxMs, 3_600_000);
  });
});
