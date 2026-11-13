import { createRouter, createWebHashHistory } from 'vue-router';
import { useSession } from './stores/session';

const router = createRouter({
  history: createWebHashHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', redirect: '/home' },
    { path: '/login', component: () => import('./views/LoginView.vue'), meta: { public: true } },
    { path: '/plan', component: () => import('./views/PlanView.vue'), meta: { public: true } },
    { path: '/privacy', component: () => import('./views/PrivacyView.vue'), meta: { public: true } },
    { path: '/home', component: () => import('./views/HomeView.vue') },
    { path: '/notifications', component: () => import('./views/NotificationsView.vue') },
    { path: '/settings', component: () => import('./views/SettingsView.vue') },
    { path: '/first-login', component: () => import('./views/FirstLoginView.vue') },
    { path: '/consent', component: () => import('./views/ConsentView.vue') },
    { path: '/a', component: () => import('./views/admin/StructureView.vue'), meta: { admin: true } },
    { path: '/a/import', component: () => import('./views/admin/ImportView.vue'), meta: { admin: true } },
    { path: '/a/relations', component: () => import('./views/admin/RelationsView.vue'), meta: { admin: true } },
    { path: '/a/invites', component: () => import('./views/admin/InvitesView.vue'), meta: { admin: true } },
    { path: '/a/consents', component: () => import('./views/admin/ConsentReportView.vue'), meta: { admin: true } },
    { path: '/t/tasks', component: () => import('./views/tasks/TeacherTasks.vue'), meta: { role: 'teacher' } },
    { path: '/t/tasks/new', component: () => import('./views/tasks/TeacherTaskNew.vue'), meta: { role: 'teacher' } },
    { path: '/t/tasks/:taskId', component: () => import('./views/tasks/TeacherTaskDetail.vue'), meta: { role: 'teacher' } },
    { path: '/t/tasks/:taskId/grade/:studentId', component: () => import('./views/grades/TeacherGrade.vue'), meta: { role: 'teacher' } },
    { path: '/t/grade-matrix/:courseId', component: () => import('./views/grades/GradeMatrix.vue'), meta: { role: 'teacher' } },
    { path: '/t/messages', component: () => import('./views/messages/TeacherMessages.vue'), meta: { role: 'teacher' } },
    { path: '/s/tasks', component: () => import('./views/tasks/StudentTasks.vue'), meta: { role: 'student' } },
    { path: '/s/tasks/:taskId', component: () => import('./views/tasks/StudentTaskDetail.vue'), meta: { role: 'student' } },
    { path: '/s/grades', component: () => import('./views/grades/GradesView.vue'), meta: { role: 'student' } },
    { path: '/p/tasks', component: () => import('./views/tasks/ParentTasks.vue'), meta: { role: 'parent' } },
    { path: '/p/tasks/:taskId', component: () => import('./views/tasks/ParentTaskDetail.vue'), meta: { role: 'parent' } },
    { path: '/p/grades', component: () => import('./views/grades/GradesView.vue'), meta: { role: 'parent' } },
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
  const role = typeof to.meta.role === 'string' ? to.meta.role : '';
  if (role && !session.me?.user.roles.includes(role)) {
    return { path: '/home' };
  }
  return true;
});

export default router;
