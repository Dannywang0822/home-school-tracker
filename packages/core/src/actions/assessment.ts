import { COLLECTIONS, FUNCTIONS } from '@hst/shared';
import { z } from 'zod';
import { ensureAssessmentCatalog } from '../assessment/catalog.js';
import { linkedCriteria, recomputeTermSummary, scoresComplete, taskScheme } from '../assessment/summary.js';
import { AppError } from '../app-error.js';
import { canReadStudentAcademic } from '../auth/access.js';
import { registerAction } from '../auth/registry.js';
import type { ActionContext } from '../auth/registry.js';
import type { Doc } from '../db/types.js';
import { emitNotification } from '../notify/emit.js';
import type { Repo } from '../repo.js';
import { asNumber, asString, asStringArray, isRecord, nid } from '../util.js';

const idSchema = z.string().min(1).max(80);
const mypCell = z.object({ level: z.number().int().min(0).max(8), comment: z.string().max(2000).optional() }).strip();
const scoreInput = z.object({
  taskId: idSchema,
  studentId: idSchema,
  myp: z.object({ A: mypCell.optional(), B: mypCell.optional(), C: mypCell.optional(), D: mypCell.optional() }).strip().optional(),
  dp: z.object({
    score: z.number().int().min(1).max(7),
    rawMark: z.number().min(0).max(1000).optional(),
    comment: z.string().max(2000).optional(),
    componentCode: z.enum(['IA', 'P1', 'P2', 'P3', 'EA']).optional(),
  }).strip().optional(),
  overallComment: z.string().max(4000).optional(),
  version: z.number().int().optional(),
}).strip();

registerAction({
  name: 'catalog.get',
  fn: FUNCTIONS.apiAcademic,
  roles: ['teacher', 'student', 'parent', 'admin', 'cas_coordinator', 'ee_coordinator', 'supervisor'],
  input: z.object({}).strip(),
  scope: async () => true,
  async handler(ctx) {
    await ensureAssessmentCatalog(ctx.repo, ctx.caller.schoolId, ctx.caller.userId, ctx.clock.now());
    const schoolId = ctx.caller.schoolId;
    const [subjects, criteria, dpComponents, terms, grades] = await Promise.all([
      ctx.repo.listSchool(COLLECTIONS.subjects, schoolId),
      ctx.repo.db.query(COLLECTIONS.assessmentCriteria, (doc) => doc.schoolId === schoolId && doc.deletedAt == null),
      ctx.repo.db.query(COLLECTIONS.dpComponents, (doc) => doc.schoolId === schoolId && doc.deletedAt == null),
      ctx.repo.listSchool(COLLECTIONS.terms, schoolId),
      ctx.repo.listSchool(COLLECTIONS.grades, schoolId),
    ]);
    return {
      subjects: subjects.map((doc) => ({ subjectId: doc._id, programme: doc.programme, groupCode: doc.groupCode, code: doc.code, name: doc.name })),
      criteria: criteria.map((doc) => ({
        id: doc._id,
        programme: doc.programme,
        groupCode: doc.groupCode,
        criterion: doc.criterion,
        title: doc.title,
        maxLevel: doc.maxLevel,
      })),
      dpComponents: dpComponents.map((doc) => ({
        id: doc._id,
        subjectId: doc.subjectId,
        code: doc.code,
        name: doc.name,
        type: doc.type,
        weightPct: doc.weightPct,
      })),
      terms: terms.map((doc) => ({ termId: doc._id, yearId: doc.yearId, name: doc.name, index: doc.index })),
      grades: grades.map((doc) => ({ gradeId: doc._id, programme: doc.programme, name: doc.name })),
    };
  },
});

registerAction({
  name: 'assessment.save',
  fn: FUNCTIONS.apiAcademic,
  roles: ['teacher'],
  input: scoreInput,
  scope: async (ctx, input) => teacherOwnsTask(ctx, input.taskId),
  async handler(ctx, input) {
    const task = await requireAssignedTask(ctx, input.taskId, input.studentId);
    const existing = await ctx.repo.db.get(COLLECTIONS.assessments, assessmentId(input.taskId, input.studentId));
    if (existing && existing.status === 'released') throw new AppError('FAILED_PRECONDITION', '当前状态不允许此操作');
    const stored = await writeScore(ctx, task, input, existing, 'draft');
    return { assessmentId: stored._id, status: 'draft', version: stored.version };
  },
});

