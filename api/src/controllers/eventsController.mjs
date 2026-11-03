import * as eventsService from '../services/eventsService.mjs';

// Controller = the "waiter".
// It takes the request, asks the service, and sends the response with the right status code.
// No rules here: the service decides. Errors go automatically to the error handler (Express 5).

// GET /api/events → all events
export async function list(req, res) {
  res.json(await eventsService.listEvents());
}

// GET /api/events/:id → one event, with registered + spotsLeft
export async function getOne(req, res) {
  res.json(await eventsService.getEvent(req.params.id));
}

// POST /api/events → create an event
// 201 = created. Location = the address of the new event.
export async function create(req, res) {
  const event = await eventsService.createEvent(req.body);
  res.status(201).location(`/api/events/${event.id}`).json(event);
}

// PATCH /api/events/:id → change some fields of an event
export async function update(req, res) {
  res.json(await eventsService.updateEvent(req.params.id, req.body));
}

// DELETE /api/events/:id → delete an event
// 204 = done, nothing to send back.
export async function remove(req, res) {
  await eventsService.deleteEvent(req.params.id);
  res.status(204).send();
}