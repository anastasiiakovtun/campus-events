// The only file that reads process.env. Everything else imports `env` from here.
if (process.env.NODE_ENV !== 'test') {
  try {
    process.loadEnvFile();
  } catch {
    // no .env file: use the defaults below
  }
}

const nodeEnv = process.env.NODE_ENV || 'development';

export const env = {
  nodeEnv,
  port: Number(process.env.PORT) || 3000,
  logLevel: process.env.LOG_LEVEL || 'info',
  // Integration tests reset tables, so they must never connect to saved data.
  databaseUrl: nodeEnv === 'test' ? '' : process.env.DATABASE_URL || '',
  dbStorage: nodeEnv === 'test' ? ':memory:' : process.env.DB_STORAGE || './data/events.sqlite',
  // Mail server address, e.g. smtps://user:password@smtp.example.com. Empty = don't really send.
  smtpUrl: process.env.SMTP_URL || '',
  mailFrom: process.env.MAIL_FROM || 'Campus Events <no-reply@campus-events.test>',
  // How long (in seconds) a GET answer stays in the cache.
  cacheTtlSeconds: Number(process.env.CACHE_TTL_SECONDS) || 60
};
