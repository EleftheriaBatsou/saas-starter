<script setup lang="ts">
import { computed, ref } from 'vue';
import Modal from './Modal.vue';
import { api, ApiError } from '../api.ts';
import { useSession } from '../stores/session.ts';
import { assignableRoles, type Role } from '../../shared/permissions.ts';

const emit = defineEmits<{ close: []; sent: [] }>();
const session = useSession();
const email = ref('');
const role = ref<Role>('member');
const error = ref('');
const fieldError = ref('');
const sending = ref(false);
const sent = ref<{ email: string; devInviteUrl?: string } | null>(null);
const copied = ref(false);
const roles = computed(() => assignableRoles(session.role!));
const emailLooksValid = computed(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value));

const ROLE_HELP: Record<string, string> = {
  admin: 'Can manage members, invites and settings.',
  member: 'Can use the app; cannot manage people.',
};

async function submit() {
  error.value = '';
  fieldError.value = '';
  sending.value = true;
  try {
    const r = await api.post<{ devInviteUrl?: string }>('/api/invitations', { email: email.value, role: role.value });
    sent.value = { email: email.value, devInviteUrl: r.devInviteUrl };
    emit('sent');
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.fields.email) fieldError.value = e.fields.email;
      else error.value = e.message;
    }
  } finally {
    sending.value = false;
  }
}

function again() {
  sent.value = null;
  email.value = '';
  copied.value = false;
}
async function copy() {
  await navigator.clipboard.writeText(sent.value!.devInviteUrl!);
  copied.value = true;
}
</script>

<template>
  <Modal title="Invite a teammate" @close="emit('close')">
    <Transition name="fade" mode="out-in">
      <!-- Sent state: paper plane takes off + confetti -->
      <div v-if="sent" key="sent" class="sent">
        <div class="stage">
          <span v-for="i in 18" :key="i" class="confetti" :style="{ '--i': i }" />
          <div class="plane">
            <svg width="56" height="56" viewBox="0 0 24 24" fill="none">
              <path d="M22 2 11 13" stroke="#7C5CFF" stroke-width="2" stroke-linecap="round" />
              <path d="M22 2 15 22l-4-9-9-4 20-7z" fill="#7C5CFF" fill-opacity=".15" stroke="#7C5CFF" stroke-width="2" stroke-linejoin="round" />
            </svg>
          </div>
          <div class="check">✓</div>
        </div>
        <h3>Invite sent!</h3>
        <p class="muted">We emailed <strong>{{ sent.email }}</strong> a link that expires in 7 days.</p>
        <div v-if="sent.devInviteUrl" class="devlink">
          <span class="small muted">Dev mode — invite link:</span>
          <div class="row">
            <input class="input" :value="sent.devInviteUrl" readonly @focus="($event.target as HTMLInputElement).select()" />
            <button class="btn btn-soft btn-sm" type="button" @click="copy">{{ copied ? 'Copied' : 'Copy' }}</button>
          </div>
        </div>
        <div class="row" style="justify-content: center; margin-top: 18px">
          <button class="btn btn-ghost" @click="emit('close')">Done</button>
          <button class="btn btn-primary" @click="again">Invite another</button>
        </div>
      </div>

      <form v-else key="form" novalidate @submit.prevent="submit">
        <div v-if="error" class="form-error">{{ error }}</div>
        <div class="field">
          <label for="inv-email">Email address</label>
          <input
            id="inv-email"
            v-model="email"
            class="input"
            :class="{ invalid: fieldError, valid: emailLooksValid && !fieldError }"
            type="email"
            placeholder="teammate@company.com"
            autofocus
            @input="fieldError = ''"
          />
          <span v-if="fieldError" class="field-error">{{ fieldError }}</span>
        </div>
        <div class="field">
          <label>Role</label>
          <div class="roles">
            <label v-for="r in roles" :key="r" class="role-opt" :class="[`opt-${r}`, { on: role === r }]">
              <input v-model="role" type="radio" :value="r" />
              <span class="role-name">{{ r }}</span>
              <span class="small muted">{{ ROLE_HELP[r] }}</span>
            </label>
          </div>
        </div>
        <div class="row">
          <span class="spacer" />
          <button type="button" class="btn btn-ghost" @click="emit('close')">Cancel</button>
          <button class="btn btn-primary" :disabled="sending || !email">{{ sending ? 'Sending…' : 'Send invite' }}</button>
        </div>
      </form>
    </Transition>
  </Modal>
</template>

<style scoped>
.roles { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.role-opt {
  display: flex; flex-direction: column; gap: 4px; padding: 12px 14px; border-radius: 12px; border: 1.5px solid var(--line);
  cursor: pointer; transition: all 0.3s var(--spring);
}
.role-opt input { position: absolute; opacity: 0; pointer-events: none; }
.role-opt:hover { transform: translateY(-2px); }
.role-name { font-weight: 800; text-transform: capitalize; font-size: 14px; }
.opt-admin.on { border-color: var(--admin); background: rgba(13, 153, 255, 0.06); box-shadow: 0 0 0 3px rgba(13, 153, 255, 0.12); }
.opt-admin .role-name { color: #0a7fd6; }
.opt-member.on { border-color: var(--member); background: rgba(21, 215, 196, 0.07); box-shadow: 0 0 0 3px rgba(21, 215, 196, 0.15); }
.opt-member .role-name { color: #0d9d8f; }

.sent { text-align: center; padding: 4px 0; }
.stage { position: relative; height: 120px; display: flex; align-items: center; justify-content: center; }
.plane { animation: takeoff 1.3s cubic-bezier(0.55, 0, 0.3, 1) forwards; }
@keyframes takeoff {
  0% { transform: translate(0, 0) scale(0.6) rotate(0); opacity: 0; }
  20% { transform: translate(0, 0) scale(1.1) rotate(-8deg); opacity: 1; }
  45% { transform: translate(-10px, 6px) scale(1) rotate(-4deg); }
  100% { transform: translate(180px, -120px) scale(0.4) rotate(12deg); opacity: 0; }
}
.check {
  position: absolute; width: 64px; height: 64px; border-radius: 50%; background: var(--active); color: #fff;
  display: flex; align-items: center; justify-content: center; font-size: 30px; font-weight: 800;
  box-shadow: 0 10px 24px -8px rgba(43, 217, 104, 0.8);
  transform: scale(0); animation: popcheck 0.6s var(--spring) 1s forwards;
}
@keyframes popcheck { to { transform: scale(1); } }
.confetti {
  position: absolute; top: 50%; left: 50%; width: 8px; height: 12px; border-radius: 3px; opacity: 0;
  background: hsl(calc(var(--i) * 47), 90%, 62%);
  animation: burst 1.1s cubic-bezier(0.2, 0.8, 0.3, 1) 1s forwards;
  --a: calc(var(--i) * 20deg);
}
@keyframes burst {
  0% { opacity: 1; transform: rotate(var(--a)) translateY(0) scale(1); }
  100% { opacity: 0; transform: rotate(var(--a)) translateY(-78px) rotate(200deg) scale(0.6); }
}
.devlink { margin-top: 16px; text-align: left; background: var(--chrome); padding: 12px; border-radius: 12px; }
.devlink .input { height: 34px; font-size: 12px; }
</style>
