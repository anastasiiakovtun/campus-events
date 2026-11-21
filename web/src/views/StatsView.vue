<script setup>
import { ref } from 'vue';
import { RouterLink } from 'vue-router';
import { getStats } from '../api/events.js';
import ErrorMessage from '../components/ErrorMessage.vue';
import { useLiveRefresh } from '../composables/useLiveRefresh.js';

const stats = ref([]);
const error = ref(null);

useLiveRefresh(async () => {
  try {
    stats.value = await getStats();
    error.value = null;
  } catch (err) {
    error.value = err;
  }
});
</script>

<template>
  <h1 class="page-title">Occupancy</h1>
  <ErrorMessage :error="error" />

  <div v-if="stats.length" class="table-wrap">
    <table class="table">
      <thead>
        <tr><th scope="col">Event</th><th scope="col">Registered</th><th scope="col">Occupancy</th><th scope="col">Status</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in stats" :key="row.id">
          <td><RouterLink :to="`/events/${row.id}`">{{ row.title }}</RouterLink></td>
          <td>{{ row.registered }} / {{ row.capacity }}</td>
          <td>{{ row.occupancy }}</td>
          <td><span class="status" :class="`status--${row.status}`">{{ row.status }}</span></td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
