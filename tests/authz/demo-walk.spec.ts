import { describe, expect, it } from 'vitest';
import { COLLECTIONS } from '@hst/shared';
import { canStart, canSubmit } from '@hst/core';
import { DEV_DEMO_PASSWORD, canary, ids, verifyDevPassword } from '@hst/fixture';
import { call, harness, json } from '../helpers.js';

describe('demo walk accounts', () => {
  it('lets every fixture student who has a task sign in with the demo password', async () => {
    const env = await harness();
    const progress = await env.db.query(COLLECTIONS.taskProgress, () => true);
    const studentIds = new Set(progress.map((doc) => String(doc.studentId)));
    expect(studentIds.size).toBeGreaterThan(0);
    for (const studentId of studentIds) {
      const student = await env.db.get(COLLECTIONS.studentProfiles, studentId);
      const user = await env.db.get(COLLECTIONS.users, String(student?.userId ?? ''));
      const email = String(user?.email ?? '');
      expect(verifyDevPassword(email, DEV_DEMO_PASSWORD), email).not.toBeNull();
    }
    expect(verifyDevPassword('s2@demo.school.local', DEV_DEMO_PASSWORD)?.uid).toBe('uid_s2');
  });

  it('follows the published student, overdue, consent and isolation paths', async () => {
    const env = await harness();
    const mine = await call(env, 'uid_s1', 'task.listMine', { range: 'all' });
    expect(mine.ok).toBe(true);
    const titles = json(mine);
    expect(titles).toContain('科学实验');
    expect(titles).toContain('科学草稿');
    expect(titles).toContain('科学测验');
    expect(titles).not.toContain(canary.s2Week);
    expect(titles).not.toContain('物理作业');

    const quiz = await call(env, 'uid_s1', 'task.get', { taskId: ids.taskS1Released });
    expect(quiz.ok).toBe(true);
    if (quiz.ok) {
      const progress = (quiz.data as { progress: { status: string } }).progress;
      expect(progress.status).toBe('graded');
      expect(canStart({ status: progress.status, requiresSubmission: true })).toBe(false);
      expect(canSubmit({ status: progress.status, requiresSubmission: true })).toBe(false);
    }

    const overdue = await call(env, 'uid_s2', 'task.listMine', { range: 'overdue' });
    expect(overdue.ok).toBe(true);
    expect(json(overdue)).toContain(canary.s2Week);

    const minor = await call(env, 'uid_minor', 'task.listMine', { range: 'all' });
    expect(minor.ok).toBe(false);
    if (!minor.ok) expect(minor.error.code).toBe('CONSENT_REQUIRED');
  });
});
