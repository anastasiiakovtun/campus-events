import assert from 'node:assert/strict';
import { env } from '../src/config/env.mjs';
import {
  closeSchemaConnection, countDuplicateRegistrationGroups, ensureRegistrationUniqueness
} from '../src/repositories/registrationSchemaRepository.mjs';

// Supply the expected database hostname separately; credentials stay in env.
// Default is read-only audit. --apply adds only the model's unique index.
const expectedHost = process.argv[2];
const apply = process.argv.includes('--apply');
try {
  assert.ok(expectedHost && env.databaseUrl, 'Supply a PostgreSQL DATABASE_URL and expected hostname');
  const target = new URL(env.databaseUrl);
  assert.equal(target.hostname, expectedHost, 'Unexpected migration database host');
  assert.ok(!target.hostname.includes('-pooler'), 'Use a direct connection for schema migration');
  const groups = await countDuplicateRegistrationGroups();
  console.log(JSON.stringify({ duplicateGroups: groups, mode: apply ? 'apply' : 'audit' }));
  if (apply) {
    await ensureRegistrationUniqueness();
    console.log(JSON.stringify({ registrationUniqueIndex: 'ready' }));
  }
} finally {
  await closeSchemaConnection();
}
