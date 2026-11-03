import { z } from 'zod';
import { AppError } from '../utils/AppError.mjs';

// ---------------------------------------------------------------- the rules (schemas)
// What correct input looks like. Zod checks the data and gives clear error messages.
// Messages are shown to end users in the frontend, so keep them human.

// The :id in the URL must be a positive whole number. "abc" → 400.
export const idParams = z.object({
  id: z.coerce.number().int().positive()
});

export const createEventSchema = z.object({
  title: z.string().trim().min(3, 'Use at least 3 characters').max(120, 'Use at most 120 characters'),
  description: z.string().trim().max(2000, 'Use at most 2000 characters').optional(),
  location: z.string().trim().min(2, 'Enter a location').max(120, 'Use at most 120 characters'),
  startsAt: z.coerce.date({ error: 'Pick a date and time' }),
  capacity: z.number({ error: 'Enter a number of seats' }).int('Use a whole number').min(1, 'At least 1 seat').max(10000, 'At most 10 000 seats')
});

// For PATCH: the same fields, but all optional. At least one is needed.
export const updateEventSchema = createEventSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0, { message: 'Provide at least one field to update' });

// toLowerCase(): ADA@example.com and ada@example.com count as the same person.
export const registrationSchema = z.object({
  name: z.string().trim().min(2, 'Enter your name (at least 2 characters)').max(100, 'Use at most 100 characters'),
  email: z.email('Enter a valid email address').toLowerCase()
});

// ---------------------------------------------------------------- the check (middleware)
// Runs BEFORE the controller. Usage in a route: validate({ params: idParams, body: createEventSchema })
// Replaces the 400 block that was copy-pasted 7 times in the old app.mjs.
export function validate(schemas) {
  return (req, res, next) => {
    // Check each part (params first, then body). Stop at the first part with errors.
    for (const [part, schema] of Object.entries(schemas)) {
      const result = schema.safeParse(req[part]);
      if (!result.success) {
        const details = result.error.issues.map((issue) => ({
          field: issue.path.join('.') || part,
          message: issue.message
        }));
        return next(new AppError(400, 'VALIDATION_ERROR', 'Request validation failed', details));
      }
      // Replace the input with the cleaned data (e.g. id "5" becomes number 5, email in lowercase).
      req[part] = result.data;
    }
    next();
  };
}