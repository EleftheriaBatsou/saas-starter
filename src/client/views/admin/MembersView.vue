<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import Avatar from '../../components/Avatar.vue';
import RoleBadge from '../../components/RoleBadge.vue';
import StatusPill from '../../components/StatusPill.vue';
import InviteModal from '../../components/InviteModal.vue';
import { api, ApiError } from '../../api.ts';
import { useSession } from '../../stores/session.ts';
import { toast } from '../../toast.ts';
import { assignableRoles, canActOnMember, type Role } from '../../../shared/permissions.ts';

interface Member { id: string; name: string; email: string; role: Role; joinedAt: string }

const session = useSession();
const router = useRouter();
const members = ref<Member[] | null>(null);
const inviting = ref(false);
const busy = ref<string | null>(null);

async function load() {
  members.value = (await api.get<{ members: Member[] }>('/api/members')).members;
}
onMounted(load);

const canEdit = (m: Member) => canActOnMember(session.role!, session.user!.id, m.role, m.id);

async function changeRole(m: Member, role: Role) {
  busy.value = m.id;
  try {
    await api.patch(`/api/members/${m.id}`, { role });
    m.role = role;
    toast(`${m.name} is now ${role === 'admin' ? 'an admin' : 'a member'}`);
  } catch (e) {
    toast(e instanceof ApiError ? e.message : 'Failed', 'error');
    await load();
  } finally {
    busy.value = null;
  }
}

async function remove(m: Member) {
  if (!confirm(`Remove ${m.name} from ${session.activeOrg!.name}? They lose access immediately.`)) return;
  busy.value = m.id;
  try {
    await api.del(`/api/members/${m.id}`);
    members.value = members.value!.filter((x) => x.id !== m.id);
    toast(`${m.name} was removed`, 'info');
  } catch (e) {
    toast(e instanceof ApiError ? e.message : 'Failed', 'error');
  } finally {
    busy.value = null;
  }
}

async function leave() {
  if (!confirm(`Leave ${session.activeOrg!.name}? You'll lose access immediately.`)) return;
  await api.post('/api/org/leave');
  await session.refresh();
  toast('You left the organisation', 'info');
  router.push(session.activeOrg ? '/projects' : '/welcome');
}

const fmt = (d: string) => new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
</script>

<template>
  <section>
    <div class="row" style="margin-bottom: 16px">
      <h2>Members <span class="muted" style="font-weight: 600">{{ members?.length ?? '' }}</span></h2>
      <span class="spacer" />
      <button v-if="session.can('invite:manage')" class="btn btn-primary" @click="inviting = true">Invite people</button>
    </div>

    <div class="card" style="overflow: hidden">
      <table class="table">
        <thead>
          <tr><th>Name</th><th class="hide-sm">Status</th><th>Role</th><th class="hide-sm">Joined</th><th /></tr>
        </thead>
        <TransitionGroup v-if="members" tag="tbody" name="list">
          <tr v-for="m in members" :key="m.id">
            <td>
              <div class="row" style="gap: 12px">
                <Avatar :name="m.name" :seed="m.id" :size="36" />
                <div style="min-width: 0">
                  <div style="font-weight: 700">{{ m.name }} <span v-if="m.id === session.user!.id" class="you">you</span></div>
                  <div class="muted small">{{ m.email }}</div>
                </div>
              </div>
            </td>
            <td class="hide-sm"><StatusPill status="active" /></td>
            <td>
              <select
                v-if="canEdit(m)"
                class="role-select"
                :class="`role-${m.role}`"
                :value="m.role"
                :disabled="busy === m.id"
                @change="changeRole(m, ($event.target as HTMLSelectElement).value as Role)"
              >
                <option v-for="r in assignableRoles(session.role!)" :key="r" :value="r">{{ r }}</option>
              </select>
              <RoleBadge v-else :role="m.role" />
            </td>
            <td class="hide-sm muted small">{{ fmt(m.joinedAt) }}</td>
            <td style="text-align: right">
              <button v-if="canEdit(m)" class="btn btn-danger-ghost btn-sm" :disabled="busy === m.id" @click="remove(m)">Remove</button>
            </td>
          </tr>
        </TransitionGroup>
        <tbody v-else>
          <tr v-for="i in 3" :key="i"><td colspan="5"><div class="skeleton" style="height: 36px" /></td></tr>
        </tbody>
      </table>
    </div>

    <p v-if="session.role !== 'owner'" class="leave muted small">
      Want out? <button class="linklike" @click="leave">Leave {{ session.activeOrg!.name }}</button>
    </p>

    <InviteModal v-if="inviting" @close="inviting = false" @sent="load" />
  </section>
</template>

<style scoped>
.leave { margin-top: 16px; text-align: center; }
.linklike { border: 0; background: none; color: #d62f55; font: 700 13px var(--font); cursor: pointer; padding: 0; }
.linklike:hover { text-decoration: underline; }
.you { font-size: 11px; font-weight: 700; color: var(--accent); background: var(--accent-50); padding: 1px 7px; border-radius: 999px; margin-left: 4px; }
.role-select {
  appearance: none; border: 0; height: 26px; border-radius: 999px; padding: 0 26px 0 12px; font: 700 12px var(--font);
  text-transform: capitalize; cursor: pointer;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%238A89A6' stroke-width='3'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat; background-position: right 10px center;
  transition: transform 0.25s var(--spring);
}
.role-select:hover { transform: scale(1.04); }
.role-select.role-admin { background-color: rgba(13, 153, 255, 0.12); color: #0a7fd6; }
.role-select.role-member { background-color: rgba(21, 215, 196, 0.15); color: #0d9d8f; }
</style>
