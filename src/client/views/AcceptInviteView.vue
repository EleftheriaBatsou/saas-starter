<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AuthShell from '../components/AuthShell.vue';
import Avatar from '../components/Avatar.vue';
import RoleBadge from '../components/RoleBadge.vue';
import PasswordHints from '../components/PasswordHints.vue';
import { api, ApiError } from '../api.ts';
import { useSession } from '../stores/session.ts';
import { toast } from '../toast.ts';
import type { Role } from '../../shared/permissions.ts';

interface Preview {
  orgName: string;
  email: string;
  role: Role;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  accountExists: boolean;
}

const route = useRoute();
const router = useRouter();
const session = useSession();
const token = String(route.params.token);
const preview = ref<Preview | null>(null);
const loadError = ref('');
const busy = ref(false);
const error = ref('');
const form = reactive({ name: '', password: '' });
const fieldErrors = ref<Record<string, string>>({});

const emailMatches = computed(() => session.user && preview.value && session.user.email.toLowerCase() === preview.value.email.toLowerCase());
const STATUS_TEXT = {
  accepted: 'This invitation has already been used.',
  revoked: 'This invitation was revoked by an admin.',
  expired: 'This invitation has expired. Ask an admin to resend it.',
} as const;

onMounted(async () => {
  try {
    preview.value = await api.get<Preview>(`/api/invites/preview?token=${encodeURIComponent(token)}`);
  } catch (e) {
    loadError.value = e instanceof ApiError ? e.message : 'Could not load invitation.';
  }
});

async function accept() {
  busy.value = true;
  error.value = '';
  try {
    await api.post('/api/invites/accept', { token });
    await session.refresh();
    toast(`Welcome to ${preview.value!.orgName}! 🎉`);
    router.push('/projects');
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'Something went wrong.';
  } finally {
    busy.value = false;
  }
}

async function signupAndAccept() {
  busy.value = true;
  error.value = '';
  fieldErrors.value = {};
  try {
    await api.post('/api/auth/signup', { name: form.name, email: preview.value!.email, password: form.password, inviteToken: token });
    await session.refresh();
    toast(`Welcome to ${preview.value!.orgName}! 🎉`);
    router.push('/projects');
  } catch (e) {
    if (e instanceof ApiError) {
      fieldErrors.value = e.fields;
      error.value = Object.keys(e.fields).length ? '' : e.message;
    }
  } finally {
    busy.value = false;
  }
}

async function switchAccount() {
  await session.logout();
}
</script>

<template>
  <AuthShell :title="preview ? `Join ${preview.orgName}` : 'Invitation'">
    <p v-if="loadError" class="form-error">{{ loadError }}</p>
    <div v-else-if="!preview" class="skeleton" style="height: 120px" />
    <template v-else>
      <div class="invite-card">
        <Avatar :name="preview.orgName" :size="52" square />
        <div>
          <strong>{{ preview.orgName }}</strong>
          <div class="row small muted" style="gap: 6px">Invited as <RoleBadge :role="preview.role" /></div>
          <div class="small muted">{{ preview.email }}</div>
        </div>
      </div>

      <div v-if="preview.status !== 'pending'" class="form-error">{{ STATUS_TEXT[preview.status] }}</div>

      <template v-else>
        <div v-if="error" class="form-error">{{ error }}</div>

        <!-- Signed in -->
        <template v-if="session.user">
          <template v-if="emailMatches">
            <button class="btn btn-primary btn-block" :disabled="busy" @click="accept">Accept & join</button>
          </template>
          <template v-else>
            <p class="small" style="margin-bottom: 14px">
              You're signed in as <strong>{{ session.user.email }}</strong>, but this invite is for <strong>{{ preview.email }}</strong>.
            </p>
            <button class="btn btn-outline btn-block" @click="switchAccount">Sign out & switch account</button>
          </template>
        </template>

        <!-- Existing account, signed out -->
        <template v-else-if="preview.accountExists">
          <p class="small muted" style="margin-bottom: 14px">You already have an account — sign in to accept.</p>
          <RouterLink class="btn btn-primary btn-block" :to="{ path: '/login', query: { next: route.fullPath } }">Sign in to accept</RouterLink>
        </template>

        <!-- New user -->
        <form v-else novalidate @submit.prevent="signupAndAccept">
          <div class="field">
            <label>Email</label>
            <input class="input" :value="preview.email" disabled />
          </div>
          <div class="field">
            <label for="name">Your name</label>
            <input id="name" v-model="form.name" class="input" :class="{ invalid: fieldErrors.name }" autocomplete="name" />
            <span v-if="fieldErrors.name" class="field-error">{{ fieldErrors.name }}</span>
          </div>
          <div class="field">
            <label for="password">Choose a password</label>
            <input id="password" v-model="form.password" class="input" :class="{ invalid: fieldErrors.password }" type="password" autocomplete="new-password" />
            <span v-if="fieldErrors.password" class="field-error">{{ fieldErrors.password }}</span>
          </div>
          <PasswordHints :password="form.password" :email="preview.email" :name="form.name" />
          <button class="btn btn-primary btn-block" :disabled="busy">Create account & join</button>
        </form>
      </template>
    </template>
  </AuthShell>
</template>

<style scoped>
.invite-card {
  display: flex; gap: 14px; align-items: center; padding: 16px; border-radius: 14px;
  background: linear-gradient(135deg, #f5f1ff, #eef8ff); margin-bottom: 20px;
}
</style>
