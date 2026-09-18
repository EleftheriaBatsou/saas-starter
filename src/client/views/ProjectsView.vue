<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import Avatar from '../components/Avatar.vue';
import Modal from '../components/Modal.vue';
import RoleBadge from '../components/RoleBadge.vue';
import StatusPill from '../components/StatusPill.vue';
import { api, ApiError } from '../api.ts';
import { useSession } from '../stores/session.ts';
import { toast } from '../toast.ts';

interface Project {
  id: string;
  name: string;
  description: string;
  status: 'active' | 'paused' | 'done';
  color: string;
  createdAt: string;
  createdBy: string | null;
}

const session = useSession();
const projects = ref<Project[] | null>(null);
const filter = ref<'all' | Project['status']>('all');
const editing = ref<Project | null>(null);
const creating = ref(false);
const saving = ref(false);
const errors = ref<Record<string, string>>({});
const form = reactive({ name: '', description: '', status: 'active' as Project['status'], color: '#7C5CFF' });
const COLORS = ['#7C5CFF', '#0D99FF', '#15D7C4', '#2BD968', '#FFC93C', '#FF5C7C'];

const shown = computed(() => (projects.value ?? []).filter((p) => filter.value === 'all' || p.status === filter.value));
const counts = computed(() => {
  const c = { all: 0, active: 0, paused: 0, done: 0 };
  for (const p of projects.value ?? []) { c.all++; c[p.status]++; }
  return c;
});

async function load() {
  projects.value = (await api.get<{ projects: Project[] }>('/api/projects')).projects;
}
onMounted(load);

function openCreate() {
  Object.assign(form, { name: '', description: '', status: 'active', color: COLORS[(projects.value?.length ?? 0) % COLORS.length] });
  errors.value = {};
  creating.value = true;
}
function openEdit(p: Project) {
  Object.assign(form, { name: p.name, description: p.description, status: p.status, color: p.color });
  errors.value = {};
  editing.value = p;
}
function close() {
  creating.value = false;
  editing.value = null;
}

async function save() {
  saving.value = true;
  errors.value = {};
  try {
    if (editing.value) {
      const { project } = await api.patch<{ project: Project }>(`/api/projects/${editing.value.id}`, form);
      projects.value = projects.value!.map((p) => (p.id === project.id ? project : p));
      toast('Project updated');
    } else {
      const { project } = await api.post<{ project: Project }>('/api/projects', form);
      projects.value = [project, ...projects.value!];
      toast('Project created ✨');
    }
    close();
  } catch (e) {
    if (e instanceof ApiError) errors.value = { _: Object.keys(e.fields).length ? '' : e.message, ...e.fields };
  } finally {
    saving.value = false;
  }
}

async function remove(p: Project) {
  if (!confirm(`Delete “${p.name}”? This can't be undone.`)) return;
  try {
    await api.del(`/api/projects/${p.id}`);
    projects.value = projects.value!.filter((x) => x.id !== p.id);
    toast('Project deleted', 'info');
    close();
  } catch (e) {
    toast(e instanceof ApiError ? e.message : 'Could not delete', 'error');
  }
}

const fmt = (d: string) => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
</script>

