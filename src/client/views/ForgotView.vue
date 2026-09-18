<script setup lang="ts">
import { ref } from 'vue';
import AuthShell from '../components/AuthShell.vue';
import { api, ApiError } from '../api.ts';

const email = ref('');
const sent = ref(false);
const error = ref('');
const loading = ref(false);

async function submit() {
  error.value = '';
  loading.value = true;
  try {
    await api.post('/api/auth/password/forgot', { email: email.value });
    sent.value = true;
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'Network error — try again.';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <AuthShell title="Reset your password" :subtitle="sent ? undefined : `We'll email you a link to choose a new one.`">
    <Transition name="fade" mode="out-in">
      <div v-if="sent" class="done">
        <div class="icon">✉️</div>
        <p>If an account exists for <strong>{{ email }}</strong>, a reset link is on its way. It expires in one hour.</p>
      </div>
      <form v-else novalidate @submit.prevent="submit">
        <div v-if="error" class="form-error">{{ error }}</div>
        <div class="field">
          <label for="email">Email</label>
          <input id="email" v-model="email" class="input" type="email" autocomplete="email" />
        </div>
        <button class="btn btn-primary btn-block" :disabled="loading || !email">Send reset link</button>
      </form>
    </Transition>
    <template #below><RouterLink to="/login">Back to sign in</RouterLink></template>
  </AuthShell>
</template>

<style scoped>
.done { text-align: center; padding: 8px 0; }
.icon { font-size: 44px; margin-bottom: 12px; animation: bob 1.6s ease-in-out infinite; }
@keyframes bob { 50% { transform: translateY(-6px) rotate(-6deg); } }
</style>
