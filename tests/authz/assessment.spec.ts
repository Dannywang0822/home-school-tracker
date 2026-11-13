import { describe, expect, it } from 'vitest';
import { COLLECTIONS } from '@hst/shared';
import { canary, ids } from '@hst/fixture';
import { call, harness, json } from '../helpers.js';

const uid = { t1: 'uid_t1', t2: 'uid_t2', p1: 'uid_p1', s1: 'uid_s1' };

describe('IB assessment', () => {
  it('catalog.get returns MYP criteria, PP/CP, and DP components', async () => {
    const env = await harness();
    const result = await call(env, uid.s1, 'catalog.get', {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as {
      criteria: { groupCode: string; criterion: string }[];
      dpComponents: { subjectId: string; code: string }[];
    };
    const sci = data.criteria.filter((item) => item.groupCode === 'SCI').map((item) => item.criterion);
    expect(sci.sort()).toEqual(['A', 'B', 'C', 'D']);
    expect(data.criteria.filter((item) => item.groupCode === 'PP').map((item) => item.criterion).sort()).toEqual(['A', 'B', 'C']);
    expect(data.criteria.some((item) => item.groupCode === 'PP' && item.criterion === 'D')).toBe(false);
    expect(data.dpComponents.filter((item) => item.subjectId === ids.subjectPhy).map((item) => item.code).sort()).toEqual(['EA', 'IA', 'P1', 'P2', 'P3']);
  });

  it('TX-03 rejects a criterion that the task did not link', async () => {
    const env = await harness();
    const result = await call(env, uid.t1, 'assessment.save', {
      taskId: ids.taskS1Draft,
      studentId: ids.s1,
      myp: { D: { level: 5, comment: '不应该出现' } },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_ARGUMENT');
  });

  it('TX-04 rejects MYP level 9 and DP score 8', async () => {
    const env = await harness();
    const myp = await call(env, uid.t1, 'assessment.save', {
      taskId: ids.taskShared,
      studentId: ids.s1,
      myp: { A: { level: 9 } },
    });
    const dp = await call(env, uid.t2, 'assessment.save', {
      taskId: ids.taskS3,
      studentId: ids.s3,
      dp: { score: 8 },
    });
    expect(myp.ok).toBe(false);
    expect(dp.ok).toBe(false);
    if (!myp.ok) expect(myp.error.code).toBe('INVALID_ARGUMENT');
    if (!dp.ok) expect(dp.error.code).toBe('INVALID_ARGUMENT');
  });

  it('PX-22 and PX-06 hide drafts and another child', async () => {
    const env = await harness();
    const grades = await call(env, uid.p1, 'assessment.listByStudent', { studentId: ids.s1, includeDraft: true });
    expect(grades.ok).toBe(true);
    const text = json(grades);
    expect(text).toContain('已发布评语');
    expect(text).toContain('上学期总评');
    expect(text).not.toContain(canary.s1Draft);
    expect(text).not.toContain(canary.s1History);
    const other = await call(env, uid.p1, 'assessment.listByStudent', { studentId: ids.s2 });
    const summary = await call(env, uid.p1, 'summary.get', { studentId: ids.s2 });
    expect(other.ok).toBe(false);
    expect(summary.ok).toBe(false);
    if (!other.ok) expect(other.error.code).toBe('NOT_FOUND');
    if (!summary.ok) expect(summary.error.code).toBe('NOT_FOUND');
  });

  it('releases a complete draft, updates the summary, and notifies', async () => {
    const env = await harness();
    const saved = await call(env, uid.t1, 'assessment.save', {
      taskId: ids.taskShared,
      studentId: ids.s1,
      myp: { A: { level: 7, comment: '实验 A' }, B: { level: 6, comment: '实验 B' } },
      overallComment: '实验总评',
    });
    expect(saved.ok).toBe(true);
    const incomplete = await call(env, uid.t1, 'assessment.release', { taskId: ids.taskShared, all: true });
    expect(incomplete.ok).toBe(false);
    if (!incomplete.ok) expect(incomplete.error.code).toBe('FAILED_PRECONDITION');
    const released = await call(env, uid.t1, 'assessment.release', { taskId: ids.taskShared, studentIds: [ids.s1] });
    expect(released.ok).toBe(true);
    if (released.ok) expect(released.data).toEqual({ released: 1 });
    const parent = await call(env, uid.p1, 'task.get', { taskId: ids.taskShared, studentId: ids.s1 });
    expect(json(parent)).toContain('实验总评');
    expect(json(parent)).not.toContain(canary.s1Draft);
    const summary = await call(env, uid.p1, 'summary.get', { studentId: ids.s1 });
    expect(summary.ok).toBe(true);
    const growth = json(summary);
    expect(growth).toContain(ids.term);
    expect(growth).toContain(ids.termPrev);
    const progress = await env.db.get(COLLECTIONS.taskProgress, `${ids.taskShared}_${ids.s1}`);
    expect(progress?.status).toBe('graded');
    const notes = await env.db.query(COLLECTIONS.notifications, (doc) => doc.type === 'grade_released' && doc.studentId === ids.s1);
    expect(notes.length).toBeGreaterThan(0);
    const audits = await env.db.query(COLLECTIONS.auditLogs, (doc) => doc.action === 'assessment.release');
    expect(audits.length).toBe(1);
    const messages = await env.db.query(COLLECTIONS.messages, (doc) => doc.kind === 'teacher_comment' && doc.body === '实验总评');
    expect(messages.length).toBe(1);
  });

  it('updates a released grade and refuses to drop a linked criterion', async () => {
    const env = await harness();
    const updated = await call(env, uid.t1, 'assessment.update', {
      taskId: ids.taskS1Released,
      studentId: ids.s1,
      myp: { A: { level: 5, comment: '修订后' } },
      overallComment: '成绩已更新',
      version: 1,
    });
    expect(updated.ok).toBe(true);
    const audits = await env.db.query(COLLECTIONS.auditLogs, (doc) => doc.action === 'assessment.update_after_release');
    expect(audits.length).toBe(1);
    const parent = await call(env, uid.s1, 'assessment.listByStudent', { studentId: ids.s1 });
    expect(json(parent)).toContain('成绩已更新');
    expect(json(parent)).not.toContain(canary.s1Draft);
    const task = await env.db.get(COLLECTIONS.tasks, ids.taskS1Released);
    const stripped = await call(env, uid.t1, 'task.update', {
      taskId: ids.taskS1Released,
      version: task?.version ?? 1,
      assessment: { scheme: 'MYP', criteria: [] },
    });
    expect(stripped.ok).toBe(false);
    if (!stripped.ok) expect(stripped.error.code).toBe('FAILED_PRECONDITION');
  });

  it('lets the teacher override a term grade and read the criteria distribution', async () => {
    const env = await harness();
    const overridden = await call(env, uid.t1, 'summary.override', {
      studentId: ids.s1,
      subjectId: ids.subjectSci,
      termId: ids.term,
      grade: 5,
      comment: '老师调整',
    });
    expect(overridden.ok).toBe(true);
    const summary = await call(env, uid.p1, 'summary.get', { studentId: ids.s1 });
    expect(json(summary)).toContain('老师调整');
    const distribution = await call(env, uid.t1, 'criteria.distribution', { courseId: ids.courseSci });
    expect(distribution.ok).toBe(true);
    if (distribution.ok) {
      const counts = distribution.data as { A: Record<string, number> };
      expect(counts.A['6']).toBeGreaterThan(0);
    }
    const stranger = await call(env, uid.t2, 'criteria.distribution', { courseId: ids.courseSci });
    expect(stranger.ok).toBe(false);
    if (!stranger.ok) expect(stranger.error.code).toBe('NOT_FOUND');
  });
});

describe('median boundaries stay inside 1-7', () => {
  it('uses the published quiz and the previous term', async () => {
    const env = await harness();
    const summary = await call(env, uid.s1, 'summary.get', { studentId: ids.s1 });
    expect(summary.ok).toBe(true);
    if (!summary.ok) return;
    const data = summary.data as { growth: Record<string, { A?: { level: number }[] }> };
    const levels = (data.growth[ids.subjectSci]?.A ?? []).map((point) => point.level).sort();
    expect(levels).toEqual([4, 6]);
    expect(json(summary)).not.toContain(canary.s2Summary);
  });
});
