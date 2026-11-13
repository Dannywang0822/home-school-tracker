import { COLLECTIONS, FUNCTIONS } from '@hst/shared';
import { z } from 'zod';
import { AppError } from '../app-error.js';
import {
  activeChildIds,
  canReadStudentAcademic,
  displayNameOf,
  projectAssessment,
  projectProgress,
  projectTask,
} from '../auth/access.js';
import type { ActionContext } from '../auth/registry.js';
import { registerAction } from '../auth/registry.js';
import type { Doc } from '../db/types.js';
import { asNumber, asString, asStringArray, isRecord, nid, sha256, weekBoundsShanghai } from '../util.js';

const idSchema = z.string().min(1).max(80);

registerAction({
  name: 'task.get',
  fn: FUNCTIONS.apiAcademic,
  roles: ['teacher', 'student', 'parent', 'admin'],
  input: z.object({ taskId: idSchema, studentId: idSchema.optional() }).strip(),
  scope: async (ctx, input) => {
    const task = await ctx.repo.getTask(input.taskId);
    if (!task || task.schoolId !== ctx.caller.schoolId) return false;
    if (ctx.caller.roles.includes('admin')) return true;
    if (ctx.caller.roles.includes('teacher')) {
      const courseId = asString(task.courseId);
      if (!courseId) return false;
      return ctx.repo.teachesCourse(ctx.caller.userId, courseId, ctx.caller.schoolId, ctx.clock.now());
    }
    const studentId = await studentForTask(ctx, input.studentId, task._id);
    if (!studentId) return false;
    return Boolean(await ctx.repo.progressFor(task._id, studentId));
  },
  async handler(ctx, input) {
    const task = await ctx.repo.getTask(input.taskId);
    if (!task) return { task: null };
    const projected = projectTask(task);
    if (ctx.caller.roles.includes('teacher') || ctx.caller.roles.includes('admin')) {
      if (!input.studentId) return { task: projected, attachments: await taskAttachments(ctx, task) };
      if (!(await canReadStudentAcademic(ctx, input.studentId))) return { task: projected };
      const progress = await ctx.repo.progressFor(task._id, input.studentId);
      const grade = await gradeFor(ctx, task._id, input.studentId, true);
      return {
        task: projected,
        attachments: await taskAttachments(ctx, task),
        progress: progress ? projectProgress(progress) : undefined,
        ...(grade ? { assessment: grade } : {}),
        threadId: await threadFor(ctx, task._id, input.studentId),
      };
    }
    const studentId = await studentForTask(ctx, input.studentId, task._id);
    if (!studentId) throw new AppError('NOT_FOUND', '资源不存在');
    const progress = await ctx.repo.progressFor(task._id, studentId);
    if (!progress) throw new AppError('NOT_FOUND', '资源不存在');
    const grade = await gradeFor(ctx, task._id, studentId, false);
    return {
      task: projected,
      attachments: await taskAttachments(ctx, task),
      progress: projectProgress(progress),
      studentId,
      ...(grade ? { assessment: grade } : {}),
      threadId: await threadFor(ctx, task._id, studentId),
    };
  },
});

registerAction({
  name: 'progress.listByStudent',
  fn: FUNCTIONS.apiAcademic,
  roles: ['teacher', 'student', 'parent', 'admin'],
  input: z.object({ studentId: idSchema, termId: idSchema.optional() }).strip(),
  scope: async (ctx, input) => canReadStudentAcademic(ctx, input.studentId),
  async handler(ctx, input) {
    let rows = await ctx.repo.listProgressForStudent(input.studentId, ctx.caller.schoolId);
    if (input.termId) rows = rows.filter((doc) => doc.termId === input.termId);
    if (ctx.caller.roles.includes('teacher') && !ctx.caller.roles.includes('admin')) {
      const homeroom = await ctx.repo.isHomeroomOf(ctx.caller.userId, input.studentId, ctx.caller.schoolId);
      if (!homeroom) {
        const courseIds = new Set(await ctx.repo.courseIdsForTeacher(ctx.caller.userId, ctx.caller.schoolId, ctx.clock.now()));
        rows = rows.filter((doc) => courseIds.has(asString(doc.courseId) ?? ''));
      }
    }
    const assigned = rows.length;
    const done = rows.filter((doc) => doc.displayStatus === 'submitted' || doc.displayStatus === 'graded').length;
    return {
      items: rows.map((doc) => ({
        taskId: doc.taskId,
        studentId: doc.studentId,
        ...projectProgress(doc),
      })),
      completionRate: { assigned, done, rate: assigned === 0 ? 0 : done / assigned },
    };
  },
});