registerAction({
  name: 'assessment.update',
  fn: FUNCTIONS.apiAcademic,
  roles: ['teacher'],
  input: scoreInput,
  scope: async (ctx, input) => teacherOwnsTask(ctx, input.taskId),
  async handler(ctx, input) {
    const task = await requireAssignedTask(ctx, input.taskId, input.studentId);
    const existing = await ctx.repo.db.get(COLLECTIONS.assessments, assessmentId(input.taskId, input.studentId));
    if (!existing || existing.status !== 'released') throw new AppError('FAILED_PRECONDITION', '当前状态不允许此操作');
    const stored = await writeScore(ctx, task, input, existing, 'released');
    await recomputeTermSummary(ctx.repo, summaryInput(ctx, task, input.studentId));
    await writeComment(ctx, task, input.studentId, commentBody(input, '成绩已更新'));
    await notifyGrade(ctx, task, input.studentId, stored._id, `grade:${stored._id}:update:${stored.version}`, '成绩已更新');
    await ctx.repo.appendAudit({
      at: ctx.clock.now(),
      actorUserId: ctx.caller.userId,
      actorRoles: ctx.caller.roles,
      action: 'assessment.update_after_release',
      targetType: 'assessment',
      targetId: stored._id,
      studentId: input.studentId,
      result: 'ok',
      requestId: ctx.requestId,
      client: ctx.caller.client,
      meta: { taskId: task._id },
    });
    return { version: stored.version };
  },
});

registerAction({
  name: 'assessment.release',
  fn: FUNCTIONS.apiAcademic,
  roles: ['teacher'],
  input: z.object({
    taskId: idSchema,
    studentIds: z.array(idSchema).max(200).optional(),
    all: z.boolean().optional(),
  }).strip(),
  scope: async (ctx, input) => teacherOwnsTask(ctx, input.taskId),
  async handler(ctx, input) {
    const task = await ctx.repo.getTask(input.taskId);
    if (!task || task.schoolId !== ctx.caller.schoolId) throw new AppError('NOT_FOUND', '资源不存在');
    const studentIds = await releaseTargets(ctx.repo, task, input.studentIds, input.all === true);
    if (studentIds.length === 0) throw new AppError('INVALID_ARGUMENT', '参数不正确');
    const pending = [];
    for (const studentId of studentIds) {
      const row = await ctx.repo.db.get(COLLECTIONS.assessments, assessmentId(task._id, studentId));
      if (!scoresComplete(task, row)) throw new AppError('FAILED_PRECONDITION', '还有草稿没打完分');
      pending.push({ studentId, row: row as Doc });
    }
    const now = ctx.clock.now();
    for (const item of pending) {
      await ctx.repo.db.compareAndSet(COLLECTIONS.assessments, item.row._id, asNumber(item.row.version), {
        status: 'released',
        releasedAt: now,
        gradedBy: ctx.caller.userId,
        updatedAt: now,
        updatedBy: ctx.caller.userId,
      });
      const progress = await ctx.repo.progressFor(task._id, item.studentId);
      if (progress) {
        await ctx.repo.db.compareAndSet(COLLECTIONS.taskProgress, progress._id, undefined, {
          status: 'graded',
          displayStatus: 'graded',
          gradedAt: now,
          isOverdue: false,
        });
      }
      await recomputeTermSummary(ctx.repo, summaryInput(ctx, task, item.studentId));
      await writeComment(ctx, task, item.studentId, commentBody(item.row, '成绩已发布'));
      await notifyGrade(ctx, task, item.studentId, item.row._id, `grade:${item.row._id}:release`, asString(task.title) ?? '');
      await ctx.repo.appendAudit({
        at: now,
        actorUserId: ctx.caller.userId,
        actorRoles: ctx.caller.roles,
        action: 'assessment.release',
        targetType: 'assessment',
        targetId: item.row._id,
        studentId: item.studentId,
        result: 'ok',
        requestId: ctx.requestId,
        client: ctx.caller.client,
        meta: { taskId: task._id },
      });
    }
    return { released: pending.length };
  },
});

