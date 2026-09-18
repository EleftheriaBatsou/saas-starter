<script setup lang="ts">
import { onMounted, ref } from 'vue';
import Avatar from '../../components/Avatar.vue';
import { api } from '../../api.ts';

interface Entry {
  id: string;
  action: string;
  target: string | null;
  metadata: Record<string, unknown>;
  ts: string;
  actorName: string | null;
  actorEmail: string | null;
}

const entries = ref<Entry[]>([]);
const cursor = ref<string | null>(null);
const loading = ref(true);

async function load(more = false) {
  loading.value = true;
  const q = more && cursor.value ? `?before=${cursor.value}` : '';
  const r = await api.get<{ entries: Entry[]; nextCursor: string | null }>(`/api/audit${q}`);
  entries.value = more ? [...entries.value, ...r.entries] : r.entries;
  cursor.value = r.nextCursor;
  loading.value = false;
}
onMounted(() => load());

const META: Record<string, { icon: string; color: string; verb: string }> = {
  'org.created': { icon: '✦', color: '#7C5CFF', verb: 'created the organisation' },
  'org.updated': { icon: '✎', color: '#7C5CFF', verb: 'updated settings' },
  'org.ownership_transferred': { icon: '♛', color: '#7C5CFF', verb: 'transferred ownership to' },
  'member.joined': { icon: '→', color: '#2BD968', verb: 'joined' },
  'member.role_changed': { icon: '⇅', color: '#0D99FF', verb: 'changed the role of' },
  'member.removed': { icon: '✕', color: '#FF5C7C', verb: 'removed' },
  'member.left': { icon: '←', color: '#FF5C7C', verb: 'left the organisation' },
  'invite.created': { icon: '✉', color: '#FFC93C', verb: 'invited' },
  'invite.resent': { icon: '↻', color: '#FFC93C', verb: 're-sent an invite to' },
  'invite.revoked': { icon: '⊘', color: '#FF5C7C', verb: 'revoked the invite for' },
  'invite.accepted': { icon: '✓', color: '#2BD968', verb: 'accepted an invite' },
  'project.created': { icon: '+', color: '#15D7C4', verb: 'created project' },
  'project.updated': { icon: '✎', color: '#15D7C4', verb: 'updated project' },
  'project.deleted': { icon: '🗑', color: '#FF5C7C', verb: 'deleted project' },
};

function detail(e: Entry): string {
  const m = e.metadata;
  if (e.action === 'member.role_changed') return `${m.from} → ${m.to}`;
  if (e.action === 'invite.created' || e.action === 'invite.accepted') return m.role ? `as ${m.role}` : '';
  if (e.action === 'org.updated') {
    return Object.entries(m)
      .map(([k, v]) => `${k}: ${(v as { from: string }).from} → ${(v as { to: string }).to}`)
      .join(', ');
  }
  if (e.action === 'project.updated') return Object.keys(m).join(', ');
  return '';
}
const showTarget = (a: string) => !['org.created', 'member.left', 'invite.accepted', 'member.joined', 'org.updated'].includes(a);

function ago(ts: string) {
  const s = (Date.now() - new Date(ts).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(ts).toLocaleDateString();
}
</script>

<template>
  <section>
    <div class="row" style="margin-bottom: 16px">
      <h2>Audit log</h2>
      <span class="spacer" />
      <span class="muted small">Append-only · who did what, when</span>
    </div>
    <div class="card list">
      <TransitionGroup name="list">
        <div v-for="e in entries" :key="e.id" class="entry">
          <span class="icon" :style="{ background: `${META[e.action]?.color ?? '#8A89A6'}1f`, color: META[e.action]?.color ?? '#8A89A6' }">
            {{ META[e.action]?.icon ?? '•' }}
          </span>
          <Avatar :name="e.actorName ?? 'Former member'" :seed="e.actorEmail ?? 'x'" :size="28" />
          <div class="text">
            <strong>{{ e.actorName ?? 'Former member' }}</strong>
            {{ META[e.action]?.verb ?? e.action }}
            <strong v-if="e.target && showTarget(e.action)">{{ e.target }}</strong>
            <span v-if="detail(e)" class="detail">{{ detail(e) }}</span>
          </div>
          <span class="when muted small" :title="new Date(e.ts).toLocaleString()">{{ ago(e.ts) }}</span>
        </div>
      </TransitionGroup>
      <div v-if="loading" class="entry"><div class="skeleton" style="height: 28px; flex: 1" /></div>
      <p v-else-if="!entries.length" class="muted" style="padding: 24px; text-align: center">No activity yet.</p>
    </div>
    <div v-if="cursor" style="text-align: center; margin-top: 16px">
      <button class="btn btn-soft" :disabled="loading" @click="load(true)">Load older</button>
    </div>
  </section>
</template>

<style scoped>
.list { padding: 6px 0; position: relative; }
.entry { display: flex; align-items: center; gap: 12px; padding: 12px 20px; border-bottom: 1px solid var(--line); }
.entry:last-child { border-bottom: 0; }
.icon { width: 30px; height: 30px; border-radius: 10px; display: inline-flex; align-items: center; justify-content: center; font-weight: 800; flex-shrink: 0; }
.text { flex: 1; font-size: 14px; color: var(--ink-2); min-width: 0; }
.text strong { color: var(--ink); }
.detail { margin-left: 6px; font-size: 12px; background: var(--chrome); border: 1px solid var(--line); padding: 1px 8px; border-radius: 999px; }
.when { white-space: nowrap; }
</style>
