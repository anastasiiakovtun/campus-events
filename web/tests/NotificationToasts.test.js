import { mount, RouterLinkStub } from '@vue/test-utils';
import { nextTick } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NotificationToasts from '../src/components/NotificationToasts.vue';
import { subscribeNotifications } from '../src/api/events.js';
import { liveRevision } from '../src/composables/useLiveRefresh.js';

vi.mock('../src/api/events.js', () => ({ subscribeNotifications: vi.fn() }));
let handlers;
let wrapper;
let stop;
const notification = {
  id: 'message-1', type: 'registration.created', eventId: 3, title: 'Hack Night', registered: 1, spotsLeft: 2
};

beforeEach(() => {
  vi.useFakeTimers();
  liveRevision.value = 0;
  stop = vi.fn();
  vi.mocked(subscribeNotifications).mockImplementation((callbacks) => { handlers = callbacks; return stop; });
  wrapper = mount(NotificationToasts, { global: { stubs: { RouterLink: RouterLinkStub } } });
});
afterEach(() => { wrapper.unmount(); vi.useRealTimers(); vi.clearAllMocks(); });

describe('Notification toasts', () => {
  it('shows one anonymous toast for repeated deliveries of the same message', async () => {
    handlers.onNotification(notification);
    handlers.onNotification(notification);
    await nextTick();
    expect(wrapper.findAll('.notification')).toHaveLength(1);
    expect(wrapper.text()).toContain('Someone registered for Hack Night. 2 seats left.');
    expect(wrapper.findComponent(RouterLinkStub).props('to')).toBe('/events/3');
    expect(liveRevision.value).toBe(1);
    await wrapper.find('button').trigger('click');
    handlers.onNotification(notification);
    await nextTick();
    expect(wrapper.findAll('.notification')).toHaveLength(0);
    expect(liveRevision.value).toBe(1);
  });

  it('refreshes on initial connection and reconnection without showing a toast', async () => {
    handlers.onOpen();
    handlers.onOpen();
    await nextTick();
    expect(liveRevision.value).toBe(2);
    expect(wrapper.findAll('.notification')).toHaveLength(0);
    expect(subscribeNotifications).toHaveBeenCalledOnce();
  });

  it('shows event details as escaped text and limits/dismisses the toast stack', async () => {
    for (let index = 0; index < 5; index += 1) handlers.onNotification({
      id: `event-${index}`, type: 'event.created', eventId: index + 1,
      title: '<img src=x onerror=alert(1)>', startsAt: '2030-01-01T12:00:00Z'
    });
    await nextTick();
    expect(wrapper.findAll('.notification')).toHaveLength(4);
    expect(wrapper.text()).toContain('New event');
    expect(wrapper.find('img').exists()).toBe(false);
    vi.advanceTimersByTime(8000);
    await nextTick();
    expect(wrapper.findAll('.notification')).toHaveLength(0);
  });

  it('closes its stream and cancels timers on unmount', () => {
    handlers.onNotification(notification);
    wrapper.unmount();
    expect(stop).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
