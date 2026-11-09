import { COLLECTIONS, FUNCTIONS, STORAGE } from '@hst/shared';
import { z } from 'zod';
import { AppError } from '../app-error.js';
import { registerAction } from '../auth/registry.js';
import type { Repo } from '../repo.js';
import { isSafeObjectPath } from '../storage/types.js';
import { createHash } from 'node:crypto';
import { asString, nid } from '../util.js';

const idSchema = z.string().min(1).max(80);
const MAX_FILE = 20 * 1024 * 1024;
const MAX_VIDEO = 100 * 1024 * 1024;
const ALLOWED = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/jpeg',
  'image/png',
  'image/heic',
  'video/mp4',
]);

registerAction({
  name: 'file.commit',
  fn: FUNCTIONS.apiCore,
  roles: ['teacher', 'student', 'parent', 'admin'],
  input: z.object({
    tmpCloudFileId: z.string().min(1).max(240),
    name: z.string().min(1).max(180),
    mime: z.string().min(1).max(120),
    size: z.number().int().positive(),
    refType: z.enum(['task', 'submission']),
    refId: idSchema,
  }).strip(),
  scope: async (ctx, input) => canCommit(ctx.repo, ctx.caller, input.refType, input.refId, ctx.clock.now()),
  async handler(ctx, input) {
    const tmp = input.tmpCloudFileId;
    if (!isSafeObjectPath(tmp) || !tmp.startsWith(STORAGE.tmpPrefix)) throw new AppError('NOT_FOUND', '资源不存在');
    if (!ALLOWED.has(input.mime)) throw new AppError('FILE_TYPE_NOT_ALLOWED', '文件类型不允许');
    const limit = input.mime === 'video/mp4' ? MAX_VIDEO : MAX_FILE;
    if (input.size > limit) throw new AppError('FILE_TOO_LARGE', '文件太大');
    const stored = await ctx.storage.get(tmp);
    if (!stored) throw new AppError('NOT_FOUND', '资源不存在');
    if (stored.body.byteLength !== input.size) throw new AppError('INVALID_ARGUMENT', '参数不正确', { fields: { size: '与上传内容不一致' } });
    const fileId = nid('fil_');
    const vault = `${STORAGE.vaultPrefix}${ctx.caller.schoolId}/${input.refType}/${input.refId}/${fileId}`;
    await ctx.storage.copy(tmp, vault);
    await ctx.storage.remove(tmp);
    const self = input.refType === 'submission' ? await ctx.repo.findStudentByUserId(ctx.caller.userId) : null;
    await ctx.repo.db.insert(COLLECTIONS.files, {
      _id: fileId,
      schoolId: ctx.caller.schoolId,
      cloudFileId: vault,
      stage: 'vault',
      ownerUserId: ctx.caller.userId,
      refType: input.refType,
      refId: input.refId,
      studentId: self?._id,
      name: input.name,
      mime: input.mime,
      size: input.size,
      sha256: createHash('sha256').update(stored.body).digest('hex'),
      createdAt: ctx.clock.now(),
      createdBy: ctx.caller.userId,
      schemaVersion: 1,
    });
    return { fileId };
  },
});

registerAction({
  name: 'file.delete',
  fn: FUNCTIONS.apiCore,
  roles: ['teacher', 'student', 'parent', 'admin'],
  input: z.object({ fileId: idSchema }).strip(),
  scope: async (ctx, input) => {
    const file = await ctx.repo.getFile(input.fileId);
    return Boolean(file && file.schoolId === ctx.caller.schoolId && file.ownerUserId === ctx.caller.userId);
  },
  async handler(ctx, input) {
    const file = await ctx.repo.getFile(input.fileId);
    if (!file) throw new AppError('NOT_FOUND', '资源不存在');
    if (file.refType === 'submission') {
      const progress = await ctx.repo.progressFor(asString(file.refId) ?? '', asString(file.studentId) ?? '');
      if (progress?.status === 'graded') throw new AppError('PERMISSION_DENIED', '没有权限执行此操作');
    }
    const path = asString(file.cloudFileId);
    if (path) await ctx.storage.remove(path);
    await ctx.repo.db.compareAndSet(COLLECTIONS.files, file._id, undefined, { deletedAt: ctx.clock.now() });
    return { ok: true };
  },
});

async function canCommit(repo: Repo, caller: { userId: string; roles: string[]; schoolId: string }, refType: string, refId: string, now: number): Promise<boolean> {
  const task = await repo.getTask(refId);
  if (!task || task.schoolId !== caller.schoolId) return false;
  const courseId = asString(task.courseId) ?? '';
  if (refType === 'task') {
    if (caller.roles.includes('admin')) return true;
    return caller.roles.includes('teacher') && repo.teachesCourse(caller.userId, courseId, caller.schoolId, now);
  }
  if (!caller.roles.includes('student')) return false;
  const self = await repo.findStudentByUserId(caller.userId);
  if (!self) return false;
  const progress = await repo.progressFor(refId, self._id);
  return Boolean(progress);
}
