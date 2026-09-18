<script setup lang="ts">
import { ref } from 'vue';
import { api, ApiError } from '../api.ts';
import { toast } from '../toast.ts';

const sending = ref(false);
async function resend() {
  sending.value = true;
  try {
    await api.post('/api/auth/resend-verification');
    toast('Verification email sent — check your inbox.');
  } catch (e) {
    toast(e instanceof ApiError ? e.message : 'Could not send email.', 'error');
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <div class="banner">
    <span>📬 Please verify your email address to invite teammates.</span>
    <button class="btn btn-sm btn-outline" :disabled="sending" @click="resend">Resend email</button>
  </div>
</template>

<style scoped>
.banner {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 8px 16px;
  background: linear-gradient(90deg, #fff7dc, #fff1c4);
  color: #7a5200;
  font-weight: 600;
  font-size: 13.5px;
  flex-wrap: wrap;
}
</style>
