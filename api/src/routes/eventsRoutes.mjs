import { Router } from 'express';
import * as eventsController from '../controllers/eventsController.mjs';
import * as registrationsController from '../controllers/registrationsController.mjs';
import { createEventSchema, idParams, registrationSchema, updateEventSchema, validate } from '../middleware/validate.mjs';

// Routes = the "menu": which URL goes to which controller.
// Each line: HTTP method + URL → form check (validate) → controller function.
// No logic here: the check is in validate.mjs, the rules are in the services.
// This router is mounted on /api/events in app.mjs, so '/' here means /api/events.
export const eventsRoutes = Router();

// ---------------------------------------------------------------- events

// GET /api/events → all events. Nothing to check: no id, no body.
eventsRoutes.get('/', eventsController.list);

// POST /api/events → create an event. Check the body (title, location, startsAt, capacity).
eventsRoutes.post('/', validate({ body: createEventSchema }), eventsController.create);

// GET /api/events/:id → one event. Check that :id is a positive number ("abc" → 400).
eventsRoutes.get('/:id', validate({ params: idParams }), eventsController.getOne);

// PATCH /api/events/:id → change an event. Check the id AND the fields that are sent.
eventsRoutes.patch('/:id', validate({ params: idParams, body: updateEventSchema }), eventsController.update);

// DELETE /api/events/:id → delete an event. Only the id needs a check.
eventsRoutes.delete('/:id', validate({ params: idParams }), eventsController.remove);

// ---------------------------------------------------------------- registrations of one event
// These URLs start with /api/events/:id, so they live in this menu too.

// GET /api/events/:id/registrations → who is registered for this event.
eventsRoutes.get('/:id/registrations', validate({ params: idParams }), registrationsController.list);

// POST /api/events/:id/registrations → register someone. Check the id AND { name, email }.
eventsRoutes.post('/:id/registrations', validate({ params: idParams, body: registrationSchema }), registrationsController.create);