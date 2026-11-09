import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { COLLECTIONS } from '@hst/shared';
import { canary, foreignMarkers, ids } from '@hst/fixture';
import { call, harness, json } from '../helpers.js';

const USER_HEADER = 'role,email,phone,display_name_zh,display_name_en,student_no,programme,grade_level,homeroom_class,age_band,graduation_year';
const GUARD_HEADER = 'parent_email_or_phone,student_no,relation,is_primary';

function noForeign(value: unknown): void {
  const text = json(value);
  for (const marker of foreignMarkers) expect(text).not.toContain(marker);
  expect(text).not.toContain('cny_dp_course');
}

async function asAdmin<T>(env: Awaited<ReturnType<typeof harness>>, action: string, data: unknown = {}) {
  return call(env, 'uid_a1', action, data) as Promise<{ ok: true; data: T } | { ok: false; error: { code: string; message: string; details?: Record<string, unknown> } }>;
}

describe('organization and accounts', () => {
  it('seeds MYP groups and DP subjects without duplicating existing codes', async () => {
    const env = await harness();
    const first = await asAdmin<{ created: number }>(env, 'admin.subject.ensureDefaults');
    const second = await asAdmin<{ created: number }>(env, 'admin.subject.ensureDefaults');
    expect(first.ok && second.ok).toBe(true);
    if (second.ok) expect(second.data.created).toBe(0);
    const listed = await asAdmin<{ subjects: Array<{ code: string; programme: string }> }>(env, 'admin.structure.list');
    expect(listed.ok).toBe(true);
    if (listed.ok) {
      const codes = listed.data.subjects.map((subject) => subject.code);
      for (const code of ['LL', 'LA', 'IS', 'SCI', 'MATH', 'ARTS', 'PHE', 'DES', 'MATH_AA', 'TOK', 'EE', 'CAS']) {
        expect(codes).toContain(code);
      }
      expect(codes.filter((code) => code === 'SCI')).toHaveLength(1);
    }
  });

  it('imports users idempotently, then blocks the parent until consent', async () => {
    const env = await harness();
    await asAdmin(env, 'admin.subject.ensureDefaults');
    const createdClass = await asAdmin<{ id: string }>(env, 'admin.class.upsert', {
      yearId: ids.year,
      programme: 'MYP',
      name: { zh: '导入班', en: 'Import form' },
    });
    expect(createdClass.ok).toBe(true);
    const csv = [
      USER_HEADER,
      'student,s-new@demo.school.local,,导入学生,Imported Student,S9001,MYP,MYP1,导入班,under14,2030',
      'parent,p-new@demo.school.local,+8613800138000,导入家长,Imported Parent,,,,,,',
    ].join('\n');
    const validated = await asAdmin<{ jobId: string; preview: unknown[] }>(env, 'admin.import.validate', { type: 'users', csv });
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    expect(validated.data.preview).toHaveLength(2);
    const ran = await asAdmin<{ created: number }>(env, 'admin.import.run', { jobId: validated.data.jobId });
    expect(ran.ok).toBe(true);
    if (ran.ok) expect(ran.data.created).toBe(2);
    const again = await asAdmin<{ created: number; updated: number }>(env, 'admin.import.run', { jobId: validated.data.jobId });
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.data.created).toBe(2);
    const rerun = await asAdmin<{ jobId: string }>(env, 'admin.import.validate', { type: 'users', csv });
    expect(rerun.ok).toBe(true);
    if (!rerun.ok) return;
    const second = await asAdmin<{ created: number; updated: number }>(env, 'admin.import.run', { jobId: rerun.data.jobId });
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.data.created).toBe(0);
      expect(second.data.updated).toBe(2);
    }
    const status = await asAdmin<{ credentials: Array<{ email: string; userId: string; tempPassword: string }> }>(env, 'admin.import.status', { jobId: validated.data.jobId });
    expect(status.ok).toBe(true);
    if (!status.ok) return;
    expect(status.data.credentials).toHaveLength(2);
    const parent = status.data.credentials.find((item) => item.email === 'p-new@demo.school.local');
    const student = status.data.credentials.find((item) => item.email === 's-new@demo.school.local');
    expect(parent && student).toBeTruthy();
    const hidden = await asAdmin<{ credentials: unknown[] }>(env, 'admin.import.status', { jobId: validated.data.jobId });
    expect(hidden.ok).toBe(true);
    if (hidden.ok) expect(hidden.data.credentials).toEqual([]);
    const users = await env.db.query(COLLECTIONS.users, (doc) => doc.email === 'p-new@demo.school.local');
    expect(json(await asAdmin(env, 'admin.user.list', { role: 'parent' }))).not.toContain('devLoginHash');
    expect(users[0]?.mustChangePassword).toBe(true);

    const link = [
      GUARD_HEADER,
      'p-new@demo.school.local,S9001,guardian,true',
    ].join('\n');
    const guardJob = await asAdmin<{ jobId: string }>(env, 'admin.import.validate', { type: 'guardianships', csv: link });
    expect(guardJob.ok).toBe(true);
    if (!guardJob.ok) return;
    expect((await asAdmin(env, 'admin.import.run', { jobId: guardJob.data.jobId })).ok).toBe(true);

    const parentUserId = parent?.userId ?? '';
    const identity = await env.db.query(COLLECTIONS.authIdentities, (doc) => doc.userId === parentUserId && doc.provider === 'cloudbase_uid');
    const uid = identity[0]?.key as string;
    await call(env, uid, 'auth.passwordChanged');
    const blocked = await call(env, uid, 'dashboard.parent', {});
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error.code).toBe('CONSENT_REQUIRED');
    noForeign(blocked);
    const profile = await env.db.query(COLLECTIONS.studentProfiles, (doc) => doc.studentNo === 'S9001');
    const granted = await call(env, uid, 'consent.grant', {
      studentId: profile[0]?._id,
      policyVersion: '2026-11-v1',
      scopes: ['basic_processing'],
    });
    expect(granted.ok).toBe(true);
    const home = await call(env, uid, 'dashboard.parent', {});
    expect(home.ok).toBe(true);
    if (home.ok) {
      const data = home.data as { children: Array<{ studentId: string }> };
      expect(data.children).toHaveLength(1);
      expect(data.children[0]?.studentId).toBe(profile[0]?._id);
    }
    noForeign(home);
    const denied = await call(env, uid, 'task.get', { taskId: ids.taskShared, studentId: ids.s2 });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error.code).toBe('NOT_FOUND');
    noForeign(denied);
    const audits = await env.db.query(COLLECTIONS.auditLogs, (doc) => doc.action === 'consent.grant' && doc.studentId === profile[0]?._id);
    expect(audits.length).toBeGreaterThan(0);
    expect(json(audits)).not.toContain(parent?.tempPassword ?? 'missing-password');
    expect(json(audits)).not.toContain(canary.s2Grade);
  });

  it('reports CSV errors and does not create accounts', async () => {
    const env = await harness();
    const before = await env.db.count(COLLECTIONS.users);
    const csv = `${USER_HEADER}\nstudent,not-an-email,,坏行,Bad,S1,MYP,MYP9,不存在,child,20\n`;
    const result = await call(env, 'uid_a1', 'admin.import.validate', { type: 'users', csv });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('IMPORT_VALIDATION_FAILED');
      expect(JSON.stringify(result.error.details?.errors ?? '')).toContain('BAD_EMAIL');
    }
    expect(await env.db.count(COLLECTIONS.users)).toBe(before);
  });

  it('issues a one-time invite code and does not store the plaintext', async () => {
    const env = await harness();
    const created = await asAdmin<{ code: string; inviteId: string }>(env, 'admin.invite.create', { studentId: ids.s1, relation: 'guardian' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const listed = await asAdmin<{ items: Array<{ inviteId: string }> }>(env, 'admin.invite.list', { studentId: ids.s1 });
    expect(listed.ok).toBe(true);
    expect(json(listed)).not.toContain(created.data.code);
    const stored = await env.db.get(COLLECTIONS.inviteCodes, created.data.inviteId);
    expect(json(stored)).not.toContain(created.data.code);
    const redeemed = await call(env, 'uid_p5', 'guardian.redeemInvite', { code: created.data.code });
    expect(redeemed.ok).toBe(true);
    const parentView = await call(env, 'uid_p1', 'admin.invite.list', { studentId: ids.s2 });
    expect(parentView.ok).toBe(false);
    if (!parentView.ok) expect(parentView.error.code).toBe('PERMISSION_DENIED');
    noForeign(parentView);
  });

  it('lets a teacher see only assigned courses and blocks admin imports', async () => {
    const env = await harness();
    const mine = await call(env, 'uid_t1', 'course.listMine', {});
    expect(mine.ok).toBe(true);
    const text = json(mine);
    expect(text).toContain(ids.courseSci);
    expect(text).not.toContain(ids.coursePhy);
    expect(text).not.toContain('cny_dp_course');
    const other = await call(env, 'uid_t1', 'course.roster', { courseId: ids.coursePhy });
    expect(other.ok).toBe(false);
    if (!other.ok) expect(other.error.code).toBe('NOT_FOUND');
    expect(json(other)).not.toContain('演示学生三');
    const imported = await call(env, 'uid_t1', 'admin.import.validate', {
      type: 'users',
      csv: `${USER_HEADER}\nparent,x@demo.school.local,,${canary.s2Grade},X,,,,,,,`,
    });
    expect(imported.ok).toBe(false);
    if (!imported.ok) expect(imported.error.code).toBe('PERMISSION_DENIED');
    expect(json(imported)).not.toContain(canary.s2Grade);
  });

  it('keeps new admin actions from leaking another child to a parent', async () => {
    const env = await harness();
    const poisoned = `${USER_HEADER}\nstudent,leak@demo.school.local,,${canary.s2Name},Leak,S2,MYP,MYP1,MYP4-A,14plus,2030\n`;
    const actions: Array<[string, unknown]> = [
      ['admin.structure.list', {}],
      ['admin.year.upsert', { name: '2030-2031', startDate: 1, endDate: 2 }],
      ['admin.import.validate', { type: 'users', csv: poisoned }],
      ['admin.import.status', { jobId: 'job_missing' }],
      ['admin.user.list', { query: canary.s2Name }],
      ['admin.consent.report', { classId: ids.classMyp }],
      ['admin.audit.query', { studentId: ids.s2 }],
      ['admin.relation.upsert', { kind: 'guardianship', parentId: ids.p1, studentId: ids.s2, relation: 'guardian' }],
      ['course.listMine', { studentId: ids.s2 }],
      ['consent.grant', { studentId: ids.s2, policyVersion: '2026-11-v1', scopes: ['basic_processing'] }],
    ];
    for (const [action, data] of actions) {
      const result = await call(env, 'uid_p1', action, data, randomUUID());
      expect(result.ok, action).toBe(false);
      noForeign(result);
      expect(json(result)).not.toContain(canary.s2Name);
    }
  });
});
