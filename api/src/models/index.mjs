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

// Store the message itself so later event edits cannot change a pending email.
export const EmailJob = sequelize.define('EmailJob', {
  registrationId: { type: DataTypes.INTEGER, allowNull: false, unique: true },
  recipient: { type: DataTypes.STRING(254), allowNull: false },
  subject: { type: DataTypes.STRING(200), allowNull: false },
  text: { type: DataTypes.TEXT, allowNull: false },
  messageId: { type: DataTypes.UUID, allowNull: false, defaultValue: DataTypes.UUIDV4, unique: true },
  status: {
    type: DataTypes.STRING(16), allowNull: false, defaultValue: 'pending',
    validate: { isIn: [['pending', 'processing', 'sent']] }
  },
  attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, validate: { min: 0 } },
  nextAttemptAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  lockedAt: { type: DataTypes.DATE, allowNull: true },
  lockToken: { type: DataTypes.UUID, allowNull: true },
  lastError: { type: DataTypes.TEXT, allowNull: true },
  sentAt: { type: DataTypes.DATE, allowNull: true }
}, {
  indexes: [{ fields: ['status', 'nextAttemptAt'] }]
});

// One event has many registrations. Deleting an event also deletes its registrations.
Event.hasMany(Registration, { foreignKey: { name: 'eventId', allowNull: false }, onDelete: 'CASCADE' });
Registration.belongsTo(Event, { foreignKey: 'eventId' });

Registration.hasOne(EmailJob, { foreignKey: 'registrationId', onDelete: 'CASCADE' });
EmailJob.belongsTo(Registration, { foreignKey: 'registrationId' });
