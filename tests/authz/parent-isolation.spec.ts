import { describe, expect, it } from 'vitest';
import { COLLECTIONS } from '@hst/shared';
import { emitNotification, Repo } from '@hst/core';
import { MAIL_FROM } from '@hst/shared';
import { canary, foreignMarkers, ids, NOW } from '@hst/fixture';
import { call, harness, json } from '../helpers.js';

const uid = {
  p1: 'uid_p1',
  p2: 'uid_p2',
  p3: 'uid_p3',
  p4: 'uid_p4',
  p5: 'uid_p5',
  t1: 'uid_t1',
  t3: 'uid_t3',
  minor: 'uid_minor',
  ops: 'uid_ops',
};

function assertNoForeign(value: unknown, allow: string[] = []): void {
  const text = json(value);
  for (const marker of foreignMarkers) {
    if (allow.includes(marker)) continue;
    expect(text).not.toContain(marker);
  }
  expect(text).not.toContain(ids.s2);
  expect(text).not.toContain(ids.p2);
  expect(text).not.toContain('uid_p2');
}

describe('parent cannot read another child', () => {
  it('PX-05 task.get for the other child is NOT_FOUND and hides that child status', async () => {
    const env = await harness();
    const denied = await call(env, uid.p1, 'task.get', { taskId: ids.taskShared, studentId: ids.s2 });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error.code).toBe('NOT_FOUND');
    assertNoForeign(denied);

    const allowed = await call(env, uid.p1, 'task.get', { taskId: ids.taskShared, studentId: ids.s1 });
    expect(allowed.ok).toBe(true);
    if (allowed.ok) {
      const data = allowed.data as { progress: { displayStatus: string } };
      expect(data.progress.displayStatus).toBe('not_started');
    }
    assertNoForeign(allowed);
  });

  it('PX-06 progress, assessment, summary and dashboard reject the other child', async () => {
    const env = await harness();
    for (const action of ['progress.listByStudent', 'assessment.listByStudent', 'summary.get', 'dashboard.parent'] as const) {
      const result = await call(env, uid.p1, action, { studentId: ids.s2 });
      expect(result.ok, action).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
      assertNoForeign(result);
    }
  });

  it('PX-07 thread and message calls do not write', async () => {
    const env = await harness();
    const before = await env.db.count(COLLECTIONS.messages);
    const thread = await call(env, uid.p1, 'thread.get', { threadId: ids.threadS2 });
    const list = await call(env, uid.p1, 'message.list', { threadId: ids.threadS2 });
    const post = await call(env, uid.p1, 'message.post', { threadId: ids.threadS2, body: canary.s2Message });
    expect(thread.ok).toBe(false);
    expect(list.ok).toBe(false);
    expect(post.ok).toBe(false);
    if (!post.ok) expect(post.error.code).toBe('NOT_FOUND');
    expect(await env.db.count(COLLECTIONS.messages)).toBe(before);
    assertNoForeign(thread);
    assertNoForeign(list);
    assertNoForeign(post);
  });

  it('PX-08 file.getUrl does not sign a link', async () => {
    const env = await harness();
    const result = await call(env, uid.p1, 'file.getUrl', { fileId: ids.fileS2 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
    expect(json(result)).not.toContain('url');
    expect(json(result)).not.toContain('cloud://');
    assertNoForeign(result);
  });

  it('PX-10 cas, milestone and rppf ids are NOT_FOUND', async () => {
    const env = await harness();
    const cases: Array<[string, Record<string, string>]> = [
      ['cas.list', { studentId: ids.s2 }],
      ['cas.get', { experienceId: ids.expS2 }],
      ['milestone.getPlan', { planId: ids.planS2 }],
      ['rppf.get', { planId: ids.planS2 }],
    ];
    for (const [action, data] of cases) {
      const result = await call(env, uid.p1, action, data);
      expect(result.ok, action).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
      assertNoForeign(result);
    }
  });

  it('PX-11 parent calling course.roster is PERMISSION_DENIED', async () => {
    const env = await harness();
    const result = await call(env, uid.p1, 'course.roster', { courseId: ids.courseSci });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PERMISSION_DENIED');
    assertNoForeign(result);
  });

  it('PX-12 dashboard without a student id returns only the caller child', async () => {
    const env = await harness();
    const result = await call(env, uid.p1, 'dashboard.parent', {});
    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as { children: Array<{ studentId: string }>; overdueCount: number; weekTasks: unknown[] };
      expect(data.children.map((child) => child.studentId)).toEqual([ids.s1]);
      expect(data.overdueCount).toBe(0);
      expect(json(data.weekTasks)).not.toContain(canary.s2Week);
    }
    assertNoForeign(result);
    expect(json(result)).not.toContain('@');
  });

  it('PX-13 notify.list returns only the caller notifications', async () => {
    const env = await harness();
    const result = await call(env, uid.p1, 'notify.list', { recipientUserId: ids.p2 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as { items: Array<{ studentId?: string }> };
      expect(data.items.length).toBeGreaterThan(0);
      expect(data.items.every((item) => item.studentId === ids.s1)).toBe(true);
    }
    assertNoForeign(result);
  });

  it('PX-14 the sixth invite guess is rate limited and audited', async () => {
    const env = await harness();
    const before = await env.db.count(COLLECTIONS.guardianships);
    for (let i = 1; i <= 5; i += 1) {
      const result = await call(env, uid.p1, 'guardian.redeemInvite', { code: `BAD0000${i}` });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('INVITE_INVALID');
    }
    const limited = await call(env, uid.p1, 'guardian.redeemInvite', { code: 'BAD00006' });
    expect(limited.ok).toBe(false);
    if (!limited.ok) expect(limited.error.code).toBe('RATE_LIMITED');
    expect(await env.db.count(COLLECTIONS.guardianships)).toBe(before);
    const audits = await env.db.query(COLLECTIONS.auditLogs, (doc) => doc.actorUserId === ids.p1 && doc.result === 'denied');
    expect(audits.length).toBeGreaterThan(0);
  });

  it('PX-15 used and expired invites do not create a guardianship', async () => {
    const env = await harness();
    const before = await env.db.count(COLLECTIONS.guardianships);
    for (const code of ['USEDCODE', 'EXPIRED1']) {
      const result = await call(env, uid.p1, 'guardian.redeemInvite', { code });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('INVITE_INVALID');
      assertNoForeign(result);
    }
    expect(await env.db.count(COLLECTIONS.guardianships)).toBe(before);
  });

  it('PX-16 a revoked guardian cannot read the former child', async () => {
    const env = await harness();
    const result = await call(env, uid.p4, 'progress.listByStudent', { studentId: ids.s1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
    const home = await call(env, uid.p4, 'dashboard.parent', {});
    expect(home.ok).toBe(true);
    if (home.ok) expect((home.data as { needsBind: boolean }).needsBind).toBe(true);
    expect(json(home)).not.toContain(ids.s1);
  });

  it('PX-17 a parent with no child is sent to bind and gets no data', async () => {
    const env = await harness();
    const result = await call(env, uid.p5, 'dashboard.parent', {});
    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as { needsBind: boolean; children: unknown[]; weekTasks: unknown[] };
      expect(data.needsBind).toBe(true);
      expect(data.children).toEqual([]);
      expect(data.weekTasks).toEqual([]);
    }
    assertNoForeign(result);
  });

  it('PX-18 a parent of two children cannot mix in the other class', async () => {
    const env = await harness();
    const home = await call(env, uid.p3, 'dashboard.parent', {});
    expect(home.ok).toBe(true);
    if (home.ok) {
      const data = home.data as { child: { studentId: string }; children: Array<{ studentId: string }> };
      expect(data.child.studentId).toBe(ids.s3);
      expect(data.children.map((child) => child.studentId).sort()).toEqual([ids.s3, ids.s4].sort());
    }
    const other = await call(env, uid.p3, 'dashboard.parent', { studentId: ids.s4 });
    expect(other.ok).toBe(true);
    if (other.ok) expect((other.data as { child: { studentId: string } }).child.studentId).toBe(ids.s4);
    const denied = await call(env, uid.p3, 'dashboard.parent', { studentId: ids.s1 });
    expect(denied.ok).toBe(false);
    const threads = await call(env, uid.p3, 'thread.listMine', {});
    expect(json(threads)).not.toContain(ids.s1);
    expect(json(threads)).not.toContain(ids.s2);
    assertNoForeign(home);
    assertNoForeign(other);
    assertNoForeign(threads);
  });

  it('PX-19 a shared project exposes only the other member display name', async () => {
    const env = await harness();
    const result = await call(env, uid.p1, 'casProject.get', { projectId: ids.project });
    expect(result.ok).toBe(true);
    const text = json(result);
    expect(text).toContain(canary.s2Name);
    expect(text).not.toContain(ids.s2);
    expect(text).not.toContain(canary.s2Cas);
    expect(text).not.toContain(canary.s2Reflection);
    expect(text).not.toContain(ids.expS2);
    assertNoForeign(result, [canary.s2Name]);
  });

  it('PX-20 mail for one student does not include another parent', async () => {
    const env = await harness();
    await emitNotification(
      {
        type: 'grade_released',
        studentId: ids.s1,
        refType: 'task',
        refId: ids.taskS1Released,
        importance: 'high',
        dedupeKey: `grade_released:${ids.taskS1Released}`,
        vars: {
          title: '科学测验',
          subject: '科学',
          comment: canary.s2Grade,
          score: '8',
          link: `/p/tasks/${ids.taskS1Released}?student=${ids.s1}`,
        },
        recipients: [
          { userId: ids.uS1, reason: 'student' },
          { userId: ids.p1, reason: 'guardian' },
          { userId: ids.p2, reason: 'guardian' },
          { userId: ids.p4, reason: 'guardian' },
        ],
      },
      { repo: new Repo(env.db), clock: { now: () => NOW }, fromAddress: MAIL_FROM, schoolId: ids.school },
    );
    const rows = await env.db.query(COLLECTIONS.outbox, () => true);
    const recipients = rows.map((row) => row.toUserId);
    expect(recipients).toContain(ids.p1);
    expect(recipients).toContain(ids.uS1);
    expect(recipients).not.toContain(ids.p2);
    expect(recipients).not.toContain(ids.p4);
    const blob = json(rows);
    expect(blob).not.toContain(canary.p2Email);
    expect(blob).not.toContain(canary.s2Grade);
    expect(blob).not.toContain('score');
    expect(rows.every((row) => row.from === MAIL_FROM && row.status === 'pending')).toBe(true);
    expect(rows.some((row) => row.channel === 'wechat_subscribe')).toBe(false);
  });

  it('PX-21 forged callerUserId and parentId are ignored', async () => {
    const env = await harness();
    const me = await call(env, uid.p1, 'me.get', { callerUserId: ids.p2, parentId: ids.a1, userId: ids.a1 });
    expect(me.ok).toBe(true);
    if (me.ok) expect((me.data as { user: { id: string } }).user.id).toBe(ids.p1);
    const denied = await call(env, uid.p1, 'progress.listByStudent', { studentId: ids.s2, callerUserId: ids.p2, parentId: ids.p2 });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error.code).toBe('NOT_FOUND');
    assertNoForeign(me);
    assertNoForeign(denied);
  });

  it('PX-22 released grades only, and staff-only messages stay hidden', async () => {
    const env = await harness();
    const grades = await call(env, uid.p1, 'assessment.listByStudent', { studentId: ids.s1, includeDraft: true });
    expect(grades.ok).toBe(true);
    const gradeText = json(grades);
    expect(gradeText).toContain('已发布评语');
    expect(gradeText).not.toContain(canary.s1Draft);
    expect(gradeText).not.toContain(canary.s1History);
    const messages = await call(env, uid.p1, 'message.list', { threadId: ids.threadS1 });
    expect(messages.ok).toBe(true);
    const messageText = json(messages);
    expect(messageText).toContain('家长可见留言');
    expect(messageText).not.toContain(canary.s1Staff);
    assertNoForeign(grades);
    assertNoForeign(messages);
  });

  it('keeps canary text out of audit records', async () => {
    const env = await harness();
    await call(env, uid.p1, 'task.get', { taskId: ids.taskS2Only, studentId: ids.s2 });
    await call(env, uid.p1, 'message.post', { threadId: ids.threadS2, body: canary.s2Grade });
    const audits = await env.db.query(COLLECTIONS.auditLogs, () => true);
    const text = json(audits);
    expect(text).not.toContain(canary.s2Grade);
    expect(text).not.toContain(canary.s1Staff);
    expect(text).not.toContain(canary.s2Cas);
  });

  it('ST-07 ops mailer cannot call a business action', async () => {
    const env = await harness();
    const result = await call(env, uid.ops, 'task.get', { taskId: ids.taskShared });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PERMISSION_DENIED');
  });

  it('a teacher without an assignment cannot read the roster', async () => {
    const env = await harness();
    const denied = await call(env, uid.t3, 'course.roster', { courseId: ids.courseSci });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error.code).toBe('NOT_FOUND');
    const allowed = await call(env, uid.t1, 'course.roster', { courseId: ids.courseSci });
    expect(allowed.ok).toBe(true);
    expect(json(allowed)).not.toContain('@');
    expect(json(allowed)).not.toContain(canary.s2Grade);
  });

  it('SX-03 a student without consent cannot call business APIs', async () => {
    const env = await harness();
    const blocked = await call(env, uid.minor, 'task.get', { taskId: ids.taskShared });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.error.code).toBe('CONSENT_REQUIRED');
      expect(blocked.error.details).toMatchObject({ studentIds: [ids.minor] });
    }
    assertNoForeign(blocked);
    const me = await call(env, uid.minor, 'me.get', {});
    expect(me.ok).toBe(true);
  });
});
