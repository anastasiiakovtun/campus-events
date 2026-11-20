import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { describe, it } from 'node:test';

// Each process imports the real configuration and models with isolated settings.
// No connection is opened, so these checks need no hosted database or credentials.
function inspectDatabase(settings) {
  const output = execFileSync(process.execPath, ['--input-type=module', '--eval', `
    import pg from 'pg';
    import { sequelize } from './src/models/index.mjs';
    const client = new pg.Client({ ...sequelize.config, ...sequelize.options.dialectOptions });
    console.log(JSON.stringify({
      dialect: sequelize.getDialect(),
      storage: sequelize.options.storage,
      host: sequelize.config.host,
      database: sequelize.config.database,
      ssl: client.ssl
    }));
    await sequelize.close();
  `], {
    cwd: new URL('../../', import.meta.url),
    env: settings,
    encoding: 'utf8'
  });

  return JSON.parse(output);
}

describe('Database configuration', () => {
  it('uses the configured SQLite file without DATABASE_URL', () => {
    const database = inspectDatabase({
      NODE_ENV: 'production', DATABASE_URL: '', DB_STORAGE: './data/local.sqlite'
    });

    assert.equal(database.dialect, 'sqlite');
    assert.equal(database.storage, './data/local.sqlite');
  });

  for (const query of ['', '?sslmode=require', '?sslmode=verify-full']) {
    it(`uses PostgreSQL with TLS for a URL ending in ${query || 'no SSL parameters'}`, () => {
      const database = inspectDatabase({
        NODE_ENV: 'production',
        DATABASE_URL: `postgresql://example:example@database.invalid:5432/campus_events${query}`
      });

      assert.equal(database.dialect, 'postgres');
      assert.equal(database.host, 'database.invalid');
      assert.equal(database.database, 'campus_events');
      assert.ok(database.ssl);
      // An empty TLS object uses Node's default certificate verification.
      assert.notEqual(database.ssl.rejectUnauthorized, false);
    });
  }

  it('keeps tests on in-memory SQLite even with real database settings', () => {
    const database = inspectDatabase({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://example:example@database.invalid:5432/campus_events',
      DB_STORAGE: './data/do-not-touch.sqlite'
    });

    assert.equal(database.dialect, 'sqlite');
    assert.equal(database.storage, ':memory:');
  });
});
