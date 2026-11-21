import { BASE_URL, request } from './client.js';

export const getEvents = () => request('/events');
export const getEvent = (id) => request(`/events/${id}`);
export const createEvent = (event) => request('/events', { method: 'POST', body: event });
export const deleteEvent = (id) => request(`/events/${id}`, { method: 'DELETE' });

export const getRegistrations = (eventId) => request(`/events/${eventId}/registrations`);
export const register = (eventId, participant) =>
  request(`/events/${eventId}/registrations`, { method: 'POST', body: participant });

export const getStats = () => request('/stats');

const validNotificationHeader = (data) => Boolean(data && typeof data.id === 'string' && data.id &&
  typeof data.title === 'string' && Number.isInteger(data.eventId) && data.eventId > 0);

function publicNotification(data) {
  if (!validNotificationHeader(data)) return null;
  const common = { id: data.id, type: data.type, eventId: data.eventId, title: data.title };
  if (data.type === 'event.created' && Number.isFinite(Date.parse(data.startsAt))) {
    return { ...common, startsAt: data.startsAt };
  }
  if (data.type === 'registration.created' && [data.registered, data.spotsLeft].every((value) => Number.isInteger(value) && value >= 0)) {
    return { ...common, registered: data.registered, spotsLeft: data.spotsLeft };
  }
  return null;
}

export function subscribeNotifications({ onNotification, onOpen }) {
  let source;
  const receive = (event) => {
    let data;
    try { data = JSON.parse(event.data); } catch { return; }
    const notification = publicNotification(data);
    if (notification) onNotification(notification);
  };
  function connect() {
    if (source) return;
    source = new EventSource(`${BASE_URL}/notifications`);
    source.addEventListener('notification', receive);
    source.addEventListener('open', onOpen);
  }
  function disconnect() {
    if (!source) return;
    source.removeEventListener('notification', receive);
    source.removeEventListener('open', onOpen);
    source.close();
    source = null;
  }
  // A browser can keep the stream alive while REST reads fail offline. Replace
  // that stream on network recovery so buffered toasts are not replayed.
  window.addEventListener('offline', disconnect);
  window.addEventListener('online', connect);
  if (navigator.onLine !== false) connect();
  return () => {
    window.removeEventListener('offline', disconnect);
    window.removeEventListener('online', connect);
    disconnect();
  };
}
