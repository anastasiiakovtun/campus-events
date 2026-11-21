<script setup>
import { onMounted, onUnmounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { subscribeNotifications } from '../api/events.js';
import { liveRevision } from '../composables/useLiveRefresh.js';
import { formatFullDate } from '../utils/format.js';

const toasts = ref([]);
const seen = new Set();
const timers = new Map();
let stop;

function dismiss(id) {
  clearTimeout(timers.get(id));
  timers.delete(id);
  toasts.value = toasts.value.filter((toast) => toast.id !== id);
}

function receive(notification) {
  if (seen.has(notification.id)) return;
  seen.add(notification.id);
  if (seen.size > 1000) seen.delete(seen.values().next().value);
  liveRevision.value += 1;
  if (toasts.value.length === 4) dismiss(toasts.value[0].id);
  toasts.value.push(notification);
  timers.set(notification.id, setTimeout(() => dismiss(notification.id), 8000));
}

onMounted(() => {
  stop = subscribeNotifications({
    onNotification: receive,
    onOpen: () => { liveRevision.value += 1; }
  });
});

onUnmounted(() => {
  stop?.();
  for (const timer of timers.values()) clearTimeout(timer);
});
</script>

<template>
  <aside class="notifications" aria-label="Campus updates">
    <ol class="notifications__list" aria-live="polite" aria-relevant="additions">
      <li v-for="toast in toasts" :key="toast.id" class="notification">
        <strong>{{ toast.type === 'event.created' ? 'New event' : 'New registration' }}</strong>
        <p v-if="toast.type === 'event.created'">{{ toast.title }} — {{ formatFullDate(toast.startsAt) }}</p>
        <p v-else>Someone registered for {{ toast.title }}. {{ toast.spotsLeft }} seats left.</p>
        <RouterLink :to="`/events/${toast.eventId}`">View event</RouterLink>
        <button type="button" class="notification__dismiss" aria-label="Dismiss notification" @click="dismiss(toast.id)">×</button>
      </li>
    </ol>
  </aside>
</template>
