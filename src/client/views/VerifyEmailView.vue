<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import AuthShell from '../components/AuthShell.vue';
import { api, ApiError } from '../api.ts';
import { useSession } from '../stores/session.ts';

const route = useRoute();
const session = useSession();
const state = ref<'working' | 'ok' | 'error'>('working');
const message = ref('');

onMounted(async () => {
  try {
    await api.post('/api/auth/verify-email', { token: String(route.query.token ?? '') });
    state.value = 'ok';
    await session.refresh();
  } catch (e) {
    state.value = 'error';
    message.value = e instanceof ApiError ? e.message : 'Something went wrong.';
  }
});
</script>

<template>
  <AuthShell :title="state === 'ok' ? 'Email verified 🎉' : state === 'error' ? 'Link not valid' : 'Verifying…'">
    <p v-if="state === 'ok'" class="muted">Thanks! Your address is confirmed.</p>
    <p v-else-if="state === 'error'" class="muted">{{ message }}</p>
    <div style="margin-top: 20px">
      <RouterLink class="btn btn-primary btn-block" :to="session.user ? '/projects' : '/login'">Continue</RouterLink>
    </div>
  </AuthShell>
</template>
