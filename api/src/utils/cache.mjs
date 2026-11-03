// A simple in-memory cache with an expiry time (TTL) per key.
// Same idea as Redis (get / set / del with a TTL), but inside the API process:
// enough for one running copy of the API, and no extra server or package needed.
const store = new Map();

export function get(key) {
  const entry = store.get(key);
  if (!entry) return undefined;
  // Expired: forget it, so the next read loads fresh data.
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return undefined;
  }
  return entry.value;
}

export function set(key, value, ttlSeconds) {
  store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

// Remove the keys that are wrong after a change (update, delete, register).
export function del(...keys) {
  keys.forEach((key) => store.delete(key));
}

// Empty the whole cache (used by the tests, which start every test with a fresh database).
export function clear() {
  store.clear();
}

// Cache-aside in one function: return the cached value, or load it, store it and return it.
export async function remember(key, ttlSeconds, load) {
  const cached = get(key);
  if (cached !== undefined) return cached;
  const value = await load();
  set(key, value, ttlSeconds);
  return value;
}
