<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AuthShell from '../components/AuthShell.vue';
import PasswordHints from '../components/PasswordHints.vue';
import { api, ApiError } from '../api.ts';
import { useSession } from '../stores/session.ts';

const route = useRoute();
const router = useRouter();
const session = useSession();
const password = ref('');
const error = ref('');
const loading = ref(false);
const token = String(route.query.token ?? '');

async function submit() {
  error.value = '';
  loading.value = true;
  try {
    await api.post('/api/auth/password/reset', { token, password: password.value });
    await session.refresh(); // every session was revoked server-side
    router.push({ path: '/login', query: { reset: '1' } });
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'Network error — try again.';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <AuthShell title="Choose a new password" subtitle="You'll be signed out of every device.">
    <form novalidate @submit.prevent="submit">
      <div v-if="!token" class="form-error">This reset link is missing its token.</div>
      <div v-if="error" class="form-error">{{ error }}</div>
      <div class="field">
        <label for="password">New password</label>
        <input id="password" v-model="password" class="input" type="password" autocomplete="new-password" />
      </div>
      <PasswordHints :password="password" />
      <button class="btn btn-primary btn-block" :disabled="loading || !token || !password">Update password</button>
    </form>
  </AuthShell>
</template>
