import { COLLECTIONS, FUNCTIONS } from '@hst/shared';
import { z } from 'zod';
import { AppError } from '../app-error.js';
import { activeChildIds, displayNameOf, projectProgress, projectTask } from '../auth/access.js';
import { registerAction } from '../auth/registry.js';
import type { Doc } from '../db/types.js';
import type { Repo } from '../repo.js';
import { enrolledStudentIds, publishTask, refreshTaskStats } from '../tasks/lifecycle.js';
import { asProgressStatus, canMarkDone, canStart, canSubmit } from '../tasks/progress.js';
import { asNumber, asString, asStringArray, nid } from '../util.js';

const idSchema = z.string().min(1).max(80);
const taskType = z.enum(['homework', 'project', 'quiz', 'formative', 'summative', 'ia_component']);

const createInput = z.object({
  courseId: idSchema,
  type: taskType,
  title: z.string().min(1).max(120),
  description: z.string().max(10_000).optional(),
  dueAt: z.number(),
  publishAt: z.number().optional(),
  requiresSubmission: z.boolean(),
  allowLate: z.boolean(),
  assessment: z
    .object({
      scheme: z.enum(['MYP', 'DP']),
      criteria: z.array(z.enum(['A', 'B', 'C', 'D'])).max(4).optional(),
      componentCode: z.string().max(20).optional(),
    })
    .optional(),
  attachmentIds: z.array(idSchema).max(10).optional(),
  assigneeStudentIds: z.array(idSchema).max(200).optional(),
  publish: z.boolean(),
}).strip();

registerAction({
  name: 'task.create',
  fn: FUNCTIONS.apiAcademic,
  roles: ['teacher'],
  input: createInput,
  scope: async (ctx, input) => ctx.repo.teachesCourse(ctx.caller.userId, input.courseId, ctx.caller.schoolId, ctx.clock.now()),
  async handler(ctx, input) {
    const course = await ctx.repo.getCourse(input.courseId);
    if (!course || course.schoolId !== ctx.caller.schoolId) throw new AppError('NOT_FOUND', '资源不存在');
    const publishAt = input.publishAt ?? (input.publish ? ctx.clock.now() : undefined);
    if (publishAt != null && input.dueAt <= publishAt) throw new AppError('INVALID_ARGUMENT', '参数不正确', { fields: { dueAt: '必须晚于发布时间' } });
    if (input.assessment?.scheme === 'MYP' && (input.assessment.criteria?.length ?? 0) === 0) {
      throw new AppError('INVALID_ARGUMENT', '参数不正确', { fields: { criteria: '请选择标准' } });
    }
    const enrolled = new Set(await enrolledStudentIds(ctx.repo, input.courseId, ctx.caller.schoolId));
    if (input.assigneeStudentIds?.some((studentId) => !enrolled.has(studentId))) throw new AppError('NOT_FOUND', '资源不存在');
    const now = ctx.clock.now();
    const taskId = nid('tsk_');
    let status: 'draft' | 'scheduled' | 'published' = 'draft';
    if (input.publish) status = publishAt != null && publishAt > now ? 'scheduled' : 'published';
    const task: Doc = {
      _id: taskId,
      schoolId: ctx.caller.schoolId,
      courseId: input.courseId,
      subjectId: course.subjectId,
      programme: course.programme,
      termId: undefined,
      yearId: course.yearId,
      type: input.type,
      title: input.title,
      description: input.description ?? '',
      attachmentIds: input.attachmentIds ?? [],
      dueAt: input.dueAt,
      publishAt,
      status,
      requiresSubmission: input.requiresSubmission,
      allowLate: input.allowLate,
      assessment: input.assessment ?? null,
      assigneeMode: input.assigneeStudentIds?.length ? 'subset' : 'all',
      assigneeStudentIds: input.assigneeStudentIds,
      stats: { assigned: 0, notStarted: 0, inProgress: 0, submitted: 0, graded: 0, overdue: 0 },
      version: 1,
      createdAt: now,
      createdBy: ctx.caller.userId,
      updatedAt: now,
      updatedBy: ctx.caller.userId,
      schemaVersion: 1,
    };
    await ctx.repo.db.insert(COLLECTIONS.tasks, task);
    if (status === 'published') {
      await publishTask(ctx.repo, task, ctx.caller.userId, now);
      await ctx.repo.appendAudit({
        at: now,
        actorUserId: ctx.caller.userId,
        actorRoles: ctx.caller.roles,
        action: 'task.publish',
        targetType: 'task',
        targetId: taskId,
        result: 'ok',
        requestId: ctx.requestId,
        client: ctx.caller.client,
        meta: { courseId: input.courseId },
      });
    }
    return { taskId, status };
  },
});

