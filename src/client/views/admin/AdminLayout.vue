<script setup lang="ts">
import { computed } from 'vue';
import { useSession } from '../../stores/session.ts';
import type { Permission } from '../../../shared/permissions.ts';

const session = useSession();
const tabs = computed(() =>
  ([
    { to: '/admin/members', label: 'Members', perm: 'member:read' },
    { to: '/admin/invites', label: 'Invitations', perm: 'invite:manage' },
    { to: '/admin/settings', label: 'Settings', perm: 'org:update' },
    { to: '/admin/audit', label: 'Audit log', perm: 'audit:read' },
  ] as { to: string; label: string; perm: Permission }[]).filter((t) => session.can(t.perm)),
);
</script>

<template>
  <div class="page">
    <header class="head">
      <h1>{{ session.can('member:manage') ? 'Admin' : 'Team' }}</h1>
      <p class="muted">Manage {{ session.activeOrg!.name }}'s people and settings.</p>
    </header>
    <nav class="tabs">
      <RouterLink v-for="t in tabs" :key="t.to" :to="t.to" class="tab">{{ t.label }}</RouterLink>
    </nav>
    <RouterView v-slot="{ Component }">
      <Transition name="fade" mode="out-in"><component :is="Component" /></Transition>
    </RouterView>
  </div>
</template>

<style scoped>
.head { margin-bottom: 20px; }
.tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--line); margin-bottom: 24px; overflow-x: auto; }
.tab {
  padding: 10px 14px; font-weight: 700; font-size: 14px; color: var(--ink-3); text-decoration: none !important;
  border-bottom: 2.5px solid transparent; margin-bottom: -1px; white-space: nowrap; transition: color 0.15s, border-color 0.2s;
}
.tab:hover { color: var(--ink); }
.tab.router-link-active { color: var(--accent); border-color: var(--accent); }
</style>
