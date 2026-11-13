import { COLLECTIONS, FUNCTIONS } from '@hst/shared';
import { z } from 'zod';
import { AppError } from '../app-error.js';
import { canReadStudentAcademic, displayNameOf } from '../auth/access.js';
import { registerAction } from '../auth/registry.js';
import type { ActionContext } from '../auth/registry.js';
import type { Doc } from '../db/types.js';
import { markThreadRead } from '../notify/threads.js';
import { prefsFromDoc } from '../notify/prefs.js';
import type { UserLite } from '../notify/types.js';
import { asNumber, asString, asStringArray } from '../util.js';

const idSchema = z.string().min(1).max(80);
const EDIT_WINDOW = 15 * 60 * 1000;

registerAction({
  name: 'thread.getOrCreate',
  fn: FUNCTIONS.apiAcademic,
  roles: ['teacher', 'student', 'parent', 'admin', 'supervisor'],
  input: z.object({
    contextType: z.enum(['task', 'milestone_plan', 'cas_experience', 'general']),
    contextId: idSchema,
    studentId: idSchema,
  }).strip(),
  scope: async (ctx, input) => canReadStudentAcademic(ctx, input.studentId),
  async handler(ctx, input) {
    if (input.contextType === 'task') {
      const progress = await ctx.repo.progressFor(input.contextId, input.studentId);
      if (!progress || progress.schoolId !== ctx.caller.schoolId) throw new AppError('NOT_FOUND', '资源不存在');
    }
    const existing = await ctx.repo.db.query(
      COLLECTIONS.threads,
      (doc) =>
        doc.deletedAt == null &&
        doc.schoolId === ctx.caller.schoolId &&
        doc.contextType === input.contextType &&
        doc.contextId === input.contextId &&
        doc.studentId === input.studentId,
    );
    if (existing[0]) return { threadId: existing[0]._id };
    const now = ctx.clock.now();
    const staff = await staffFor(ctx, input.contextType, input.contextId);
    const threadId = `${input.contextType}_${input.contextId}_${input.studentId}`;
    await ctx.repo.db.insert(COLLECTIONS.threads, {
      _id: threadId,
      schoolId: ctx.caller.schoolId,
      contextType: input.contextType,
      contextId: input.contextId,
      studentId: input.studentId,
      staffUserIds: staff,
      lastMessageAt: 0,
      lastMessagePreview: '',
      messageCount: 0,
      createdAt: now,
      createdBy: ctx.caller.userId,
      updatedAt: now,
      updatedBy: ctx.caller.userId,
      schemaVersion: 1,
    });
    return { threadId };
  },
});

registerAction({
  name: 'thread.markRead',
  fn: FUNCTIONS.apiAcademic,
  roles: ['teacher', 'student', 'parent', 'admin', 'supervisor'],
  input: z.object({ threadId: idSchema }).strip(),
  scope: async (ctx, input) => {
    const thread = await ctx.repo.getThread(input.threadId);
    if (!thread) return false;
    return canReadStudentAcademic(ctx, asString(thread.studentId) ?? '') || asStringArray(thread.staffUserIds).includes(ctx.caller.userId);
  },
  async handler(ctx, input) {
    await markThreadRead(ctx.repo, input.threadId, ctx.caller.userId, ctx.caller.schoolId, ctx.clock.now());
    return { ok: true };
  },
});

registerAction({
  name: 'message.edit',
  fn: FUNCTIONS.apiAcademic,
  roles: ['teacher', 'student', 'parent', 'supervisor'],
  input: z.object({ messageId: idSchema, body: z.string().min(1).max(4000) }).strip(),
  scope: async (ctx, input) => canTouchMessage(ctx, input.messageId),
  async handler(ctx, input) {
    const message = await requireOwnFreshMessage(ctx, input.messageId);
    await ctx.repo.db.compareAndSet(COLLECTIONS.messages, message._id, undefined, {
      body: input.body,
      editedAt: ctx.clock.now(),
    });
    return { ok: true };
  },
});

registerAction({
  name: 'message.delete',
  fn: FUNCTIONS.apiAcademic,
  roles: ['teacher', 'student', 'parent', 'supervisor'],
  input: z.object({ messageId: idSchema }).strip(),
  scope: async (ctx, input) => canTouchMessage(ctx, input.messageId),
  async handler(ctx, input) {
    const message = await requireOwnFreshMessage(ctx, input.messageId);
    await ctx.repo.db.compareAndSet(COLLECTIONS.messages, message._id, undefined, { deletedAt: ctx.clock.now() });
    return { ok: true };
  },
});

registerAction({
  name: 'notify.markRead',
  fn: FUNCTIONS.apiCore,
  roles: ['teacher', 'student', 'parent', 'admin', 'supervisor', 'cas_coordinator', 'ee_coordinator'],
  input: z.object({ ids: z.array(idSchema).max(100).optional(), all: z.boolean().optional() }).strip(),
  scope: async () => true,
  async handler(ctx, input) {
    const rows = await ctx.repo.listNotifications(ctx.caller.userId);
    const wanted = new Set(input.ids ?? []);
    let updated = 0;
    for (const row of rows) {
      if (row.readAt != null) continue;
      if (!input.all && !wanted.has(row._id)) continue;
      await ctx.repo.db.compareAndSet(COLLECTIONS.notifications, row._id, undefined, { readAt: ctx.clock.now() });
      updated += 1;
    }
    return { updated };
  },
});

