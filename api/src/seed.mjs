// `npm run seed`: wipes the database and fills it with demo data again.
import { sequelize } from './models/index.mjs';
import { seedDemoData } from './models/seedData.mjs';

await sequelize.sync({ force: true });
await seedDemoData();

console.log('Database reset with demo data.');
await sequelize.close();