<script setup>
import { ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { getEvent, getRegistrations } from '../api/events.js';
import ErrorMessage from '../components/ErrorMessage.vue';
import RegistrationForm from '../components/RegistrationForm.vue';
import SeatMeter from '../components/SeatMeter.vue';
import { formatFullDate, formatTime, isPast } from '../utils/format.js';
import { useLiveRefresh } from '../composables/useLiveRefresh.js';

const props = defineProps({
  id: { type: String, required: true }
});

const event = ref(null);
const registrations = ref([]);
const error = ref(null);

async function load() {
  try {
    [event.value, registrations.value] = await Promise.all([getEvent(props.id), getRegistrations(props.id)]);
    error.value = null;
  } catch (err) {
    error.value = err;
  }
}

const refresh = useLiveRefresh(load);
watch(() => props.id, refresh);
</script>

<template>
  <RouterLink to="/" class="back-link">All events</RouterLink>
  <ErrorMessage :error="error" />

  <article v-if="event" class="detail">
    <div class="detail__main">
      <h1 class="page-title">{{ event.title }}</h1>
      <p class="detail__when">{{ formatFullDate(event.startsAt) }} at {{ formatTime(event.startsAt) }}</p>
      <p class="detail__where">{{ event.location }}</p>
      <p v-if="event.description" class="detail__description">{{ event.description }}</p>

      <h2 class="section-title">Who's coming</h2>
      <ul v-if="registrations.length" class="people">
        <li v-for="registration in registrations" :key="registration.id">{{ registration.name }}</li>
      </ul>
      <p v-else class="muted">Nobody yet. Be the first.</p>
    </div>

    <aside class="detail__side">
      <SeatMeter :capacity="event.capacity" :registered="event.registered" />
      <p v-if="isPast(event.startsAt)" class="muted">This event has already taken place.</p>
      <RegistrationForm v-else :event-id="event.id" @registered="refresh" />
    </aside>
  </article>
</template>
