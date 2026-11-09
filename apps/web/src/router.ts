import { createRouter, createWebHashHistory } from 'vue-router';
import { useSession } from './stores/session';

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/home' },
    { path: '/login', component: () => import('./views/LoginView.vue'), meta: { public: true } },
    { path: '/privacy', component: () => import('./views/PrivacyView.vue'), meta: { public: true } },
    { path: '/home', component: () => import('./views/HomeView.vue') },
    { path: '/first-login', component: () => import('./views/FirstLoginView.vue') },
    { path: '/consent', component: () => import('./views/ConsentView.vue') },
    { path: '/a', component: () => import('./views/admin/StructureView.vue'), meta: { admin: true } },
    { path: '/a/import', component: () => import('./views/admin/ImportView.vue'), meta: { admin: true } },
    { path: '/a/relations', component: () => import('./views/admin/RelationsView.vue'), meta: { admin: true } },
    { path: '/a/invites', component: () => import('./views/admin/InvitesView.vue'), meta: { admin: true } },
    { path: '/a/consents', component: () => import('./views/admin/ConsentReportView.vue'), meta: { admin: true } },
  ],
});

router.beforeEach(async (to) => {
  const session = useSession();
  if (!session.ready) session.restore();
  if (to.meta.public) return true;
  if (!session.token) return { path: '/login' };
  if (!session.me) {
    const result = await session.refresh();
    if (!result.ok) return { path: '/login' };
  }
  if (session.me?.user.mustChangePassword && to.path !== '/first-login') {
    return { path: '/first-login' };
  }
  const needsConsent = (session.me?.pendingConsents.length ?? 0) > 0;
  if (needsConsent && to.path !== '/consent' && to.path !== '/first-login') {
    return { path: '/consent' };
  }
  if (to.meta.admin && !session.me?.user.roles.includes('admin')) {
    return { path: '/home' };
  }
  return true;
});

export default router;
