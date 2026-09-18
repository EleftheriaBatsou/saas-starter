<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import Avatar from './Avatar.vue';
import RoleBadge from './RoleBadge.vue';
import { useSession } from '../stores/session.ts';
import { toast } from '../toast.ts';

const session = useSession();
const router = useRouter();
const open = ref(false);
const query = ref('');
const cursor = ref(0);
const switching = ref<string | null>(null);
const root = ref<HTMLElement | null>(null);
const search = ref<HTMLInputElement | null>(null);

const filtered = computed(() =>
  session.orgs.filter((o) => o.name.toLowerCase().includes(query.value.toLowerCase()) || o.slug.includes(query.value.toLowerCase())),
);

async function toggle() {
  open.value = !open.value;
  if (open.value) {
    query.value = '';
    cursor.value = Math.max(0, filtered.value.findIndex((o) => o.id === session.activeOrg?.id));
    await nextTick();
    search.value?.focus();
  }
}

async function pick(id: string) {
  if (id === session.activeOrg?.id) {
    open.value = false;
    return;
  }
  switching.value = id;
  try {
    await session.switchOrg(id);
    open.value = false;
    toast(`Switched to ${session.activeOrg?.name}`, 'info', 2200);
    if (!router.currentRoute.value.path.startsWith('/projects') && !router.currentRoute.value.path.startsWith('/admin')) {
      router.push('/projects');
    } else if (router.currentRoute.value.meta.permission && !session.can(router.currentRoute.value.meta.permission)) {
      router.push('/projects');
    }
  } finally {
    switching.value = null;
  }
}

function onKey(e: KeyboardEvent) {
  if (!open.value) return;
  if (e.key === 'Escape') open.value = false;
  if (e.key === 'ArrowDown') { cursor.value = (cursor.value + 1) % Math.max(filtered.value.length, 1); e.preventDefault(); }
  if (e.key === 'ArrowUp') { cursor.value = (cursor.value - 1 + filtered.value.length) % Math.max(filtered.value.length, 1); e.preventDefault(); }
  if (e.key === 'Enter' && filtered.value[cursor.value]) pick(filtered.value[cursor.value]!.id);
}
function onDocClick(e: MouseEvent) {
  if (open.value && root.value && !root.value.contains(e.target as Node)) open.value = false;
}
function onShortcut(e: KeyboardEvent) {
  // ⌘/Ctrl + O opens the switcher, Linear-style.
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'o') { e.preventDefault(); toggle(); }
}
onMounted(() => {
  document.addEventListener('mousedown', onDocClick);
  window.addEventListener('keydown', onShortcut);
});
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocClick);
  window.removeEventListener('keydown', onShortcut);
});
</script>

<template>
  <div ref="root" class="switcher" @keydown="onKey">
    <button class="trigger" :class="{ open }" aria-haspopup="listbox" :aria-expanded="open" @click="toggle">
      <Avatar v-if="session.activeOrg" :name="session.activeOrg.name" :seed="session.activeOrg.id" :size="28" square />
      <span class="name">{{ session.activeOrg?.name ?? 'No organisation' }}</span>
      <svg class="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="m7 10 5 5 5-5" /></svg>
    </button>

    <Transition name="pop">
      <div v-if="open" class="menu card" role="listbox">
        <div class="search-wrap">
          <input ref="search" v-model="query" class="search" placeholder="Switch organisation…" @input="cursor = 0" />
          <kbd>⌘O</kbd>
        </div>
        <div class="label">Your organisations</div>
        <button
          v-for="(o, i) in filtered"
          :key="o.id"
          class="item"
          :class="{ active: o.id === session.activeOrg?.id, cursor: i === cursor }"
          role="option"
          :aria-selected="o.id === session.activeOrg?.id"
          @mouseenter="cursor = i"
          @click="pick(o.id)"
        >
          <Avatar :name="o.name" :seed="o.id" :size="30" square />
          <span class="meta">
            <span class="org-name">{{ o.name }}</span>
            <span class="slug">{{ o.slug }}</span>
          </span>
          <RoleBadge :role="o.role" />
          <span class="check">
            <span v-if="switching === o.id" class="spinner" />
            <svg v-else-if="o.id === session.activeOrg?.id" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="m5 12 5 5 9-10" /></svg>
          </span>
        </button>
        <p v-if="!filtered.length" class="empty">No matches</p>
        <div class="divider" />
        <RouterLink class="item create" to="/welcome" @click="open = false">
          <span class="plus">+</span>
          <span class="org-name">Create organisation</span>
        </RouterLink>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.switcher { position: relative; }
.trigger {
  display: flex; align-items: center; gap: 10px; height: 40px; padding: 0 10px 0 6px;
  border-radius: 12px; border: 1px solid transparent; background: transparent; cursor: pointer;
  font: 700 14.5px var(--font); color: var(--ink); max-width: 260px;
  transition: background 0.15s, border-color 0.15s, transform 0.25s var(--spring);
}
.trigger:hover, .trigger.open { background: #fff; border-color: var(--line); box-shadow: var(--shadow-1); }
.trigger:active { transform: scale(0.97); }
.name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chev { color: var(--ink-3); transition: transform 0.3s var(--spring); flex-shrink: 0; }
.open .chev { transform: rotate(180deg); }
.menu {
  position: absolute; top: calc(100% + 8px); left: 0; width: 340px; padding: 8px; z-index: 40;
  box-shadow: var(--shadow-3); transform-origin: top left;
}
.search-wrap { position: relative; margin-bottom: 4px; }
.search {
  width: 100%; height: 38px; border: 0; border-radius: 10px; background: var(--chrome); padding: 0 48px 0 12px;
  font: 500 14px var(--font); color: var(--ink); outline: none;
}
.search:focus { box-shadow: 0 0 0 2px rgba(124, 92, 255, 0.25); }
kbd {
  position: absolute; right: 8px; top: 9px; font: 700 11px var(--font); color: var(--ink-3);
  background: #fff; border: 1px solid var(--line); border-radius: 6px; padding: 2px 6px;
}
.label { font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-3); padding: 10px 10px 6px; }
.item {
  display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 10px; border-radius: 10px;
  border: 0; background: transparent; cursor: pointer; text-align: left; font-family: var(--font); color: var(--ink);
  transition: background 0.12s;
}
.item.cursor { background: var(--accent-50); }
.meta { display: flex; flex-direction: column; flex: 1; min-width: 0; }
.org-name { font-weight: 700; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.slug { font-size: 12px; color: var(--ink-3); }
.check { width: 18px; color: var(--accent); display: flex; justify-content: center; }
.divider { height: 1px; background: var(--line); margin: 6px 4px; }
.create { text-decoration: none !important; color: var(--accent); }
.create:hover { background: var(--accent-50); }
.plus {
  width: 30px; height: 30px; border-radius: 9px; border: 1.5px dashed #c9bcff; display: inline-flex;
  align-items: center; justify-content: center; font-weight: 700; font-size: 18px;
}
.empty { padding: 12px; color: var(--ink-3); font-size: 13px; text-align: center; }
.spinner {
  width: 14px; height: 14px; border: 2px solid var(--accent-50); border-top-color: var(--accent);
  border-radius: 50%; animation: spin 0.7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 720px) { .menu { width: calc(100vw - 32px); } }
</style>