registerAction({
  name: 'task.update',
  fn: FUNCTIONS.apiAcademic,
  roles: ['teacher'],
  input: z.object({
    taskId: idSchema,
    version: z.number().int(),
    title: z.string().min(1).max(120).optional(),
    description: z.string().max(10_000).optional(),
    dueAt: z.number().optional(),
    allowLate: z.boolean().optional(),
    attachmentIds: z.array(idSchema).max(10).optional(),
    assessment: z.object({
      scheme: z.enum(['MYP', 'DP']),
      criteria: z.array(z.enum(['A', 'B', 'C', 'D'])).max(4).optional(),
      componentCode: z.string().max(20).optional(),
    }).optional(),
  }).strip(),
  scope: async (ctx, input) => teacherOwnsTask(ctx.repo, ctx.caller.userId, ctx.caller.schoolId, input.taskId, ctx.clock.now()),
  async handler(ctx, input) {
    const task = await ctx.repo.getTask(input.taskId);
    if (!task) throw new AppError('NOT_FOUND', '资源不存在');
    const patch: Doc = { updatedAt: ctx.clock.now(), updatedBy: ctx.caller.userId, _id: task._id };
    if (input.title) patch.title = input.title;
    if (input.description != null) patch.description = input.description;
    if (input.allowLate != null) patch.allowLate = input.allowLate;
    if (input.attachmentIds) patch.attachmentIds = input.attachmentIds;
    if (input.dueAt != null) patch.dueAt = input.dueAt;
    if (input.assessment) {
      const current = task.assessment;
      const previous = current && typeof current === 'object' && Array.isArray((current as { criteria?: unknown }).criteria)
        ? ((current as { criteria: string[] }).criteria)
        : [];
      const next = new Set<string>(input.assessment.criteria ?? []);
      const removed = previous.filter((item) => !next.has(item));
      if (removed.length > 0) {
        const released = await ctx.repo.db.query(
          COLLECTIONS.assessments,
          (doc) => doc.taskId === task._id && doc.status === 'released' && doc.deletedAt == null,
        );
        if (released.length > 0) throw new AppError('FAILED_PRECONDITION', '已经发布成绩，不能去掉关联的标准');
      }
      patch.assessment = input.assessment;
    }
    const updated = await ctx.repo.db.compareAndSet(COLLECTIONS.tasks, task._id, input.version, patch);
    if (!updated.ok) throw new AppError(updated.reason === 'conflict' ? 'CONFLICT' : 'NOT_FOUND', updated.reason === 'conflict' ? '数据已更新，请刷新后重试' : '资源不存在');
    if (input.dueAt != null) {
      const rows = await ctx.repo.db.query(COLLECTIONS.taskProgress, (doc) => doc.taskId === task._id);
      for (const row of rows) {
        const open = row.status === 'not_started' || row.status === 'in_progress';
        const overdue = open && input.dueAt < ctx.clock.now();
        await ctx.repo.db.compareAndSet(COLLECTIONS.taskProgress, row._id, undefined, {
          dueAt: input.dueAt,
          isOverdue: overdue,
          displayStatus: overdue ? 'overdue' : row.status,
        });
      }
    }
    const fresh = await ctx.repo.getTask(task._id);
    return { task: fresh ? projectTask(fresh) : null };
  },
});

