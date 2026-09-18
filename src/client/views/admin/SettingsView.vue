<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import Modal from '../../components/Modal.vue';
import { api, ApiError } from '../../api.ts';
import { useSession } from '../../stores/session.ts';
import { toast } from '../../toast.ts';

interface Member { id: string; name: string; email: string; role: string }

const session = useSession();
const router = useRouter();
const form = reactive({ name: session.activeOrg!.name, slug: session.activeOrg!.slug });
const errors = ref<Record<string, string>>({});
const saving = ref(false);
const dirty = computed(() => form.name !== session.activeOrg!.name || form.slug !== session.activeOrg!.slug);

const members = ref<Member[]>([]);
const transferTo = ref('');
const transferring = ref(false);
const deleting = ref(false);
const confirmText = ref('');
const deleteBusy = ref(false);

onMounted(async () => {
  if (session.can('org:transfer')) {
    members.value = (await api.get<{ members: Member[] }>('/api/members')).members.filter((m) => m.id !== session.user!.id);
  }
});

async function save() {
  saving.value = true;
  errors.value = {};
  try {
    await api.patch('/api/org', form);
    await session.refresh();
    toast('Settings saved');
  } catch (e) {
    if (e instanceof ApiError) errors.value = e.code === 'SLUG_TAKEN' ? { slug: e.message } : { _: e.message, ...e.fields };
  } finally {
    saving.value = false;
  }
}

async function transfer() {
  const target = members.value.find((m) => m.id === transferTo.value);
  if (!target || !confirm(`Make ${target.name} the owner? You'll become an admin.`)) return;
  transferring.value = true;
  try {
    await api.post('/api/org/transfer', { userId: target.id });
    await session.refresh();
    toast(`${target.name} is now the owner`);
    router.push('/admin/members');
  } catch (e) {
    toast(e instanceof ApiError ? e.message : 'Failed', 'error');
  } finally {
    transferring.value = false;
  }
}

async function leave() {
  if (!confirm(`Leave ${session.activeOrg!.name}? You'll lose access immediately.`)) return;
  await api.post('/api/org/leave');
  await session.refresh();
  toast('You left the organisation', 'info');
  router.push(session.activeOrg ? '/projects' : '/welcome');
}

async function destroy() {
  deleteBusy.value = true;
  try {
    const name = session.activeOrg!.name;
    await api.del('/api/org', { confirm: confirmText.value });
    await session.refresh();
    toast(`${name} was deleted`, 'info');
    router.push(session.activeOrg ? '/projects' : '/welcome');
  } catch (e) {
    toast(e instanceof ApiError ? e.message : 'Failed', 'error');
  } finally {
    deleteBusy.value = false;
  }
}
</script>

<template>
  <section class="stack" style="gap: 24px">
    <div class="card section">
      <h3>General</h3>
      <p class="muted small" style="margin: 4px 0 18px">Your organisation's name and URL slug.</p>
      <form novalidate @submit.prevent="save">
        <div v-if="errors._" class="form-error">{{ errors._ }}</div>
        <div class="two">
          <div class="field">
            <label for="s-name">Name</label>
            <input id="s-name" v-model="form.name" class="input" :class="{ invalid: errors.name }" />
            <span v-if="errors.name" class="field-error">{{ errors.name }}</span>
          </div>
          <div class="field">
            <label for="s-slug">Slug</label>
            <input id="s-slug" v-model="form.slug" class="input" :class="{ invalid: errors.slug }" />
            <span v-if="errors.slug" class="field-error">{{ errors.slug }}</span>
          </div>
        </div>
        <button class="btn btn-primary" :disabled="!dirty || saving">Save changes</button>
      </form>
    </div>

    <div v-if="session.can('org:transfer') && members.length" class="card section">
      <h3>Transfer ownership</h3>
      <p class="muted small" style="margin: 4px 0 18px">Hand the organisation to another member. You'll stay on as an admin.</p>
      <div class="row">
        <select v-model="transferTo" class="input" style="max-width: 320px">
          <option value="" disabled>Choose a member…</option>
          <option v-for="m in members" :key="m.id" :value="m.id">{{ m.name }} ({{ m.role }})</option>
        </select>
        <button class="btn btn-outline" :disabled="!transferTo || transferring" @click="transfer">Transfer</button>
      </div>
    </div>

    <div class="card section danger">
      <h3>Danger zone</h3>
      <div v-if="session.role !== 'owner'" class="danger-row">
        <div>
          <strong>Leave organisation</strong>
          <p class="muted small">You'll lose access to all of {{ session.activeOrg!.name }}'s projects.</p>
        </div>
        <button class="btn btn-danger-ghost" @click="leave">Leave</button>
      </div>
      <div v-if="session.can('org:delete')" class="danger-row">
        <div>
          <strong>Delete organisation</strong>
          <p class="muted small">Permanently deletes all projects, members, invites and the audit log.</p>
        </div>
        <button class="btn btn-danger" @click="deleting = true; confirmText = ''">Delete…</button>
      </div>
    </div>

    <Modal v-if="deleting" title="Delete organisation" @close="deleting = false">
      <p style="margin-bottom: 16px">
        This will permanently delete <strong>{{ session.activeOrg!.name }}</strong> and everything in it. This cannot be undone.
      </p>
      <div class="field">
        <label for="confirm">Type <code>{{ session.activeOrg!.slug }}</code> to confirm</label>
        <input id="confirm" v-model="confirmText" class="input" :class="{ valid: confirmText === session.activeOrg!.slug }" autocomplete="off" />
      </div>
      <div class="row">
        <span class="spacer" />
        <button class="btn btn-ghost" @click="deleting = false">Cancel</button>
        <button class="btn btn-danger" :disabled="confirmText !== session.activeOrg!.slug || deleteBusy" @click="destroy">Delete forever</button>
      </div>
    </Modal>
  </section>
</template>

<style scoped>
.section { padding: 24px; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.danger { border: 1.5px solid #ffd3dc; }
.danger h3 { color: #d62f55; margin-bottom: 8px; }
.danger-row { display: flex; align-items: center; gap: 16px; padding: 14px 0; border-top: 1px solid #ffe4ea; }
.danger-row:first-of-type { border-top: 0; }
.danger-row > div { flex: 1; }
code { background: #fff0f3; color: #d62f55; padding: 1px 6px; border-radius: 6px; font-size: 13px; }
@media (max-width: 720px) { .two { grid-template-columns: 1fr; } }
</style>