registerAction({
  name: 'assessment.listByStudent',
  fn: FUNCTIONS.apiAcademic,
  roles: ['teacher', 'student', 'parent', 'admin'],
  input: z.object({ studentId: idSchema, termId: idSchema.optional(), subjectId: idSchema.optional(), includeDraft: z.boolean().optional() }).strip(),
  scope: async (ctx, input) => canReadStudentAcademic(ctx, input.studentId),
  async handler(ctx, input) {
    let rows = await ctx.repo.listAssessmentsForStudent(input.studentId, ctx.caller.schoolId);
    if (input.termId) rows = rows.filter((doc) => doc.termId === input.termId);
    if (input.subjectId) rows = rows.filter((doc) => doc.subjectId === input.subjectId);
    const teacherSeesDraft =
      input.includeDraft === true &&
      (ctx.caller.roles.includes('teacher') || ctx.caller.roles.includes('admin')) &&
      !ctx.caller.roles.includes('parent') &&
      !ctx.caller.roles.includes('student');
    const items = [];
    for (const doc of rows) {
      if (doc.status === 'released') {
        const projected = projectAssessment(doc);
        if (projected) items.push(projected);
        continue;
      }
      const courseId = asString(doc.courseId);
      if (
        teacherSeesDraft &&
        courseId &&
        (await ctx.repo.teachesCourse(ctx.caller.userId, courseId, ctx.caller.schoolId, ctx.clock.now()))
      ) {
        items.push({
          taskId: doc.taskId,
          taskTitle: doc.taskTitle,
          subject: doc.subject,
          status: 'draft',
          myp: doc.myp,
          dp: doc.dp,
          overallComment: doc.overallComment ?? '',
        });
      }
    }
    return { items };
  },
});

registerAction({
  name: 'summary.get',
  fn: FUNCTIONS.apiAcademic,
  roles: ['teacher', 'student', 'parent', 'admin'],
  input: z.object({ studentId: idSchema, yearId: idSchema.optional() }).strip(),
  scope: async (ctx, input) => canReadStudentAcademic(ctx, input.studentId),
  async handler(ctx, input) {
    let rows = await ctx.repo.listSummaries(input.studentId, ctx.caller.schoolId);
    if (input.yearId) {
      const terms = await ctx.repo.listSchool(COLLECTIONS.terms, ctx.caller.schoolId);
      const ids = new Set(terms.filter((doc) => doc.yearId === input.yearId).map((doc) => doc._id));
      rows = rows.filter((doc) => ids.has(asString(doc.termId) ?? ''));
    }
    const released = await ctx.repo.listAssessmentsForStudent(input.studentId, ctx.caller.schoolId);
    const byTerm = new Map<string, Doc[]>();
    for (const doc of rows) {
      const termId = asString(doc.termId) ?? '';
      const list = byTerm.get(termId) ?? [];
      list.push(doc);
      byTerm.set(termId, list);
    }
    const growth: Record<string, Record<string, { termId: string; level: number }[]>> = {};
    for (const doc of rows) {
      const subjectId = asString(doc.subjectId) ?? '';
      const termId = asString(doc.termId) ?? '';
      const bucket = growth[subjectId] ?? {};
      if (isRecord(doc.myp)) {
        for (const key of ['A', 'B', 'C', 'D']) {
          const cell = doc.myp[key];
          const level = isRecord(cell) ? asNumber(cell.bestFit) : undefined;
          if (level == null) continue;
          const series = bucket[key] ?? [];
          series.push({ termId, level });
          bucket[key] = series;
        }
      }
      if (isRecord(doc.dp)) {
        const predicted = asNumber(doc.dp.predicted);
        if (predicted != null) {
          const series = bucket.predicted ?? [];
          series.push({ termId, level: predicted });
          bucket.predicted = series;
        }
      }
      growth[subjectId] = bucket;
    }
    return {
      terms: [...byTerm.entries()].map(([termId, subjects]) => ({
        termId,
        subjects: subjects.map((doc) => {
          const subjectId = asString(doc.subjectId) ?? '';
          const ia = released.find(
            (row) =>
              row.status === 'released' &&
              row.subjectId === subjectId &&
              row.termId === termId &&
              isRecord(row.dp) &&
              row.dp.componentCode === 'IA',
          );
          return {
            subjectId,
            scheme: doc.scheme,
            myp: doc.myp,
            dp: doc.dp,
            teacherOverride: isRecord(doc.teacherOverride)
              ? { grade: doc.teacherOverride.grade, comment: doc.teacherOverride.comment }
              : undefined,
            ...(ia && isRecord(ia.dp) ? { ia: { status: 'scored', score: ia.dp.score } } : {}),
          };
        }),
      })),
      growth,
    };
  },
});