for (const actionName of ['task.publish', 'task.close', 'task.archive'] as const) {
  const nextStatus = actionName === 'task.publish' ? 'published' : actionName === 'task.close' ? 'closed' : 'archived';
  registerAction({
    name: actionName,
    fn: FUNCTIONS.apiAcademic,
    roles: ['teacher'],
    input: z.object({ taskId: idSchema }).strip(),
    scope: async (ctx, input) => teacherOwnsTask(ctx.repo, ctx.caller.userId, ctx.caller.schoolId, input.taskId, ctx.clock.now()),
    async handler(ctx, input) {
      const task = await ctx.repo.getTask(input.taskId);
      if (!task) throw new AppError('NOT_FOUND', '资源不存在');
      if (actionName === 'task.publish') {
        await publishTask(ctx.repo, task, ctx.caller.userId, ctx.clock.now());
        await ctx.repo.appendAudit({
          at: ctx.clock.now(),
          actorUserId: ctx.caller.userId,
          actorRoles: ctx.caller.roles,
          action: 'task.publish',
          targetType: 'task',
          targetId: task._id,
          result: 'ok',
          requestId: ctx.requestId,
          client: ctx.caller.client,
          meta: { courseId: task.courseId },
        });
        return { status: 'published' };
      }
      const updated = await ctx.repo.db.compareAndSet(COLLECTIONS.tasks, task._id, asNumber(task.version), {
        status: nextStatus,
        updatedAt: ctx.clock.now(),
        updatedBy: ctx.caller.userId,
      });
      if (!updated.ok) throw new AppError('CONFLICT', '数据已更新，请刷新后重试');
      return { status: nextStatus };
    },
  });
}

registerAction({
  name: 'task.listForCourse',
  fn: FUNCTIONS.apiAcademic,
  roles: ['teacher', 'admin'],
  input: z.object({ courseId: idSchema, status: z.string().max(20).optional() }).strip(),
  scope: async (ctx, input) => {
    const course = await ctx.repo.getCourse(input.courseId);
    if (!course || course.schoolId !== ctx.caller.schoolId) return false;
    if (ctx.caller.roles.includes('admin')) return true;
    return ctx.repo.teachesCourse(ctx.caller.userId, input.courseId, ctx.caller.schoolId, ctx.clock.now());
  },
  async handler(ctx, input) {
    const rows = await ctx.repo.db.query(
      COLLECTIONS.tasks,
      (doc) => doc.courseId === input.courseId && doc.schoolId === ctx.caller.schoolId && doc.deletedAt == null && (!input.status || doc.status === input.status),
    );
    rows.sort((a, b) => (asNumber(a.dueAt) ?? 0) - (asNumber(b.dueAt) ?? 0));
    return { items: rows.map((doc) => ({ ...projectTask(doc), stats: doc.stats ?? {}, version: doc.version })) };
  },
});

registerAction({
  name: 'task.listMine',
  fn: FUNCTIONS.apiAcademic,
  roles: ['student'],
  input: z.object({ range: z.enum(['week', 'all', 'overdue', 'graded']).optional(), subjectId: idSchema.optional() }).strip(),
  scope: async () => true,
  async handler(ctx, input) {
    const self = await ctx.repo.findStudentByUserId(ctx.caller.userId);
    if (!self) return { items: [] };
    return { items: await tasksForStudent(ctx.repo, self._id, ctx.caller.schoolId, input.range ?? 'all', input.subjectId, ctx.clock.now()) };
  },
});

registerAction({
  name: 'task.listForChild',
  fn: FUNCTIONS.apiAcademic,
  roles: ['parent'],
  input: z.object({ studentId: idSchema, range: z.enum(['week', 'all', 'overdue', 'graded']).optional(), subjectId: idSchema.optional() }).strip(),
  scope: async (ctx, input) => (await activeChildIds(ctx)).includes(input.studentId),
  async handler(ctx, input) {
    return { items: await tasksForStudent(ctx.repo, input.studentId, ctx.caller.schoolId, input.range ?? 'all', input.subjectId, ctx.clock.now()) };
  },
});