registerAction({
  name: 'summary.override',
  fn: FUNCTIONS.apiAcademic,
  roles: ['teacher'],
  input: z.object({
    studentId: idSchema,
    subjectId: idSchema,
    termId: idSchema,
    grade: z.number().int().min(1).max(7),
    comment: z.string().max(2000),
  }).strip(),
  scope: async (ctx, input) => teachesSubject(ctx, input.studentId, input.subjectId),
  async handler(ctx, input) {
    const id = `${input.studentId}_${input.subjectId}_${input.termId}`;
    const existing = await ctx.repo.db.get(COLLECTIONS.termSummaries, id);
    if (!existing || existing.schoolId !== ctx.caller.schoolId) throw new AppError('NOT_FOUND', '资源不存在');
    const now = ctx.clock.now();
    await ctx.repo.db.compareAndSet(COLLECTIONS.termSummaries, id, undefined, {
      teacherOverride: { grade: input.grade, comment: input.comment, by: ctx.caller.userId, at: now },
      updatedAt: now,
      updatedBy: ctx.caller.userId,
    });
    await ctx.repo.appendAudit({
      at: now,
      actorUserId: ctx.caller.userId,
      actorRoles: ctx.caller.roles,
      action: 'summary.override',
      targetType: 'term_summary',
      targetId: id,
      studentId: input.studentId,
      result: 'ok',
      requestId: ctx.requestId,
      client: ctx.caller.client,
      meta: { subjectId: input.subjectId, termId: input.termId, grade: input.grade },
    });
    return { ok: true };
  },
});

registerAction({
  name: 'criteria.distribution',
  fn: FUNCTIONS.apiAcademic,
  roles: ['teacher'],
  input: z.object({ courseId: idSchema, termId: idSchema.optional(), taskId: idSchema.optional() }).strip(),
  scope: async (ctx, input) => canReadCourse(ctx, input.courseId),
  async handler(ctx, input) {
    const course = await ctx.repo.getCourse(input.courseId);
    if (!course) throw new AppError('NOT_FOUND', '资源不存在');
    const rows = await ctx.repo.db.query(
      COLLECTIONS.assessments,
      (doc) =>
        doc.deletedAt == null &&
        doc.schoolId === ctx.caller.schoolId &&
        doc.courseId === input.courseId &&
        doc.status === 'released' &&
        (!input.termId || doc.termId === input.termId) &&
        (!input.taskId || doc.taskId === input.taskId),
    );
    if (course.programme === 'DP') {
      const counts: Record<string, number> = {};
      for (let score = 1; score <= 7; score += 1) counts[String(score)] = 0;
      for (const doc of rows) {
        const score = isRecord(doc.dp) ? asNumber(doc.dp.score) : undefined;
        if (score != null && counts[String(score)] != null) counts[String(score)] += 1;
      }
      return counts;
    }
    const counts: Record<string, Record<string, number>> = {};
    for (const key of ['A', 'B', 'C', 'D']) {
      counts[key] = {};
      for (let level = 0; level <= 8; level += 1) counts[key][String(level)] = 0;
    }
    for (const doc of rows) {
      if (!isRecord(doc.myp)) continue;
      for (const key of ['A', 'B', 'C', 'D']) {
        const cell = doc.myp[key];
        const level = isRecord(cell) ? asNumber(cell.level) : undefined;
        const bucket = counts[key];
        if (level != null && bucket && bucket[String(level)] != null) bucket[String(level)] += 1;
      }
    }
    return counts;
  },
});

function assessmentId(taskId: string, studentId: string): string {
  return `${taskId}_${studentId}`;
}

async function teacherOwnsTask(ctx: ActionContext, taskId: string): Promise<boolean> {
  const task = await ctx.repo.getTask(taskId);
  const courseId = asString(task?.courseId);
  if (!task || task.schoolId !== ctx.caller.schoolId || !courseId) return false;
  return ctx.repo.teachesCourse(ctx.caller.userId, courseId, ctx.caller.schoolId, ctx.clock.now());
}

async function requireAssignedTask(ctx: ActionContext, taskId: string, studentId: string): Promise<Doc> {
  const task = await ctx.repo.getTask(taskId);
  const progress = await ctx.repo.progressFor(taskId, studentId);
  if (!task || !progress || progress.schoolId !== ctx.caller.schoolId) throw new AppError('NOT_FOUND', '资源不存在');
  return task;
}