registerAction({
  name: 'dashboard.parent',
  fn: FUNCTIONS.apiAcademic,
  roles: ['parent'],
  input: z.object({ studentId: idSchema.optional() }).strip(),
  scope: async (ctx, input) => {
    if (!input.studentId) return true;
    const children = await activeChildIds(ctx);
    return children.includes(input.studentId);
  },
  async handler(ctx, input) {
    const children = (await loadChildren(ctx)).sort((a, b) => a.studentId.localeCompare(b.studentId));
    if (children.length === 0) {
      return { needsBind: true, children: [], child: null, weekTasks: [], overdueCount: 0, recentComments: [], ib: null };
    }
    const child = children.find((item) => item.studentId === input.studentId) ?? children[0];
    if (!child) {
      return { needsBind: true, children: [], child: null, weekTasks: [], overdueCount: 0, recentComments: [], ib: null };
    }
    const progress = await ctx.repo.listProgressForStudent(child.studentId, ctx.caller.schoolId);
    const tasks = await ctx.repo.getTasks(progress.map((doc) => asString(doc.taskId) ?? '').filter(Boolean));
    const taskById = new Map(tasks.map((doc) => [doc._id, doc]));
    const week = weekBoundsShanghai(ctx.clock.now());
    const weekTasks = [];
    let overdueCount = 0;
    for (const row of progress) {
      const task = taskById.get(asString(row.taskId) ?? '');
      if (!task || task.status !== 'published') continue;
      const dueAt = asNumber(task.dueAt) ?? 0;
      const projected = projectProgress(row);
      if (projected.displayStatus === 'overdue' || row.isOverdue === true) overdueCount += 1;
      if (dueAt >= week.start && dueAt < week.end) {
        weekTasks.push({ task: projectTask(task), progress: projected });
      }
    }
    weekTasks.sort((a, b) => (asNumber(a.task.dueAt) ?? 0) - (asNumber(b.task.dueAt) ?? 0));
    const assessments = await ctx.repo.listAssessmentsForStudent(child.studentId, ctx.caller.schoolId);
    const recentComments = assessments
      .filter((doc) => doc.status === 'released' && typeof doc.overallComment === 'string' && doc.overallComment)
      .sort((a, b) => (asNumber(b.releasedAt) ?? 0) - (asNumber(a.releasedAt) ?? 0))
      .slice(0, 5)
      .map((doc) => ({
        taskTitle: doc.taskTitle,
        subject: doc.subject,
        excerpt: String(doc.overallComment).slice(0, 60),
        at: doc.releasedAt,
      }));
    const summaries = await ctx.repo.listSummaries(child.studentId, ctx.caller.schoolId);
    return {
      needsBind: false,
      children,
      child,
      weekTasks,
      overdueCount,
      recentComments,
      ib: {
        programme: child.programme,
        summaries: summaries.map((doc) => ({
          subjectId: doc.subjectId,
          termId: doc.termId,
          myp: doc.myp,
          dp: doc.dp,
        })),
      },
    };
  },
});

