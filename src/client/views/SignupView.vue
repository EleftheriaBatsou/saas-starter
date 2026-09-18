<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import AuthShell from '../components/AuthShell.vue';
import PasswordHints from '../components/PasswordHints.vue';
import { api, ApiError } from '../api.ts';
import { useSession } from '../stores/session.ts';

const router = useRouter();
const session = useSession();
const form = reactive({ name: '', email: '', password: '' });
const errors = ref<Record<string, string>>({});
const formError = ref('');
const loading = ref(false);

async function submit() {
  errors.value = {};
  formError.value = '';
  loading.value = true;
  try {
    await api.post('/api/auth/signup', form);
    await session.refresh();
    router.push('/welcome');
  } catch (e) {
    if (e instanceof ApiError) {
      errors.value = e.fields;
      if (e.code === 'EMAIL_TAKEN') errors.value = { email: e.message };
      formError.value = Object.keys(errors.value).length ? '' : e.message;
    } else formError.value = 'Network error — try again.';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <AuthShell title="Create your account" subtitle="Start a workspace for your team in seconds.">
    <form novalidate @submit.prevent="submit">
      <Transition name="fade"><div v-if="formError" class="form-error">{{ formError }}</div></Transition>
      <div class="field">
        <label for="name">Full name</label>
        <input id="name" v-model="form.name" class="input" :class="{ invalid: errors.name }" autocomplete="name" />
        <span v-if="errors.name" class="field-error">{{ errors.name }}</span>
      </div>
      <div class="field">
        <label for="email">Work email</label>
        <input id="email" v-model="form.email" class="input" :class="{ invalid: errors.email }" type="email" autocomplete="email" />
        <span v-if="errors.email" class="field-error">{{ errors.email }}</span>
      </div>
      <div class="field">
        <label for="password">Password</label>
        <input id="password" v-model="form.password" class="input" :class="{ invalid: errors.password }" type="password" autocomplete="new-password" />
        <span v-if="errors.password" class="field-error">{{ errors.password }}</span>
      </div>
      <PasswordHints :password="form.password" :email="form.email" :name="form.name" />
      <button class="btn btn-primary btn-block" :disabled="loading">{{ loading ? 'Creating account…' : 'Create account' }}</button>
    </form>
    <template #below>Already have an account? <RouterLink to="/login">Sign in</RouterLink></template>
  </AuthShell>
</template>
