// One place for all HTTP calls. Turns the API error format
// { error: { code, message, details } } into an ApiError you can show in the UI.
export const BASE_URL = '/api';

export class ApiError extends Error {
  constructor(status, { code, message, details } = {}) {
    super(message ?? `Request failed with status ${status}`);
    this.status = status;
    this.code = code;
    this.details = details ?? [];
  }
}

export async function request(path, { method = 'GET', body } = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });

  if (response.status === 204) return null;

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, data.error);
  return data;
}