async function writeScore(
  ctx: ActionContext,
  task: Doc,
  input: z.infer<typeof scoreInput>,
  existing: Doc | null,
  status: 'draft' | 'released',
): Promise<Doc> {
  const scheme = taskScheme(task);
  if (!scheme) throw new AppError('INVALID_ARGUMENT', '参数不正确', { fields: { assessment: '任务未设置评分' } });
  if (scheme === 'MYP' && input.dp) throw new AppError('INVALID_ARGUMENT', '参数不正确', { fields: { dp: '此任务使用 MYP 标准' } });
  if (scheme === 'DP' && input.myp) throw new AppError('INVALID_ARGUMENT', '参数不正确', { fields: { myp: '此任务使用 DP 分数' } });
  if (scheme === 'MYP' && input.myp) {
    const allowed = new Set(linkedCriteria(task));
    for (const key of Object.keys(input.myp)) {
      if (!allowed.has(key)) throw new AppError('INVALID_ARGUMENT', '参数不正确', { fields: { [key]: '任务未关联该标准' } });
    }
  }
  if (existing && input.version != null && existing.version !== input.version) {
    throw new AppError('CONFLICT', '数据已更新，请刷新后重试');
  }
  const now = ctx.clock.now();
  const subject = await ctx.repo.db.get(COLLECTIONS.subjects, asString(task.subjectId) ?? '');
  const myp = scheme === 'MYP' ? { ...(isRecord(existing?.myp) ? existing.myp : {}), ...(input.myp ?? {}) } : undefined;
  const dp = scheme === 'DP' ? (input.dp ?? (isRecord(existing?.dp) ? existing.dp : undefined)) : undefined;
  const overallComment = input.overallComment ?? (typeof existing?.overallComment === 'string' ? existing.overallComment : '');
  const id = assessmentId(task._id, input.studentId);
  if (!existing) {
    const created: Doc = {
      _id: id,
      schoolId: ctx.caller.schoolId,
      taskId: task._id,
      studentId: input.studentId,
      courseId: task.courseId,
      subjectId: task.subjectId,
      termId: task.termId,
      yearId: task.yearId,
      scheme,
      subject: subjectName(subject),
      taskTitle: task.title,
      myp,
      dp,
      overallComment,
      status,
      version: 1,
      history: [],
      createdAt: now,
      createdBy: ctx.caller.userId,
      updatedAt: now,
      updatedBy: ctx.caller.userId,
      schemaVersion: 1,
    };
    await ctx.repo.db.insert(COLLECTIONS.assessments, created);
    return created;
  }
  const history = Array.isArray(existing.history) ? existing.history.slice(-19) : [];
  history.push({ at: now, by: ctx.caller.userId, diff: status === 'released' ? 'update' : 'draft' });
  const updated = await ctx.repo.db.compareAndSet(COLLECTIONS.assessments, id, asNumber(existing.version), {
    myp,
    dp,
    overallComment,
    status,
    subject: subjectName(subject),
    taskTitle: task.title,
    history,
    updatedAt: now,
    updatedBy: ctx.caller.userId,
  });
  if (!updated.ok) throw new AppError(updated.reason === 'conflict' ? 'CONFLICT' : 'NOT_FOUND', updated.reason === 'conflict' ? '数据已更新，请刷新后重试' : '资源不存在');
  return updated.doc;
}

function subjectName(subject: Doc | null): string {
  if (!subject || !isRecord(subject.name)) return asString(subject?.code) ?? '';
  return asString(subject.name.zh) ?? asString(subject.code) ?? '';
}

function commentBody(source: unknown, fallback: string): string {
  if (!isRecord(source)) return fallback;
  const comment = source.overallComment;
  return typeof comment === 'string' && comment.trim() ? comment.trim() : fallback;
}

