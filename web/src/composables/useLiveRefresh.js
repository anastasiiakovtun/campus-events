import { onMounted, onUnmounted, ref, watch } from 'vue';

// The app owns one stream. Every mounted data view can refresh from the REST
// source of truth after a notification or a newly opened/reconnected stream.
export const liveRevision = ref(0);

export function useLiveRefresh(load) {
  let active = true;
  let running = false;
  let pending = false;
  async function refresh() {
    if (!active) return;
    pending = true;
    if (running) return;
    running = true;
    try {
      // Coalesce bursts and finish with a fresh read, never an older overlapping response.
      while (active && pending) {
        pending = false;
        await load();
      }
    } finally {
      running = false;
    }
  }
  onMounted(refresh);
  watch(liveRevision, refresh);
  onUnmounted(() => { active = false; });
  return refresh;
}
