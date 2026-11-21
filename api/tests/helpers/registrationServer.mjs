import { app } from '../../src/app.mjs';
import { sequelize } from '../../src/models/index.mjs';

// Manual PostgreSQL verification starts two independent API processes. No mail
// worker or schema reset runs here; the parent owns fixture creation and cleanup.
const server = app.listen(0, '127.0.0.1', () => process.send?.({ port: server.address().port }));
process.on('message', async (message) => {
  if (message !== 'stop') return;
  await new Promise((resolve) => server.close(resolve));
  await sequelize.close();
  process.disconnect();
});