registerAction({
  name: 'progress.listForTask',
  fn: FUNCTIONS.apiAcademic,
  roles: ['teacher'],
  input: z.object({ taskId: idSchema, displayStatus: z.string().max(20).optional() }).strip(),
  scope: async (ctx, input) => teacherOwnsTask(ctx.repo, ctx.caller.userId, ctx.caller.schoolId, input.taskId, ctx.clock.now()),
  async handler(ctx, input) {
    let rows = await ctx.repo.db.query(COLLECTIONS.taskProgress, (doc) => doc.taskId === input.taskId && doc.schoolId === ctx.caller.schoolId);
    if (input.displayStatus) rows = rows.filter((doc) => doc.displayStatus === input.displayStatus);
    const items = [];
    for (const row of rows) {
      const student = await ctx.repo.getStudent(asString(row.studentId) ?? '');
      const user = student ? await ctx.repo.getUser(asString(student.userId) ?? '') : null;
      const grade = await ctx.repo.db.get(COLLECTIONS.assessments, `${input.taskId}_${asString(row.studentId) ?? ''}`);
      items.push({
        studentId: row.studentId,
        displayName: displayNameOf(user),
        ...projectProgress(row),
        assessmentStatus: grade?.status === 'released' || grade?.status === 'draft' ? grade.status : 'none',
      });
    }
    return { items };
  },
});

registerAction({
  name: 'progress.start',
  fn: FUNCTIONS.apiAcademic,
  roles: ['student'],
  input: z.object({ taskId: idSchema }).strip(),
  scope: async (ctx, input) => studentAssigned(ctx.repo, ctx.caller.userId, input.taskId),
  async handler(ctx, input) {
    const progress = await ownProgress(ctx.repo, ctx.caller.userId, input.taskId);
    if (!progress) throw new AppError('NOT_FOUND', '资源不存在');
    const status = asProgressStatus(progress.status);
    if (!canStart({ status, requiresSubmission: true })) throw new AppError('FAILED_PRECONDITION', '当前状态不允许此操作');
    if (status === 'not_started') {
      await ctx.repo.db.compareAndSet(COLLECTIONS.taskProgress, progress._id, undefined, {
        status: 'in_progress',
        displayStatus: progress.isOverdue === true ? 'overdue' : 'in_progress',
        startedAt: ctx.clock.now(),
      });
    }
    return { displayStatus: progress.isOverdue === true ? 'overdue' : 'in_progress' };
  },
});

registerAction({
  name: 'progress.markDone',
  fn: FUNCTIONS.apiAcademic,
  roles: ['student'],
  input: z.object({ taskId: idSchema }).strip(),
  scope: async (ctx, input) => studentAssigned(ctx.repo, ctx.caller.userId, input.taskId),
  async handler(ctx, input) {
    const task = await ctx.repo.getTask(input.taskId);
    const progress = await ownProgress(ctx.repo, ctx.caller.userId, input.taskId);
    if (!task || !progress || task.status !== 'published') throw new AppError('NOT_FOUND', '资源不存在');
    const gate = { status: asProgressStatus(progress.status), requiresSubmission: task.requiresSubmission !== false };
    if (!canMarkDone(gate)) throw new AppError('FAILED_PRECONDITION', '当前状态不允许此操作');
    if (task.allowLate !== true && ctx.clock.now() > (asNumber(task.dueAt) ?? 0)) throw new AppError('DEADLINE_PASSED', '已过截止时间');
    await ctx.repo.db.compareAndSet(COLLECTIONS.taskProgress, progress._id, undefined, {
      status: 'submitted',
      displayStatus: 'submitted',
      isOverdue: false,
      markedDoneAt: ctx.clock.now(),
    });
    await refreshTaskStats(ctx.repo, task._id, ctx.clock.now());
    return { displayStatus: 'submitted' };
  },
});

