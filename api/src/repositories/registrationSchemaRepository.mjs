import { Registration, sequelize } from '../models/index.mjs';

export async function countDuplicateRegistrationGroups() {
  const [rows] = await sequelize.query(`SELECT COUNT(*) AS groups FROM (
    SELECT "eventId", lower(email) FROM "Registrations"
    GROUP BY "eventId", lower(email) HAVING COUNT(*) > 1
  ) duplicates`);
  return Number(rows[0].groups);
}

export async function ensureRegistrationUniqueness() {
  if (await countDuplicateRegistrationGroups()) {
    throw Object.assign(new Error('Resolve existing duplicate registration groups before adding the unique index; no records were removed'), {
      code: 'REGISTRATION_DUPLICATES'
    });
  }
  // Uses the versioned model definition; no alter/force, row rewrite or deletion.
  await Registration.sync();
}

export const closeSchemaConnection = () => sequelize.close();