registerAction({
  name: 'course.listMine',
  fn: FUNCTIONS.apiAcademic,
  roles: ['teacher', 'student', 'parent'],
  input: z.object({ studentId: idSchema.optional(), yearId: idSchema.optional() }).strip(),
  scope: async (ctx, input) => {
    if (ctx.caller.roles.includes('parent')) {
      if (!input.studentId) return false;
      return (await activeChildIds(ctx)).includes(input.studentId);
    }
    if (ctx.caller.roles.includes('student')) {
      const self = await ctx.repo.findStudentByUserId(ctx.caller.userId);
      if (!self) return false;
      if (input.studentId && input.studentId !== self._id) return false;
      return true;
    }
    if (input.studentId) return ctx.repo.teachesStudent(ctx.caller.userId, input.studentId, ctx.caller.schoolId, ctx.clock.now());
    return true;
  },
  async handler(ctx, input) {
    const courses = await ctx.repo.listSchool(COLLECTIONS.courses, ctx.caller.schoolId);
    let allowed = new Set<string>();
    if (ctx.caller.roles.includes('teacher') && !input.studentId) {
      allowed = new Set(await ctx.repo.courseIdsForTeacher(ctx.caller.userId, ctx.caller.schoolId, ctx.clock.now()));
    } else {
      const studentId = input.studentId ?? (await ctx.repo.findStudentByUserId(ctx.caller.userId))?._id;
      if (!studentId) return { items: [] };
      const enrolled = await ctx.repo.db.query(
        COLLECTIONS.enrollments,
        (doc) => doc.studentId === studentId && doc.schoolId === ctx.caller.schoolId && doc.status === 'active',
      );
      allowed = new Set(enrolled.map((doc) => asString(doc.courseId) ?? '').filter(Boolean));
      if (ctx.caller.roles.includes('teacher')) {
        const taught = new Set(await ctx.repo.courseIdsForTeacher(ctx.caller.userId, ctx.caller.schoolId, ctx.clock.now()));
        allowed = new Set([...allowed].filter((courseId) => taught.has(courseId)));
      }
    }
    const items = [];
    for (const course of courses) {
      if (!allowed.has(course._id)) continue;
      if (input.yearId && course.yearId !== input.yearId) continue;
      const subject = await ctx.repo.db.get(COLLECTIONS.subjects, asString(course.subjectId) ?? '');
      items.push({
        courseId: course._id,
        name: course.name,
        subject: subject?.name,
        programme: course.programme,
        gradeLevel: course.gradeId,
      });
    }
    return { items };
  },
});

registerAction({
  name: 'course.roster',
  fn: FUNCTIONS.apiAcademic,
  roles: ['teacher', 'admin'],
  input: z.object({ courseId: idSchema }).strip(),
  scope: async (ctx, input) => {
    const course = await ctx.repo.getCourse(input.courseId);
    if (!course || course.schoolId !== ctx.caller.schoolId) return false;
    if (ctx.caller.roles.includes('admin')) return true;
    if (await ctx.repo.teachesCourse(ctx.caller.userId, course._id, ctx.caller.schoolId, ctx.clock.now())) return true;
    const classId = asString(course.homeroomClassId);
    if (!classId) return false;
    const homeroom = await ctx.repo.getClass(classId);
    return asStringArray(homeroom?.homeroomTeacherIds).includes(ctx.caller.userId);
  },
  async handler(ctx, input) {
    const students = await ctx.repo.listRoster(input.courseId, ctx.caller.schoolId);
    const items = [];
    for (const student of students) {
      const user = await ctx.repo.getUser(asString(student.userId) ?? '');
      items.push({
        studentId: student._id,
        displayName: displayNameOf(user),
        studentNo: student.studentNo,
      });
    }
    return { items };
  },
});

