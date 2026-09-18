<script setup lang="ts">
import { onMounted, ref } from 'vue';
import Avatar from '../../components/Avatar.vue';
import RoleBadge from '../../components/RoleBadge.vue';
import StatusPill from '../../components/StatusPill.vue';
import InviteModal from '../../components/InviteModal.vue';
import { api, ApiError } from '../../api.ts';
import { toast } from '../../toast.ts';
import type { Role } from '../../../shared/permissions.ts';

interface Invitation {
  id: string;
  email: string;
  role: Role;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  expiresAt: string;
  createdAt: string;
  invitedBy: string | null;
}

const invites = ref<Invitation[] | null>(null);
const inviting = ref(false);
const busy = ref<string | null>(null);

async function load() {
  invites.value = (await api.get<{ invitations: Invitation[] }>('/api/invitations')).invitations;
}
onMounted(load);

async function resend(i: Invitation) {
  busy.value = i.id;
  try {
    const r = await api.post<{ devInviteUrl?: string }>(`/api/invitations/${i.id}/resend`);
    if (r.devInviteUrl) console.info('Invite link:', r.devInviteUrl);
    toast(`Invite re-sent to ${i.email}`);
    await load();
  } catch (e) {
    toast(e instanceof ApiError ? e.message : 'Failed', 'error');
  } finally {
    busy.value = null;
  }
}

async function revoke(i: Invitation) {
  busy.value = i.id;
  try {
    await api.post(`/api/invitations/${i.id}/revoke`);
    i.status = 'revoked';
    toast(`Invite for ${i.email} revoked`, 'info');
  } catch (e) {
    toast(e instanceof ApiError ? e.message : 'Failed', 'error');
  } finally {
    busy.value = null;
  }
}

const LABEL = { pending: 'Pending invite', accepted: 'Accepted', revoked: 'Revoked', expired: 'Expired' } as const;
function when(i: Invitation) {
  const d = new Date(i.expiresAt);
  const days = Math.round((d.getTime() - Date.now()) / 86_400_000);
  if (i.status === 'pending') return days <= 0 ? 'expires today' : `expires in ${days}d`;
  return `sent ${new Date(i.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}
</script>

<template>
  <section>
    <div class="row" style="margin-bottom: 16px">
      <h2>Invitations</h2>
      <span class="spacer" />
      <button class="btn btn-primary" @click="inviting = true">Invite people</button>
    </div>
    <div class="card" style="overflow: hidden">
      <table class="table">
        <thead><tr><th>Email</th><th>Role</th><th>Status</th><th class="hide-sm">Invited by</th><th /></tr></thead>
        <TransitionGroup v-if="invites && invites.length" tag="tbody" name="list">
          <tr v-for="i in invites" :key="i.id">
            <td>
              <div class="row" style="gap: 10px">
                <Avatar :name="i.email" :size="30" />
                <div>
                  <div style="font-weight: 700">{{ i.email }}</div>
                  <div class="muted small">{{ when(i) }}</div>
                </div>
              </div>
            </td>
            <td><RoleBadge :role="i.role" /></td>
            <td><StatusPill :status="i.status" :label="LABEL[i.status]" /></td>
            <td class="hide-sm muted small">{{ i.invitedBy ?? '—' }}</td>
            <td style="text-align: right; white-space: nowrap">
              <template v-if="i.status === 'pending' || i.status === 'expired'">
                <button class="btn btn-ghost btn-sm" :disabled="busy === i.id" @click="resend(i)">Resend</button>
                <button class="btn btn-danger-ghost btn-sm" :disabled="busy === i.id" @click="revoke(i)">Revoke</button>
              </template>
            </td>
          </tr>
        </TransitionGroup>
        <tbody v-else-if="invites">
          <tr><td colspan="5" class="muted" style="text-align: center; padding: 32px">No invitations yet.</td></tr>
        </tbody>
        <tbody v-else>
          <tr v-for="n in 3" :key="n"><td colspan="5"><div class="skeleton" style="height: 30px" /></td></tr>
        </tbody>
      </table>
    </div>
    <InviteModal v-if="inviting" @close="inviting = false" @sent="load" />
  </section>
</template>
