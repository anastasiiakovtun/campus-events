import { fileURLToPath } from 'node:url';

// The only file that reads process.env. Everything else imports `env` from here.
function loadOptionalEnvFile(relativePath) {
  try {
    process.loadEnvFile(fileURLToPath(new URL(relativePath, import.meta.url)));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

if (process.env.NODE_ENV !== 'test') {
  // Existing process variables win. API-specific files take priority over root
  // files, regardless of the directory the app was started from.
  for (const file of ['../../.env.local', '../../.env', '../../../.env.local', '../../../.env']) {
    loadOptionalEnvFile(file);
  }
}

const nodeEnv = process.env.NODE_ENV || 'development';

function milliseconds(value, fallbackSeconds) {
  const parsed = Number(value) * 1000;
  return Number.isFinite(parsed) && parsed >= 1 && parsed <= 2_147_483_647
    ? parsed : fallbackSeconds * 1000;
}

export const env = {
  nodeEnv,
  port: Number(process.env.PORT) || 3000,
  logLevel: process.env.LOG_LEVEL || 'info',
  // Integration tests reset tables, so they must never connect to saved data.
  databaseUrl: nodeEnv === 'test' ? '' : process.env.DATABASE_URL || '',
  dbStorage: nodeEnv === 'test' ? ':memory:' : process.env.DB_STORAGE || './data/events.sqlite',
  // Missing SMTP leaves confirmation jobs pending instead of simulating delivery.
  smtpUrl: process.env.SMTP_URL || '',
  mailFrom: process.env.MAIL_FROM || 'Campus Events <no-reply@campus-events.test>',
  mailPollIntervalMs: milliseconds(process.env.MAIL_POLL_INTERVAL_SECONDS, 5),
  mailRetryBaseMs: milliseconds(process.env.MAIL_RETRY_BASE_SECONDS, 30),
  mailRetryMaxMs: milliseconds(process.env.MAIL_RETRY_MAX_SECONDS, 3600),
  // How long (in seconds) a GET answer stays in the cache.
  cacheTtlSeconds: Number(process.env.CACHE_TTL_SECONDS) || 60
};