registerAction({
  name: 'thread.get',
  fn: FUNCTIONS.apiAcademic,
  roles: ['teacher', 'student', 'parent', 'admin', 'supervisor'],
  input: z.object({ threadId: idSchema }).strip(),
  scope: async (ctx, input) => {
    const thread = await ctx.repo.getThread(input.threadId);
    if (!thread) return false;
    return canAccessThread(ctx, thread);
  },
  async handler(ctx, input) {
    const thread = await ctx.repo.getThread(input.threadId);
    if (!thread) return { thread: null };
    return {
      threadId: thread._id,
      contextType: thread.contextType,
      contextId: thread.contextId,
      studentId: thread.studentId,
      lastMessageAt: thread.lastMessageAt,
    };
  },
});

registerAction({
  name: 'thread.listMine',
  fn: FUNCTIONS.apiAcademic,
  roles: ['teacher', 'student', 'parent', 'admin', 'supervisor', 'cas_coordinator', 'ee_coordinator'],
  input: z.object({ studentId: idSchema.optional() }).strip(),
  scope: async (ctx, input) => {
    if (!input.studentId) return true;
    if (ctx.caller.roles.includes('parent')) return (await activeChildIds(ctx)).includes(input.studentId);
    if (ctx.caller.roles.includes('student')) return ctx.repo.isSelf(ctx.caller.userId, input.studentId);
    return canReadStudentAcademic(ctx, input.studentId);
  },
  async handler(ctx, input) {
    const ids = await threadStudentIds(ctx, input.studentId);
    const threads = await ctx.repo.listThreadsForStudents(ids, ctx.caller.schoolId);
    return {
      items: threads.map((doc) => ({
        threadId: doc._id,
        contextType: doc.contextType,
        studentId: doc.studentId,
        lastMessageAt: doc.lastMessageAt,
        lastMessagePreview: typeof doc.lastMessagePreview === 'string' ? doc.lastMessagePreview.slice(0, 60) : '',
      })),
    };
  },
});

registerAction({
  name: 'message.list',
  fn: FUNCTIONS.apiAcademic,
  roles: ['teacher', 'student', 'parent', 'admin', 'supervisor'],
  input: z.object({ threadId: idSchema }).strip(),
  scope: async (ctx, input) => {
    const thread = await ctx.repo.getThread(input.threadId);
    if (!thread) return false;
    return canAccessThread(ctx, thread);
  },
  async handler(ctx, input) {
    const rows = await ctx.repo.listMessages(input.threadId);
    const hideStaff = ctx.caller.roles.includes('parent') && !ctx.caller.roles.some((role) => role === 'teacher' || role === 'admin');
    return {
      items: rows
        .filter((doc) => !(hideStaff && doc.visibility === 'staff_student'))
        .map((doc) => ({
          messageId: doc._id,
          authorRole: doc.authorRole,
          kind: doc.kind,
          body: doc.body,
          visibility: doc.visibility,
          createdAt: doc.createdAt,
        })),
    };
  },
});

registerAction({
  name: 'message.post',
  fn: FUNCTIONS.apiAcademic,
  roles: ['teacher', 'student', 'parent', 'supervisor'],
  input: z.object({ threadId: idSchema, body: z.string().min(1).max(4000) }).strip(),
  idempotent: true,
  scope: async (ctx, input) => {
    const thread = await ctx.repo.getThread(input.threadId);
    if (!thread) return false;
    return canAccessThread(ctx, thread);
  },
  async handler(ctx, input) {
    const thread = await ctx.repo.getThread(input.threadId);
    const messageId = nid('msg_');
    const now = ctx.clock.now();
    await ctx.repo.insertMessage({
      _id: messageId,
      threadId: input.threadId,
      studentId: thread?.studentId,
      schoolId: ctx.caller.schoolId,
      authorId: ctx.caller.userId,
      authorRole: ctx.caller.roles.includes('parent') ? 'parent' : ctx.caller.roles.includes('student') ? 'student' : 'teacher',
      kind: ctx.caller.roles.includes('parent') ? 'parent_message' : ctx.caller.roles.includes('student') ? 'student_reflection' : 'teacher_comment',
      body: input.body,
      visibility: 'all',
      createdAt: now,
      schemaVersion: 1,
    });
    return { messageId };
  },
});

