import { DataTypes, Sequelize } from 'sequelize';
import { env } from '../config/env.mjs';

// Render uses hosted PostgreSQL; local development defaults to a SQLite file.
export const sequelize = env.databaseUrl
  ? new Sequelize(env.databaseUrl, {
    dialect: 'postgres',
    logging: false,
    dialectOptions: { ssl: { rejectUnauthorized: true } }
  })
  : new Sequelize({
    dialect: 'sqlite',
    storage: env.dbStorage,
    logging: false
  });

// The "events" table and its columns.
export const Event = sequelize.define('Event', {
  title: { type: DataTypes.STRING(120), allowNull: false },
  description: { type: DataTypes.TEXT, allowNull: true },
  location: { type: DataTypes.STRING(120), allowNull: false },
  startsAt: { type: DataTypes.DATE, allowNull: false },
  capacity: { type: DataTypes.INTEGER, allowNull: false, validate: { min: 1 } }
});

// The "registrations" table and its columns.
export const Registration = sequelize.define('Registration', {
  name: { type: DataTypes.STRING(100), allowNull: false },
  email: { type: DataTypes.STRING(254), allowNull: false }
});

// One event has many registrations. Deleting an event also deletes its registrations.
Event.hasMany(Registration, { foreignKey: { name: 'eventId', allowNull: false }, onDelete: 'CASCADE' });
Registration.belongsTo(Event, { foreignKey: 'eventId' });
