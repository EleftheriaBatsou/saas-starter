<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import Avatar from '../components/Avatar.vue';
import { api, ApiError } from '../api.ts';
import { useSession } from '../stores/session.ts';
import { toast } from '../toast.ts';

const router = useRouter();
const session = useSession();
const form = reactive({ name: '', slug: '' });
const slugTouched = ref(false);
const errors = ref<Record<string, string>>({});
const loading = ref(false);

function slugify(s: string) {
  return s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}
watch(() => form.name, (n) => { if (!slugTouched.value) form.slug = slugify(n); });

async function submit() {
  errors.value = {};
  loading.value = true;
  try {
    await api.post('/api/orgs', form);
    await session.refresh();
    toast(`${form.name} is ready 🚀`);
    router.push('/projects');
  } catch (e) {
    if (e instanceof ApiError) errors.value = e.code === 'SLUG_TAKEN' ? { slug: e.message } : { _: e.message, ...e.fields };
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="page">
    <div class="wrap">
      <div class="card box">
        <div class="preview">
          <Avatar :name="form.name || 'New Org'" :seed="form.slug || 'x'" :size="64" square />
        </div>
        <h1>{{ session.orgs.length ? 'Create another organisation' : `Welcome, ${session.user?.name.split(' ')[0]}! 👋` }}</h1>
        <p class="muted" style="margin: 6px 0 24px">
          Organisations keep your team's projects and people completely separate from everyone else's.
        </p>
        <form novalidate @submit.prevent="submit">
          <div v-if="errors._" class="form-error">{{ errors._ }}</div>
          <div class="field">
            <label for="org-name">Organisation name</label>
            <input id="org-name" v-model="form.name" class="input" :class="{ invalid: errors.name }" placeholder="Acme Inc." />
            <span v-if="errors.name" class="field-error">{{ errors.name }}</span>
          </div>
          <div class="field">
            <label for="org-slug">URL slug</label>
            <input id="org-slug" v-model="form.slug" class="input" :class="{ invalid: errors.slug }" @input="slugTouched = true" />
            <span v-if="errors.slug" class="field-error">{{ errors.slug }}</span>
            <span v-else class="field-hint">Lowercase letters, digits and dashes.</span>
          </div>
          <button class="btn btn-primary btn-block" :disabled="loading || !form.name">Create organisation</button>
        </form>
        <p v-if="!session.orgs.length" class="muted small" style="margin-top: 18px; text-align: center">
          Waiting for an invite instead? Open the link from your email.
        </p>
        <p v-else style="margin-top: 18px; text-align: center"><RouterLink to="/projects">← Back to {{ session.activeOrg?.name }}</RouterLink></p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wrap { display: flex; justify-content: center; padding-top: 40px; }
.box { width: 100%; max-width: 460px; padding: 32px; text-align: left; }
.preview { margin-bottom: 18px; animation: wiggle 2.4s ease-in-out infinite; display: inline-block; }
@keyframes wiggle { 50% { transform: rotate(-5deg) scale(1.04); } }
</style>