registerAction({
  name: 'file.getUrl',
  fn: FUNCTIONS.apiCore,
  roles: ['teacher', 'student', 'parent', 'admin'],
  input: z.object({ fileId: idSchema }).strip(),
  scope: async (ctx, input) => canReadFile(ctx, input.fileId),
  async handler(ctx, input) {
    const expiresAt = ctx.clock.now() + 600_000;
    const token = sha256(`${input.fileId}:${expiresAt}:${ctx.config.invitePepper || 'local'}`).slice(0, 32);
    if (ctx.caller.roles.includes('teacher') || ctx.caller.roles.includes('admin')) {
      const file = await ctx.repo.getFile(input.fileId);
      await ctx.repo.appendAudit({
        at: ctx.clock.now(),
        actorUserId: ctx.caller.userId,
        actorRoles: ctx.caller.roles,
        action: 'file.download',
        targetType: 'file',
        targetId: input.fileId,
        studentId: asString(file?.studentId),
        result: 'ok',
        requestId: ctx.requestId,
        client: ctx.caller.client,
      });
    }
    return {
      url: `/api/dev/files/${input.fileId}?e=${expiresAt}&t=${token}`,
      expiresAt,
    };
  },
});

registerAction({
  name: 'notify.list',
  fn: FUNCTIONS.apiCore,
  roles: ['teacher', 'student', 'parent', 'admin', 'supervisor', 'cas_coordinator', 'ee_coordinator'],
  input: z.object({ studentId: idSchema.optional(), unreadOnly: z.boolean().optional() }).strip(),
  scope: async () => true,
  async handler(ctx, input) {
    let rows = await ctx.repo.listNotifications(ctx.caller.userId);
    if (input.studentId) rows = rows.filter((doc) => doc.studentId === input.studentId);
    if (input.unreadOnly) rows = rows.filter((doc) => doc.readAt == null);
    return {
      items: rows.map((doc) => ({
        id: doc._id,
        type: doc.type,
        title: doc.title,
        body: doc.body,
        link: doc.link,
        studentId: doc.studentId,
        createdAt: doc.createdAt,
        readAt: doc.readAt,
      })),
      unreadCount: rows.filter((doc) => doc.readAt == null).length,
    };
  },
});

async function studentForTask(ctx: ActionContext, requested: string | undefined, taskId: string): Promise<string | null> {
  if (ctx.caller.roles.includes('student')) {
    const self = await ctx.repo.findStudentByUserId(ctx.caller.userId);
    if (!self) return null;
    if (requested && requested !== self._id) return null;
    return self._id;
  }
  if (ctx.caller.roles.includes('parent')) {
    const children = await activeChildIds(ctx);
    if (requested) return children.includes(requested) ? requested : null;
    const assigned: string[] = [];
    for (const childId of children) {
      if (await ctx.repo.progressFor(taskId, childId)) assigned.push(childId);
    }
    return assigned.length === 1 ? (assigned[0] ?? null) : null;
  }
  return null;
}

async function canReadFile(ctx: ActionContext, fileId: string): Promise<boolean> {
  const file = await ctx.repo.getFile(fileId);
  if (!file || file.schoolId !== ctx.caller.schoolId) return false;
  const studentId = asString(file.studentId);
  if (studentId) return canReadStudentAcademic(ctx, studentId);
  if (file.refType !== 'task') return false;
  const task = await ctx.repo.getTask(asString(file.refId) ?? '');
  const courseId = asString(task?.courseId);
  if (!task || task.schoolId !== ctx.caller.schoolId || !courseId) return false;
  if (ctx.caller.roles.includes('admin')) return true;
  if (ctx.caller.roles.includes('teacher')) return ctx.repo.teachesCourse(ctx.caller.userId, courseId, ctx.caller.schoolId, ctx.clock.now());
  const owner = await studentForTask(ctx, undefined, task._id);
  if (!owner) return false;
  return Boolean(await ctx.repo.progressFor(task._id, owner));
}