registerAction({
  name: 'prefs.get',
  fn: FUNCTIONS.apiCore,
  roles: ['teacher', 'student', 'parent', 'admin', 'supervisor', 'cas_coordinator', 'ee_coordinator'],
  input: z.object({}).strip(),
  scope: async () => true,
  async handler(ctx) {
    return { prefs: await currentPrefs(ctx) };
  },
});

registerAction({
  name: 'prefs.update',
  fn: FUNCTIONS.apiCore,
  roles: ['teacher', 'student', 'parent', 'admin', 'supervisor', 'cas_coordinator', 'ee_coordinator'],
  input: z.object({
    locale: z.enum(['zh', 'en']).optional(),
    channels: z.object({
      email: z.object({
        enabled: z.boolean(),
        mode: z.enum(['immediate', 'daily', 'weekly', 'off']),
        types: z.record(z.string(), z.boolean()).optional(),
      }).optional(),
    }).optional(),
    quietHours: z.object({
      start: z.string().regex(/^\d{2}:\d{2}$/),
      end: z.string().regex(/^\d{2}:\d{2}$/),
    }).optional(),
  }).strip(),
  scope: async () => true,
  async handler(ctx, input) {
    const current = await currentPrefs(ctx);
    const email = input.channels?.email;
    const next = {
      locale: input.locale ?? current.locale,
      channels: {
        email: {
          enabled: email?.enabled ?? current.channels.email.enabled,
          mode: email?.mode ?? current.channels.email.mode,
          types: { ...current.channels.email.types, ...(email?.types ?? {}) },
        },
        wechat_subscribe: { enabled: false, templateIds: {} },
      },
      quietHours: input.quietHours ?? current.quietHours ?? { start: '22:00', end: '07:00' },
    };
    const existing = await ctx.repo.getPrefs(ctx.caller.userId);
    if (!existing) {
      await ctx.repo.db.insert(COLLECTIONS.notificationPrefs, {
        _id: ctx.caller.userId,
        schoolId: ctx.caller.schoolId,
        ...next,
        updatedAt: ctx.clock.now(),
        schemaVersion: 1,
      });
    } else {
      await ctx.repo.db.compareAndSet(COLLECTIONS.notificationPrefs, ctx.caller.userId, undefined, {
        ...next,
        updatedAt: ctx.clock.now(),
      });
    }
    return { prefs: next };
  },
});

async function currentPrefs(ctx: ActionContext) {
  const userDoc = await ctx.repo.getUser(ctx.caller.userId);
  const user: UserLite = {
    _id: ctx.caller.userId,
    roles: ctx.caller.roles,
    email: asString(userDoc?.email),
    locale: ctx.caller.locale,
    displayName: displayNameOf(userDoc),
  };
  return prefsFromDoc(await ctx.repo.getPrefs(ctx.caller.userId), user);
}

async function canTouchMessage(ctx: ActionContext, messageId: string): Promise<boolean> {
  const message = await ctx.repo.db.get(COLLECTIONS.messages, messageId);
  if (!message || message.deletedAt != null || message.schoolId !== ctx.caller.schoolId) return false;
  const thread = await ctx.repo.getThread(asString(message.threadId) ?? '');
  if (!thread) return false;
  return canReadStudentAcademic(ctx, asString(thread.studentId) ?? '') || asStringArray(thread.staffUserIds).includes(ctx.caller.userId);
}

async function requireOwnFreshMessage(ctx: ActionContext, messageId: string): Promise<Doc> {
  const message = await ctx.repo.db.get(COLLECTIONS.messages, messageId);
  if (!message || message.deletedAt != null) throw new AppError('NOT_FOUND', '资源不存在');
  if (message.authorId !== ctx.caller.userId) throw new AppError('PERMISSION_DENIED', '没有权限执行此操作');
  const createdAt = asNumber(message.createdAt) ?? 0;
  if (ctx.clock.now() - createdAt > EDIT_WINDOW) throw new AppError('PERMISSION_DENIED', '没有权限执行此操作');
  return message;
}

async function staffFor(ctx: ActionContext, contextType: string, contextId: string): Promise<string[]> {
  if (contextType !== 'task') return ctx.caller.roles.includes('teacher') ? [ctx.caller.userId] : [];
  const task = await ctx.repo.getTask(contextId);
  const courseId = asString(task?.courseId);
  if (!courseId) return [];
  const rows = await ctx.repo.db.query(
    COLLECTIONS.teachingAssignments,
    (doc) => doc.deletedAt == null && doc.courseId === courseId && doc.schoolId === ctx.caller.schoolId,
  );
  return rows.map((doc) => asString(doc.teacherId)).filter((id): id is string => Boolean(id));
}
