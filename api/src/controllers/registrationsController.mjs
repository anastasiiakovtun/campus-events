import * as registrationsService from '../services/registrationsService.mjs';

// Controller for registrations (people signing up for an event).

// GET /api/events/:id/registrations → who is registered for this event
export async function list(req, res) {
  res.json(await registrationsService.listRegistrations(req.params.id));
}

// POST /api/events/:id/registrations → register someone { name, email }
// The service checks: event exists? already registered? event full?
export async function create(req, res) {
  const registration = await registrationsService.register(req.params.id, req.body);
  res.status(201).json(registration);
}