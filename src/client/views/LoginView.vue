<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AuthShell from '../components/AuthShell.vue';
import Avatar from '../components/Avatar.vue';
import { api, ApiError } from '../api.ts';
import { useSession } from '../stores/session.ts';

const route = useRoute();
const router = useRouter();
const session = useSession();

const form = reactive({ email: '', password: '' });
const errors = ref<Record<string, string>>({});
const formError = ref(
  route.query.expired ? 'Your session ended. Please sign in again.' : route.query.reset ? 'Password updated — sign in with your new password.' : '',
);
const loading = ref(false);
const demo = ref<{ password: string; users: { email: string; name: string }[] } | null>(null);

onMounted(async () => {
  demo.value = await api.get<typeof demo.value>('/api/demo').catch(() => null);
});

async function submit() {
  errors.value = {};
  formError.value = '';
  loading.value = true;
  try {
    await api.post('/api/auth/login', form);
    await session.refresh();
    const next = typeof route.query.next === 'string' && route.query.next.startsWith('/') ? route.query.next : '/projects';
    router.push(session.activeOrg || next.startsWith('/invite/') ? next : '/welcome');
  } catch (e) {
    if (e instanceof ApiError) {
      errors.value = e.fields;
      formError.value = Object.keys(e.fields).length ? '' : e.message;
    } else formError.value = 'Network error — try again.';
  } finally {
    loading.value = false;
  }
}

function quick(email: string) {
  form.email = email;
  form.password = demo.value!.password;
  submit();
}
</script>

<template>
  <AuthShell title="Welcome back" subtitle="Sign in to your workspace.">
    <form novalidate @submit.prevent="submit">
      <Transition name="fade"><div v-if="formError" class="form-error">{{ formError }}</div></Transition>
      <div class="field">
        <label for="email">Email</label>
        <input id="email" v-model="form.email" class="input" :class="{ invalid: errors.email }" type="email" autocomplete="email" required />
        <span v-if="errors.email" class="field-error">{{ errors.email }}</span>
      </div>
      <div class="field">
        <div class="row">
          <label for="password">Password</label>
          <span class="spacer" />
          <RouterLink to="/forgot-password" class="small">Forgot?</RouterLink>
        </div>
        <input id="password" v-model="form.password" class="input" :class="{ invalid: errors.password }" type="password" autocomplete="current-password" required />
        <span v-if="errors.password" class="field-error">{{ errors.password }}</span>
      </div>
      <button class="btn btn-primary btn-block" :disabled="loading">{{ loading ? 'Signing in…' : 'Sign in' }}</button>
    </form>

    <div v-if="demo" class="demo">
      <div class="demo-label">Demo accounts <span class="muted">· one click sign-in</span></div>
      <div class="chips">
        <button v-for="u in demo.users" :key="u.email" class="chip" type="button" :disabled="loading" @click="quick(u.email)">
          <Avatar :name="u.name" :seed="u.email" :size="22" />
          <span>{{ u.name.split(' ')[0] }}</span>
          <span class="org">{{ u.email.split('@')[1]!.split('.')[0] }}</span>
        </button>
      </div>
      <p class="muted small">Alice belongs to both orgs — use her to try the switcher.</p>
    </div>

    <template #below>New here? <RouterLink to="/signup">Create an account</RouterLink></template>
  </AuthShell>
</template>

<style scoped>
.demo { margin-top: 24px; padding-top: 20px; border-top: 1px dashed var(--line); }
.demo-label { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 10px; }
.chips { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
.chip {
  display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px 4px 4px; border-radius: 999px;
  border: 1px solid var(--line); background: #fff; font: 600 13px var(--font); color: var(--ink); cursor: pointer;
  transition: transform 0.3s var(--spring), border-color 0.15s, box-shadow 0.2s;
}
.chip:hover:not(:disabled) { transform: translateY(-2px); border-color: #cfc3ff; box-shadow: var(--shadow-2); }
.org { color: var(--ink-3); font-size: 11px; font-weight: 700; text-transform: uppercase; }
</style>