async function writeComment(ctx: ActionContext, task: Doc, studentId: string, body: string): Promise<void> {
  const now = ctx.clock.now();
  const found = await ctx.repo.db.query(
    COLLECTIONS.threads,
    (doc) => doc.deletedAt == null && doc.contextType === 'task' && doc.contextId === task._id && doc.studentId === studentId,
  );
  let thread = found[0];
  if (!thread) {
    thread = {
      _id: `task_${task._id}_${studentId}`,
      schoolId: ctx.caller.schoolId,
      contextType: 'task',
      contextId: task._id,
      studentId,
      staffUserIds: [ctx.caller.userId],
      lastMessageAt: now,
      lastMessagePreview: body.slice(0, 60),
      messageCount: 0,
      createdAt: now,
      createdBy: ctx.caller.userId,
      updatedAt: now,
      updatedBy: ctx.caller.userId,
      schemaVersion: 1,
    };
    await ctx.repo.db.insert(COLLECTIONS.threads, thread);
  }
  await ctx.repo.insertMessage({
    _id: nid('msg_'),
    schoolId: ctx.caller.schoolId,
    threadId: thread._id,
    studentId,
    authorId: ctx.caller.userId,
    authorRole: 'teacher',
    kind: 'teacher_comment',
    body,
    visibility: 'all',
    createdAt: now,
    schemaVersion: 1,
  });
  const staff = new Set([...asStringArray(thread.staffUserIds), ctx.caller.userId]);
  await ctx.repo.db.compareAndSet(COLLECTIONS.threads, thread._id, undefined, {
    staffUserIds: [...staff],
    lastMessageAt: now,
    lastMessagePreview: body.slice(0, 60),
    messageCount: (asNumber(thread.messageCount) ?? 0) + 1,
    updatedAt: now,
  });
}

async function notifyGrade(ctx: ActionContext, task: Doc, studentId: string, assessmentRowId: string, dedupeKey: string, title: string): Promise<void> {
  const subject = await ctx.repo.db.get(COLLECTIONS.subjects, asString(task.subjectId) ?? '');
  await emitNotification(
    {
      type: 'grade_released',
      studentId,
      refType: 'assessment',
      refId: assessmentRowId,
      importance: 'high',
      dedupeKey,
      link: `/p/tasks/${task._id}?student=${studentId}`,
      vars: {
        title,
        taskTitle: asString(task.title) ?? '',
        subject: subjectName(subject),
        link: `/p/tasks/${task._id}?student=${studentId}`,
      },
    },
    { repo: ctx.repo, clock: ctx.clock, fromAddress: ctx.config.mailFrom, schoolId: ctx.caller.schoolId },
  );
}

function summaryInput(ctx: ActionContext, task: Doc, studentId: string) {
  return {
    schoolId: ctx.caller.schoolId,
    studentId,
    subjectId: asString(task.subjectId) ?? '',
    termId: asString(task.termId) ?? '',
    yearId: asString(task.yearId) ?? '',
    scheme: taskScheme(task) ?? 'MYP',
    actorId: ctx.caller.userId,
    now: ctx.clock.now(),
  };
}

async function releaseTargets(repo: Repo, task: Doc, studentIds: string[] | undefined, all: boolean): Promise<string[]> {
  const progress = await repo.db.query(COLLECTIONS.taskProgress, (doc) => doc.taskId === task._id && doc.schoolId === task.schoolId);
  const assigned = new Set(progress.map((doc) => asString(doc.studentId)).filter((id): id is string => Boolean(id)));
  if (all) return [...assigned];
  if (!studentIds?.length) return [];
  if (studentIds.some((studentId) => !assigned.has(studentId))) throw new AppError('NOT_FOUND', '资源不存在');
  return studentIds;
}

async function teachesSubject(ctx: ActionContext, studentId: string, subjectId: string): Promise<boolean> {
  if (!(await canReadStudentAcademic(ctx, studentId))) return false;
  const courseIds = await ctx.repo.courseIdsForTeacher(ctx.caller.userId, ctx.caller.schoolId, ctx.clock.now());
  for (const courseId of courseIds) {
    const course = await ctx.repo.getCourse(courseId);
    if (course?.subjectId !== subjectId) continue;
    const roster = await ctx.repo.listRoster(courseId, ctx.caller.schoolId);
    if (roster.some((student) => student._id === studentId)) return true;
  }
  return false;
}

async function canReadCourse(ctx: ActionContext, courseId: string): Promise<boolean> {
  const course = await ctx.repo.getCourse(courseId);
  if (!course || course.schoolId !== ctx.caller.schoolId) return false;
  if (await ctx.repo.teachesCourse(ctx.caller.userId, courseId, ctx.caller.schoolId, ctx.clock.now())) return true;
  const classId = asString(course.homeroomClassId);
  if (!classId) return false;
  const homeroom = await ctx.repo.getClass(classId);
  return asStringArray(homeroom?.homeroomTeacherIds).includes(ctx.caller.userId);
}