registerAction({
  name: 'submission.create',
  fn: FUNCTIONS.apiAcademic,
  roles: ['student'],
  input: z.object({
    taskId: idSchema,
    text: z.string().max(10_000).optional(),
    fileIds: z.array(idSchema).max(10).optional(),
    links: z.array(z.string().url().max(300)).max(5).optional(),
  }).strip(),
  idempotent: true,
  scope: async (ctx, input) => studentAssigned(ctx.repo, ctx.caller.userId, input.taskId),
  async handler(ctx, input) {
    const task = await ctx.repo.getTask(input.taskId);
    const progress = await ownProgress(ctx.repo, ctx.caller.userId, input.taskId);
    if (!task || !progress || task.status !== 'published') throw new AppError('NOT_FOUND', '资源不存在');
    const gate = { status: asProgressStatus(progress.status), requiresSubmission: task.requiresSubmission !== false };
    if (!canSubmit(gate)) throw new AppError('FAILED_PRECONDITION', '当前状态不允许此操作');
    const now = ctx.clock.now();
    const dueAt = asNumber(task.dueAt) ?? now;
    if (task.allowLate !== true && now > dueAt) throw new AppError('DEADLINE_PASSED', '已过截止时间');
    const self = await ctx.repo.findStudentByUserId(ctx.caller.userId);
    for (const fileId of input.fileIds ?? []) {
      const file = await ctx.repo.getFile(fileId);
      if (!file || file.ownerUserId !== ctx.caller.userId || file.refId !== input.taskId || file.studentId !== self?._id) {
        throw new AppError('NOT_FOUND', '资源不存在');
      }
    }
    const previous = await ctx.repo.db.query(COLLECTIONS.submissions, (doc) => doc.progressId === progress._id);
    const version = previous.length + 1;
    const submissionId = nid('sub_');
    const isLate = now > dueAt;
    await ctx.repo.db.insert(COLLECTIONS.submissions, {
      _id: submissionId,
      schoolId: ctx.caller.schoolId,
      progressId: progress._id,
      taskId: input.taskId,
      studentId: self?._id,
      version,
      text: input.text ?? '',
      fileIds: input.fileIds ?? [],
      links: input.links ?? [],
      submittedAt: now,
      isLate,
      schemaVersion: 1,
    });
    await ctx.repo.db.compareAndSet(COLLECTIONS.taskProgress, progress._id, undefined, {
      status: 'submitted',
      displayStatus: 'submitted',
      isOverdue: false,
      isLate,
      latestSubmissionId: submissionId,
      submittedAt: now,
    });
    await refreshTaskStats(ctx.repo, task._id, now);
    return { submissionId, version, isLate };
  },
});

registerAction({
  name: 'submission.list',
  fn: FUNCTIONS.apiAcademic,
  roles: ['student', 'parent', 'teacher'],
  input: z.object({ taskId: idSchema, studentId: idSchema }).strip(),
  scope: async (ctx, input) => canReadSubmission(ctx.repo, ctx.caller, input.taskId, input.studentId, ctx.clock.now()),
  async handler(ctx, input) {
    const rows = await ctx.repo.db.query(
      COLLECTIONS.submissions,
      (doc) => doc.taskId === input.taskId && doc.studentId === input.studentId && doc.schoolId === ctx.caller.schoolId,
    );
    rows.sort((a, b) => (asNumber(a.version) ?? 0) - (asNumber(b.version) ?? 0));
    const items = [];
    for (const row of rows) {
      const files = [];
      for (const fileId of asStringArray(row.fileIds)) {
        const file = await ctx.repo.getFile(fileId);
        if (file) files.push({ fileId: file._id, name: file.name, size: file.size });
      }
      items.push({ version: row.version, text: row.text ?? '', files, submittedAt: row.submittedAt, isLate: row.isLate === true });
    }
    return { items };
  },
});