<template>
  <div class="page">
    <header class="hero">
      <Avatar :name="session.activeOrg!.name" :seed="session.activeOrg!.id" :size="56" square />
      <div>
        <div class="row" style="gap: 10px">
          <h1>{{ session.activeOrg!.name }}</h1>
          <RoleBadge :role="session.role!" />
        </div>
        <p class="muted">
          <span class="scope-dot" /> Everything below is scoped to <strong>{{ session.activeOrg!.slug }}</strong> by row-level security.
        </p>
      </div>
      <span class="spacer" />
      <button v-if="session.can('project:create')" class="btn btn-primary" @click="openCreate">
        <span style="font-size: 18px; line-height: 0">+</span> New project
      </button>
    </header>

    <div class="tabs">
      <button v-for="f in (['all', 'active', 'paused', 'done'] as const)" :key="f" class="tab" :class="{ on: filter === f }" @click="filter = f">
        {{ f }} <span class="count">{{ counts[f] }}</span>
      </button>
    </div>

    <div v-if="!projects" class="grid">
      <div v-for="i in 3" :key="i" class="skeleton" style="height: 168px; border-radius: 16px" />
    </div>
    <div v-else-if="!shown.length" class="empty card">
      <div class="empty-art">🪐</div>
      <h3>No projects {{ filter === 'all' ? 'yet' : `marked ${filter}` }}</h3>
      <p class="muted">Projects you create here are only visible to members of {{ session.activeOrg!.name }}.</p>
      <button v-if="session.can('project:create') && filter === 'all'" class="btn btn-soft" style="margin-top: 14px" @click="openCreate">Create the first one</button>
    </div>
    <TransitionGroup v-else name="list" tag="div" class="grid">
      <article v-for="p in shown" :key="p.id" class="project card hoverable" tabindex="0" @click="openEdit(p)" @keydown.enter="openEdit(p)">
        <div class="stripe" :style="{ background: `linear-gradient(90deg, ${p.color}, ${p.color}88)` }" />
        <div class="body">
          <div class="row">
            <span class="swatch" :style="{ background: p.color }" />
            <h3>{{ p.name }}</h3>
          </div>
          <p class="desc">{{ p.description || 'No description' }}</p>
          <div class="row foot">
            <StatusPill :status="p.status" />
            <span class="spacer" />
            <span class="muted small">{{ p.createdBy ? p.createdBy.split(' ')[0] + ' · ' : '' }}{{ fmt(p.createdAt) }}</span>
          </div>
        </div>
      </article>
    </TransitionGroup>

    <Modal v-if="creating || editing" :title="editing ? 'Edit project' : 'New project'" @close="close">
      <form novalidate @submit.prevent="save">
        <div v-if="errors._" class="form-error">{{ errors._ }}</div>
        <div class="field">
          <label for="p-name">Name</label>
          <input id="p-name" v-model="form.name" class="input" :class="{ invalid: errors.name }" autofocus />
          <span v-if="errors.name" class="field-error">{{ errors.name }}</span>
        </div>
        <div class="field">
          <label for="p-desc">Description</label>
          <textarea id="p-desc" v-model="form.description" class="input" rows="3" />
        </div>
        <div class="row" style="align-items: flex-start; gap: 16px">
          <div class="field" style="flex: 1">
            <label for="p-status">Status</label>
            <select id="p-status" v-model="form.status" class="input">
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="done">Done</option>
            </select>
          </div>
          <div class="field">
            <label>Colour</label>
            <div class="colors">
              <button v-for="c in COLORS" :key="c" type="button" class="color" :class="{ on: form.color === c }" :style="{ background: c }" :aria-label="c" @click="form.color = c" />
            </div>
          </div>
        </div>
        <div class="row" style="margin-top: 8px">
          <button v-if="editing && session.can('project:delete')" type="button" class="btn btn-danger-ghost" @click="remove(editing)">Delete</button>
          <span class="spacer" />
          <button type="button" class="btn btn-ghost" @click="close">Cancel</button>
          <button class="btn btn-primary" :disabled="saving">{{ editing ? 'Save changes' : 'Create project' }}</button>
        </div>
      </form>
    </Modal>
  </div>
</template>

<style scoped>
.hero { display: flex; align-items: center; gap: 16px; margin-bottom: 28px; flex-wrap: wrap; }
.scope-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--active); box-shadow: 0 0 0 4px rgba(43, 217, 104, 0.18); margin-right: 4px; }
.tabs { display: flex; gap: 6px; margin-bottom: 20px; flex-wrap: wrap; }
.tab {
  border: 1px solid var(--line); background: #fff; border-radius: 999px; padding: 6px 12px 6px 14px;
  font: 600 13px var(--font); color: var(--ink-2); text-transform: capitalize; cursor: pointer;
  transition: all 0.25s var(--spring);
}
.tab:hover { border-color: #d3c9ff; }
.tab.on { background: var(--ink); color: #fff; border-color: var(--ink); }
.count { display: inline-block; min-width: 20px; margin-left: 4px; padding: 0 6px; border-radius: 999px; background: rgba(124, 92, 255, 0.12); font-size: 11px; }
.tab.on .count { background: rgba(255, 255, 255, 0.2); }
.project { overflow: hidden; cursor: pointer; outline: none; position: relative; }
.project:focus-visible { box-shadow: 0 0 0 3px rgba(124, 92, 255, 0.4), var(--shadow-3); }
.stripe { height: 6px; }
.body { padding: 18px 20px 16px; }
.swatch { width: 10px; height: 10px; border-radius: 4px; }
.desc { color: var(--ink-2); font-size: 14px; margin: 8px 0 18px; min-height: 42px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.foot { gap: 8px; }
.empty { padding: 48px 24px; text-align: center; }
.empty-art { font-size: 48px; margin-bottom: 8px; animation: spinslow 8s linear infinite; display: inline-block; }
@keyframes spinslow { to { transform: rotate(360deg); } }
.colors { display: flex; gap: 6px; height: 44px; align-items: center; }
.color { width: 26px; height: 26px; border-radius: 8px; border: 0; cursor: pointer; transition: transform 0.3s var(--spring); }
.color:hover { transform: scale(1.12); }
.color.on { box-shadow: 0 0 0 2px #fff, 0 0 0 4px var(--ink); transform: scale(1.08); }
</style>