async function canAccessThread(ctx: ActionContext, thread: Doc): Promise<boolean> {
  if (thread.schoolId !== ctx.caller.schoolId) return false;
  const studentId = asString(thread.studentId);
  if (!studentId) return false;
  if (ctx.caller.roles.includes('admin')) return true;
  if (ctx.caller.roles.includes('parent') && (await ctx.repo.isGuardianOf(ctx.caller.userId, studentId, ctx.caller.schoolId))) {
    return true;
  }
  if (ctx.caller.roles.includes('student') && (await ctx.repo.isSelf(ctx.caller.userId, studentId))) return true;
  if (asStringArray(thread.staffUserIds).includes(ctx.caller.userId)) return true;
  if (ctx.caller.roles.includes('teacher') && (await ctx.repo.teachesStudent(ctx.caller.userId, studentId, ctx.caller.schoolId, ctx.clock.now()))) {
    return true;
  }
  if (ctx.caller.roles.includes('supervisor') && (await ctx.repo.mentors(ctx.caller.userId, studentId, ctx.caller.schoolId))) {
    return true;
  }
  return false;
}

async function threadStudentIds(ctx: ActionContext, requested?: string): Promise<string[]> {
  if (ctx.caller.roles.includes('parent')) {
    const children = await activeChildIds(ctx);
    return requested ? children.filter((id) => id === requested) : children;
  }
  if (ctx.caller.roles.includes('student')) {
    const self = await ctx.repo.findStudentByUserId(ctx.caller.userId);
    if (!self) return [];
    if (requested && requested !== self._id) return [];
    return [self._id];
  }
  if (requested && (await canReadStudentAcademic(ctx, requested))) return [requested];
  return [];
}

async function gradeFor(ctx: ActionContext, taskId: string, studentId: string, includeDraft: boolean): Promise<Record<string, unknown> | undefined> {
  const doc = await ctx.repo.db.get(COLLECTIONS.assessments, `${taskId}_${studentId}`);
  if (!doc || doc.schoolId !== ctx.caller.schoolId || doc.studentId !== studentId) return undefined;
  if (doc.status === 'released') {
    const projected = projectAssessment(doc);
    return projected ? { ...projected, status: 'released', version: doc.version } : undefined;
  }
  if (!includeDraft || doc.status !== 'draft') return undefined;
  return {
    taskId: doc.taskId,
    status: 'draft',
    version: doc.version,
    myp: doc.myp,
    dp: doc.dp,
    overallComment: doc.overallComment ?? '',
  };
}

async function threadFor(ctx: ActionContext, taskId: string, studentId: string): Promise<string | undefined> {
  const rows = await ctx.repo.db.query(
    COLLECTIONS.threads,
    (doc) => doc.deletedAt == null && doc.contextType === 'task' && doc.contextId === taskId && doc.studentId === studentId,
  );
  return rows[0]?._id;
}

async function taskAttachments(ctx: ActionContext, task: Doc): Promise<{ fileId: string; name: unknown; size: unknown }[]> {
  const items = [];
  for (const fileId of asStringArray(task.attachmentIds)) {
    const file = await ctx.repo.getFile(fileId);
    if (!file || file.schoolId !== ctx.caller.schoolId) continue;
    items.push({ fileId: file._id, name: file.name, size: file.size });
  }
  return items;
}

async function loadChildren(ctx: ActionContext) {
  const ids = await activeChildIds(ctx);
  const items = [];
  for (const studentId of ids) {
    const student = await ctx.repo.getStudent(studentId);
    const user = student ? await ctx.repo.getUser(asString(student.userId) ?? '') : null;
    const homeroom = student ? await ctx.repo.getClass(asString(student.homeroomClassId) ?? '') : null;
    items.push({
      studentId,
      displayName: displayNameOf(user),
      programme: asString(student?.programme) ?? '',
      className: homeroom?.name ?? { zh: '' },
    });
  }
  return items;
}
