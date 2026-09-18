<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import Avatar from './Avatar.vue';
import OrgSwitcher from './OrgSwitcher.vue';
import { useSession } from '../stores/session.ts';
import { api } from '../api.ts';
import { toast } from '../toast.ts';

const session = useSession();
const router = useRouter();
const menu = ref(false);
const menuRoot = ref<HTMLElement | null>(null);

async function logout() {
  await session.logout();
  router.push('/login');
}
async function logoutEverywhere() {
  const r = await api.post<{ revoked: number }>('/api/auth/logout-all');
  await session.logout();
  toast(`Signed out of ${r.revoked} session${r.revoked === 1 ? '' : 's'}.`, 'info');
  router.push('/login');
}
function onDoc(e: MouseEvent) {
  if (menu.value && menuRoot.value && !menuRoot.value.contains(e.target as Node)) menu.value = false;
}
onMounted(() => document.addEventListener('mousedown', onDoc));
onBeforeUnmount(() => document.removeEventListener('mousedown', onDoc));
</script>

<template>
  <header class="topbar">
    <div class="inner">
      <RouterLink to="/projects" class="logo" aria-label="Home">
        <span class="mark"><svg width="16" height="16" viewBox="0 0 24 24"><path d="M5 17 12 5l7 12z" fill="#fff" /></svg></span>
      </RouterLink>
      <span class="slash">/</span>
      <OrgSwitcher />
      <nav v-if="session.activeOrg" class="nav">
        <RouterLink to="/projects">Projects</RouterLink>
        <RouterLink v-if="session.can('member:read')" to="/admin">
          {{ session.can('member:manage') ? 'Admin' : 'Team' }}
        </RouterLink>
      </nav>
      <span class="spacer" />
      <div ref="menuRoot" class="user">
        <button class="user-btn" :aria-expanded="menu" @click="menu = !menu">
          <Avatar :name="session.user!.name" :seed="session.user!.id" :size="32" />
        </button>
        <Transition name="pop">
          <div v-if="menu" class="menu card">
            <div class="who">
              <strong>{{ session.user!.name }}</strong>
              <span class="muted small">{{ session.user!.email }}</span>
            </div>
            <button class="mi" @click="logout">Sign out</button>
            <button class="mi danger" @click="logoutEverywhere">Sign out everywhere</button>
          </div>
        </Transition>
      </div>
    </div>
  </header>
</template>

<style scoped>
.topbar {
  position: sticky; top: 0; z-index: 30;
  background: rgba(251, 250, 255, 0.82); backdrop-filter: saturate(1.6) blur(12px);
  border-bottom: 1px solid var(--line);
}
.inner { max-width: 1120px; margin: 0 auto; height: 60px; padding: 0 24px; display: flex; align-items: center; gap: 8px; }
.logo { display: flex; }
.mark {
  width: 32px; height: 32px; border-radius: 10px; display: inline-flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, #7c5cff, #0d99ff); box-shadow: 0 6px 14px -6px rgba(124, 92, 255, 0.8);
  transition: transform 0.4s var(--spring);
}
.logo:hover .mark { transform: rotate(-12deg) scale(1.08); }
.slash { color: #d8d3ee; font-size: 22px; font-weight: 300; margin: 0 2px; }
.nav { display: flex; gap: 4px; margin-left: 12px; }
.nav a {
  color: var(--ink-2); font-weight: 600; font-size: 14px; padding: 8px 12px; border-radius: 10px; text-decoration: none;
  transition: background 0.15s, color 0.15s;
}
.nav a:hover { background: var(--accent-50); color: var(--accent); }
.nav a.router-link-active { color: var(--accent); background: var(--accent-50); }
.user { position: relative; }
.user-btn { border: 0; background: transparent; padding: 2px; border-radius: 50%; cursor: pointer; transition: transform 0.3s var(--spring); }
.user-btn:hover { transform: scale(1.06); }
.menu { position: absolute; right: 0; top: calc(100% + 8px); width: 240px; padding: 8px; transform-origin: top right; box-shadow: var(--shadow-3); }
.who { display: flex; flex-direction: column; padding: 8px 10px 10px; border-bottom: 1px solid var(--line); margin-bottom: 6px; }
.mi {
  display: block; width: 100%; text-align: left; padding: 9px 10px; border: 0; background: transparent; border-radius: 9px;
  font: 600 14px var(--font); color: var(--ink); cursor: pointer;
}
.mi:hover { background: var(--accent-50); }
.mi.danger { color: #d62f55; }
.mi.danger:hover { background: #fff0f3; }
@media (max-width: 720px) { .inner { padding: 0 12px; } .nav { margin-left: 0; } }
</style>
