import { describe, expect, it } from 'vitest';
import { COLLECTIONS } from '@hst/shared';
import { Repo, markOverdue, publishDueTasks } from '@hst/core';
import { canary, ids, NOW } from '@hst/fixture';
import { call, harness, json } from '../helpers.js';

const future = NOW + 3 * 24 * 60 * 60 * 1000;

async function publishClassTask(env: Awaited<ReturnType<typeof harness>>, extra: Record<string, unknown> = {}) {
  return call(env, 'uid_t1', 'task.create', {
    courseId: ids.courseSci,
    type: 'homework',
    title: '本周实验',
    description: '请记录现象',
    dueAt: future,
    requiresSubmission: true,
    allowLate: true,
    publish: true,
    ...extra,
  });
}

describe('task publish and attachments', () => {
  it('shows a published task to the student and parent immediately', async () => {
    const env = await harness();
    const created = await publishClassTask(env);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const taskId = (created.data as { taskId: string }).taskId;
    const student = await call(env, 'uid_s1', 'task.listMine', { range: 'all' });
    const parent = await call(env, 'uid_p1', 'task.listForChild', { studentId: ids.s1, range: 'all' });
    expect(json(student)).toContain('本周实验');
    expect(json(parent)).toContain('本周实验');
    expect(json(student)).toContain(taskId);
    const detail = await call(env, 'uid_p1', 'task.get', { taskId, studentId: ids.s1 });
    expect(detail.ok).toBe(true);
  });

  it('hides a task assigned to another child, including its canary text', async () => {
    const env = await harness();
    const created = await publishClassTask(env, {
      title: '只给二号',
      description: canary.s2Grade,
      assigneeStudentIds: [ids.s2],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const taskId = (created.data as { taskId: string }).taskId;
    for (const [uid, action, data] of [
      ['uid_p1', 'task.get', { taskId, studentId: ids.s2 }],
      ['uid_p1', 'task.listForChild', { studentId: ids.s2 }],
      ['uid_s1', 'task.get', { taskId }],
      ['uid_p1', 'submission.list', { taskId, studentId: ids.s2 }],
      ['uid_t2', 'task.listForCourse', { courseId: ids.courseSci }],
      ['uid_p1', 'progress.listForTask', { taskId }],
    ] as const) {
      const result = await call(env, uid, action, data);
      expect(result.ok, action).toBe(false);
      expect(json(result)).not.toContain(canary.s2Grade);
      expect(json(result)).not.toContain('只给二号');
    }
    const owner = await call(env, 'uid_p2', 'task.listForChild', { studentId: ids.s2, range: 'all' });
    expect(json(owner)).toContain('只给二号');
    const mine = await call(env, 'uid_s1', 'task.listMine', { range: 'all' });
    expect(json(mine)).not.toContain(canary.s2Grade);
  });

  it('publishes scheduled tasks on the minute runner and does not notify while marking overdue', async () => {
    const env = await harness();
    const created = await call(env, 'uid_t1', 'task.create', {
      courseId: ids.courseSci,
      type: 'homework',
      title: '定时实验',
      dueAt: future,
      publishAt: NOW + 60_000,
      requiresSubmission: false,
      allowLate: true,
      publish: true,
    });
    expect(created.ok).toBe(true);
    const before = json(await call(env, 'uid_s1', 'task.listMine', { range: 'all' }));
    expect(before).not.toContain('定时实验');
    const repo = new Repo(env.db);
    const published = await publishDueTasks(repo, NOW + 60_000);
    expect(published.published.length).toBe(1);
    expect(json(await call(env, 'uid_s1', 'task.listMine', { range: 'all' }))).toContain('定时实验');

    const open = await publishClassTask(env, { title: '将逾期', dueAt: future, requiresSubmission: false });
    expect(open.ok).toBe(true);
    if (!open.ok) return;
    const taskId = (open.data as { taskId: string }).taskId;
    const progress = await env.db.query(COLLECTIONS.taskProgress, (doc) => doc.taskId === taskId && doc.studentId === ids.s1);
    await env.db.compareAndSet(COLLECTIONS.taskProgress, progress[0]!._id, undefined, {
      dueAt: NOW - 60_000,
      status: 'not_started',
      displayStatus: 'not_started',
      isOverdue: false,
    });
    const notices = await env.db.count(COLLECTIONS.notifications);
    const scan = await markOverdue(repo, NOW);
    expect(scan.updated).toBeGreaterThan(0);
    expect(await env.db.count(COLLECTIONS.notifications)).toBe(notices);
    const row = await env.db.get(COLLECTIONS.taskProgress, progress[0]!._id);
    expect(row?.isOverdue).toBe(true);
    expect(row?.displayStatus).toBe('overdue');
  });

  it('copies an upload into the vault and refuses another family the link', async () => {
    const env = await harness();
    const created = await publishClassTask(env, { title: '需要附件' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const taskId = (created.data as { taskId: string }).taskId;
    const body = new TextEncoder().encode('lab-note');
    const tmp = 'hst_tmp/20261109/note';
    await env.storage.put(tmp, { body, mime: 'application/pdf' });
    const committed = await call(env, 'uid_s1', 'file.commit', {
      tmpCloudFileId: tmp,
      name: 'note.pdf',
      mime: 'application/pdf',
      size: body.byteLength,
      refType: 'submission',
      refId: taskId,
    });
    expect(committed.ok).toBe(true);
    if (!committed.ok) return;
    const fileId = (committed.data as { fileId: string }).fileId;
    expect(json(committed)).not.toContain('hst_vault/');
    expect(await env.storage.get(tmp)).toBeNull();
    const stored = await env.db.get(COLLECTIONS.files, fileId);
    expect(String(stored?.cloudFileId)).toMatch(/^hst_vault\//);
    const own = await call(env, 'uid_s1', 'file.getUrl', { fileId });
    expect(own.ok).toBe(true);
    if (own.ok) expect(String((own.data as { url: string }).url)).toContain('/api/dev/files/');
    expect(json(own)).not.toContain('hst_vault/');
    const other = await call(env, 'uid_p2', 'file.getUrl', { fileId });
    expect(other.ok).toBe(false);
    if (!other.ok) expect(other.error.code).toBe('NOT_FOUND');
    expect(json(other)).not.toContain('hst_vault/');
    expect(json(other)).not.toContain('note.pdf');
    const badType = await call(env, 'uid_s1', 'file.commit', {
      tmpCloudFileId: 'hst_tmp/../hst_vault/secret',
      name: 'x.exe',
      mime: 'application/x-msdownload',
      size: 4,
      refType: 'submission',
      refId: taskId,
    });
    expect(badType.ok).toBe(false);
  });

  it('keeps unpublished tasks and unconsented students out', async () => {
    const env = await harness();
    const draft = await call(env, 'uid_t1', 'task.create', {
      courseId: ids.courseSci,
      type: 'quiz',
      title: '草稿测验',
      dueAt: future,
      requiresSubmission: false,
      allowLate: true,
      publish: false,
    });
    expect(draft.ok).toBe(true);
    expect(json(await call(env, 'uid_s1', 'task.listMine', { range: 'all' }))).not.toContain('草稿测验');
    const blocked = await call(env, 'uid_minor', 'task.listMine', { range: 'all' });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error.code).toBe('CONSENT_REQUIRED');
    expect(json(blocked)).not.toContain('本周实验');
    const foreignCourse = await call(env, 'uid_t1', 'task.create', {
      courseId: ids.coursePhy,
      type: 'homework',
      title: canary.s2Week,
      dueAt: future,
      requiresSubmission: false,
      allowLate: true,
      publish: true,
    });
    expect(foreignCourse.ok).toBe(false);
    if (!foreignCourse.ok) expect(foreignCourse.error.code).toBe('NOT_FOUND');
    expect(json(foreignCourse)).not.toContain(canary.s2Week);
  });
});
