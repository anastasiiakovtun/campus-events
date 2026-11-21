import { app } from './app.mjs';
import { env } from './config/env.mjs';
import { Event, sequelize } from './models/index.mjs';
import { seedDemoData } from './models/seedData.mjs';
import { startEmailWorker } from './workers/emailWorker.mjs';
import { logger } from './utils/logger.mjs';

// Starts the API: create the tables if needed, then listen on the port.
await sequelize.sync();

// First start on a fresh clone: fill the empty database so the UI has something to show.
if ((await Event.count()) === 0) {
  await seedDemoData();
  console.log('Empty database – demo data added');
}

app.listen(env.port, () => {
  console.log(`Campus Events API running on http://localhost:${env.port}/api`);
});

startEmailWorker();
if (!env.smtpUrl) logger.warn('SMTP_URL is missing; confirmation email jobs remain pending');
