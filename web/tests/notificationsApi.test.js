import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { subscribeNotifications } from '../src/api/events.js';

let source;
class FakeEventSource extends EventTarget {
  constructor(url) { super(); this.url = url; this.close = vi.fn(); source = this; }
  send(data) { this.dispatchEvent(new MessageEvent('notification', { data })); }
}

beforeEach(() => vi.stubGlobal('EventSource', FakeEventSource));
afterEach(() => vi.unstubAllGlobals());

describe('Notification API', () => {
  it('uses one stream and forwards only known public fields', () => {
    const receive = vi.fn();
    const onOpen = vi.fn();
    const stop = subscribeNotifications({ onNotification: receive, onOpen });
    expect(source.url).toBe('/api/notifications');
    source.dispatchEvent(new Event('open'));
    source.dispatchEvent(new Event('open'));
    expect(onOpen).toHaveBeenCalledTimes(2);
    source.send(JSON.stringify({
      id: 'message-1', type: 'registration.created', eventId: 2, title: 'Public event',
      registered: 1, spotsLeft: 2, name: 'Private Person', email: 'private@example.com'
    }));
    expect(receive).toHaveBeenCalledWith({
      id: 'message-1', type: 'registration.created', eventId: 2, title: 'Public event', registered: 1, spotsLeft: 2
    });
    stop();
    source.dispatchEvent(new Event('open'));
    expect(onOpen).toHaveBeenCalledTimes(2);
    expect(source.close).toHaveBeenCalledOnce();
  });

  it('ignores malformed JSON, unknown events and invalid counts', () => {
    const receive = vi.fn();
    const stop = subscribeNotifications({ onNotification: receive, onOpen: vi.fn() });
    for (const data of ['{', 'null', '{}', JSON.stringify({
      id: 'message-1', type: 'unknown', eventId: 2, title: 'Public event'
    }), JSON.stringify({
      id: 'message-1', type: 'registration.created', eventId: 2, title: 'Public event', registered: 1, spotsLeft: -1
    })]) source.send(data);
    expect(receive).not.toHaveBeenCalled();
    stop();
  });

  it('closes an offline connection and opens exactly one fresh stream when online', () => {
    const receive = vi.fn();
    const onOpen = vi.fn();
    const stop = subscribeNotifications({ onNotification: receive, onOpen });
    const old = source;
    window.dispatchEvent(new Event('offline'));
    expect(old.close).toHaveBeenCalledOnce();
    old.send(JSON.stringify({ id: 'old', type: 'registration.created', eventId: 2, title: 'Event', registered: 1, spotsLeft: 2 }));
    expect(receive).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('online'));
    expect(source).not.toBe(old);
    const fresh = source;
    window.dispatchEvent(new Event('online'));
    expect(source).toBe(fresh);
    source.dispatchEvent(new Event('open'));
    expect(onOpen).toHaveBeenCalledOnce();
    stop();
    window.dispatchEvent(new Event('online'));
    expect(source).toBe(fresh);
  });
});
