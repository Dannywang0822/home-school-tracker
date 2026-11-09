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
  return true;
});

export default router;
