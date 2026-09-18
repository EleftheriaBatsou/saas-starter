import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { api, setApiOrg } from '../api.ts';
import { can as canRole, type Permission, type Role } from '../../shared/permissions.ts';

export interface OrgSummary {
  id: string;
  name: string;
  slug: string;
  role: Role;
}
export interface Me {
  user: { id: string; email: string; name: string; emailVerifiedAt: string | null };
  orgs: OrgSummary[];
  activeOrgId: string | null;
  role: Role | null;
  permissions: Permission[];
}

export const useSession = defineStore('session', () => {
  const me = ref<Me | null>(null);
  const loaded = ref(false);
  // Bumped on every org switch; views watch it to refetch everything.
  const orgEpoch = ref(0);

  const user = computed(() => me.value?.user ?? null);
  const orgs = computed(() => me.value?.orgs ?? []);
  const activeOrg = computed(() => orgs.value.find((o) => o.id === me.value?.activeOrgId) ?? null);
  const role = computed(() => activeOrg.value?.role ?? null);

  function can(p: Permission) {
    return canRole(role.value, p);
  }

  async function refresh() {
    try {
      me.value = await api.get<Me>('/api/me');
    } catch {
      me.value = null;
    }
    setApiOrg(me.value?.activeOrgId ?? null);
    loaded.value = true;
    orgEpoch.value++;
  }

  async function switchOrg(orgId: string) {
    await api.post('/api/session/active-org', { orgId });
    await refresh();
  }

  function clear() {
    me.value = null;
    setApiOrg(null);
  }

  async function logout() {
    await api.post('/api/auth/logout').catch(() => {});
    me.value = null;
    setApiOrg(null);
  }

  return { me, loaded, orgEpoch, user, orgs, activeOrg, role, can, refresh, switchOrg, logout, clear };
});