registerAction({
  name: 'submission.return',
  fn: FUNCTIONS.apiAcademic,
  roles: ['teacher'],
  input: z.object({ taskId: idSchema, studentId: idSchema, reason: z.string().min(1).max(500) }).strip(),
  scope: async (ctx, input) => teacherOwnsTask(ctx.repo, ctx.caller.userId, ctx.caller.schoolId, input.taskId, ctx.clock.now()),
  async handler(ctx, input) {
    const progress = await ctx.repo.progressFor(input.taskId, input.studentId);
    if (!progress || progress.schoolId !== ctx.caller.schoolId) throw new AppError('NOT_FOUND', '资源不存在');
    await ctx.repo.db.compareAndSet(COLLECTIONS.taskProgress, progress._id, undefined, {
      status: 'in_progress',
      displayStatus: 'in_progress',
      returnedAt: ctx.clock.now(),
    });
    await ctx.repo.appendAudit({
      at: ctx.clock.now(),
      actorUserId: ctx.caller.userId,
      actorRoles: ctx.caller.roles,
      action: 'submission.return',
      targetType: 'task',
      targetId: input.taskId,
      studentId: input.studentId,
      result: 'ok',
      requestId: ctx.requestId,
      client: ctx.caller.client,
      meta: { studentId: input.studentId },
    });
    await refreshTaskStats(ctx.repo, input.taskId, ctx.clock.now());
    return { ok: true };
  },
});

async function teacherOwnsTask(repo: { getTask: Repo['getTask']; teachesCourse: Repo['teachesCourse'] }, teacherId: string, schoolId: string, taskId: string, now: number): Promise<boolean> {
  const task = await repo.getTask(taskId);
  const courseId = asString(task?.courseId);
  if (!task || task.schoolId !== schoolId || !courseId) return false;
  return repo.teachesCourse(teacherId, courseId, schoolId, now);
}

async function studentAssigned(repo: Repo, userId: string, taskId: string): Promise<boolean> {
  const self = await repo.findStudentByUserId(userId);
  if (!self) return false;
  const progress = await repo.progressFor(taskId, self._id);
  return Boolean(progress && progress.schoolId === self.schoolId);
}

async function ownProgress(repo: Repo, userId: string, taskId: string): Promise<Doc | null> {
  const self = await repo.findStudentByUserId(userId);
  if (!self) return null;
  return repo.progressFor(taskId, self._id);
}

async function canReadSubmission(repo: Repo, caller: { userId: string; roles: string[]; schoolId: string }, taskId: string, studentId: string, now: number): Promise<boolean> {
  const progress = await repo.progressFor(taskId, studentId);
  if (!progress || progress.schoolId !== caller.schoolId) return false;
  if (caller.roles.includes('student') && (await repo.isSelf(caller.userId, studentId))) return true;
  if (caller.roles.includes('parent') && (await repo.isGuardianOf(caller.userId, studentId, caller.schoolId))) return true;
  const task = await repo.getTask(taskId);
  const courseId = asString(task?.courseId);
  if (caller.roles.includes('teacher') && courseId) return repo.teachesCourse(caller.userId, courseId, caller.schoolId, now);
  return false;
}

async function tasksForStudent(repo: Repo, studentId: string, schoolId: string, range: string, subjectId: string | undefined, now: number) {
  const progressRows = await repo.listProgressForStudent(studentId, schoolId);
  const tasks = await repo.getTasks(progressRows.map((doc) => asString(doc.taskId) ?? '').filter(Boolean));
  const byId = new Map(tasks.map((doc) => [doc._id, doc]));
  const weekStart = shanghaiWeekStart(now);
  const items = [];
  for (const row of progressRows) {
    const task = byId.get(asString(row.taskId) ?? '');
    if (!task || (task.status !== 'published' && task.status !== 'closed')) continue;
    if (subjectId && task.subjectId !== subjectId) continue;
    const dueAt = asNumber(task.dueAt) ?? 0;
    if (range === 'week' && (dueAt < weekStart || dueAt >= weekStart + 7 * 24 * 60 * 60 * 1000)) continue;
    if (range === 'overdue' && row.displayStatus !== 'overdue' && row.isOverdue !== true) continue;
    if (range === 'graded' && row.displayStatus !== 'graded') continue;
    items.push({ task: projectTask(task), progress: projectProgress(row) });
  }
  items.sort((a, b) => (asNumber(a.task.dueAt) ?? 0) - (asNumber(b.task.dueAt) ?? 0));
  return items;
}

function shanghaiWeekStart(now: number): number {
  const shifted = new Date(now + 8 * 60 * 60 * 1000);
  const day = shifted.getUTCDay();
  const fromMonday = day === 0 ? 6 : day - 1;
  return Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate() - fromMonday) - 8 * 60 * 60 * 1000;
}
