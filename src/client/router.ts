import { createRouter, createWebHistory } from 'vue-router';
import { useSession } from './stores/session.ts';
import type { Permission } from '../shared/permissions.ts';

declare module 'vue-router' {
  interface RouteMeta {
    public?: boolean; // reachable signed-out
    guestOnly?: boolean; // bounce signed-in users to the app
    needsOrg?: boolean;
    permission?: Permission;
  }
}

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/projects' },
    { path: '/login', component: () => import('./views/LoginView.vue'), meta: { public: true, guestOnly: true } },
    { path: '/signup', component: () => import('./views/SignupView.vue'), meta: { public: true, guestOnly: true } },
    { path: '/forgot-password', component: () => import('./views/ForgotView.vue'), meta: { public: true } },
    { path: '/reset-password', component: () => import('./views/ResetView.vue'), meta: { public: true } },
    { path: '/verify-email', component: () => import('./views/VerifyEmailView.vue'), meta: { public: true } },
    { path: '/invite/:token', component: () => import('./views/AcceptInviteView.vue'), meta: { public: true } },
    { path: '/welcome', component: () => import('./views/OnboardingView.vue') },
    { path: '/projects', component: () => import('./views/ProjectsView.vue'), meta: { needsOrg: true } },
    {
      path: '/admin',
      component: () => import('./views/admin/AdminLayout.vue'),
      meta: { needsOrg: true },
      children: [
        { path: '', redirect: '/admin/members' },
        { path: 'members', component: () => import('./views/admin/MembersView.vue'), meta: { needsOrg: true, permission: 'member:read' } },
        { path: 'invites', component: () => import('./views/admin/InvitesView.vue'), meta: { needsOrg: true, permission: 'invite:manage' } },
        { path: 'settings', component: () => import('./views/admin/SettingsView.vue'), meta: { needsOrg: true, permission: 'org:update' } },
        { path: 'audit', component: () => import('./views/admin/AuditView.vue'), meta: { needsOrg: true, permission: 'audit:read' } },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/projects' },
  ],
});

// UX routing only — the server independently enforces every one of these rules.
router.beforeEach(async (to) => {
  const session = useSession();
  if (!session.loaded) await session.refresh();
  const signedIn = Boolean(session.user);
  if (!signedIn && !to.meta.public) return { path: '/login', query: to.fullPath !== '/projects' ? { next: to.fullPath } : {} };
  if (signedIn && to.meta.guestOnly) return '/projects';
  if (signedIn && to.meta.needsOrg && !session.activeOrg) return '/welcome';
  if (to.meta.permission && !session.can(to.meta.permission)) return '/projects';
  return true;
});
