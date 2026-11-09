import { COLLECTIONS, FUNCTIONS } from '@hst/shared';
import { z } from 'zod';
import { AppError } from '../app-error.js';
import { registerAction } from '../auth/registry.js';
import { asString, asStringArray, nid } from '../util.js';

const allowedScopes = ['basic_processing', 'email_notifications', 'evidence_upload'] as const;

registerAction({
  name: 'consent.status',
  fn: FUNCTIONS.apiCore,
  roles: ['parent', 'student', 'admin'],
  input: z.object({}).strip(),
  consentExempt: true,
  allowDuringPasswordChange: true,
  scope: async () => true,
  async handler(ctx) {
    const studentIds: string[] = [];
    if (ctx.caller.roles.includes('student')) {
      const self = await ctx.repo.findStudentByUserId(ctx.caller.userId);
      if (self) studentIds.push(self._id);
    }
    if (ctx.caller.roles.includes('parent')) {
      const links = await ctx.repo.activeChildLinks(ctx.caller.userId, ctx.caller.schoolId);
      for (const link of links) {
        const studentId = asString(link.studentId);
        if (studentId) studentIds.push(studentId);
      }
    }
    const items = [];
    for (const studentId of studentIds) {
      const student = await ctx.repo.getStudent(studentId);
      const consents = await ctx.repo.listConsentsForStudent(studentId);
      const granted = consents.find((doc) => doc.revokedAt == null);
      items.push({
        studentId,
        required: student?.consentStatus !== 'granted',
        grantedVersion: granted?.policyVersion,
        scopes: granted ? asStringArray(granted.scopes) : [],
      });
    }
    return { items };
  },
});

registerAction({
  name: 'consent.grant',
  fn: FUNCTIONS.apiCore,
  roles: ['parent', 'student'],
  input: z.object({
    studentId: z.string().min(1).max(80),
    policyVersion: z.string().min(1).max(40),
    scopes: z.array(z.enum(allowedScopes)).min(1).max(5),
  }).strip(),
  consentExempt: true,
  audit: 'consent.grant',
  scope: async (ctx, input) => canConsent(ctx.repo, ctx.caller.userId, ctx.caller.roles, ctx.caller.schoolId, input.studentId),
  async handler(ctx, input) {
    if (!input.scopes.includes('basic_processing')) throw new AppError('INVALID_ARGUMENT', '参数不正确');
    const student = await ctx.repo.getStudent(input.studentId);
    if (!student || student.schoolId !== ctx.caller.schoolId) throw new AppError('NOT_FOUND', '资源不存在');
    const kind = student.ageBand === 'under14' ? 'guardian_minor' : 'privacy';
    if (student.ageBand === 'under14' && ctx.caller.roles.includes('student') && !ctx.caller.roles.includes('parent')) {
      throw new AppError('FAILED_PRECONDITION', '未满 14 岁需由监护人同意');
    }
    const policy = await ctx.repo.currentPolicy(kind);
    if (!policy || policy.version !== input.policyVersion) throw new AppError('FAILED_PRECONDITION', '同意书版本不是当前版本');
    const consentId = nid('con_');
    await ctx.repo.db.insert(COLLECTIONS.consents, {
      _id: consentId,
      schoolId: ctx.caller.schoolId,
      subjectStudentId: input.studentId,
      grantorUserId: ctx.caller.userId,
      grantorRole: ctx.caller.roles.includes('parent') ? 'guardian' : 'student_self',
      policyVersion: input.policyVersion,
      scopes: input.scopes,
      grantedAt: ctx.clock.now(),
      schemaVersion: 1,
    });
    await ctx.repo.db.compareAndSet(COLLECTIONS.studentProfiles, input.studentId, undefined, { consentStatus: 'granted' });
    const userId = asString(student.userId);
    const user = userId ? await ctx.repo.getUser(userId) : null;
    if (user && user.status === 'pending_consent') {
      await ctx.repo.updateUser(user._id, { status: 'active', updatedAt: ctx.clock.now(), updatedBy: ctx.caller.userId });
    }
    return { consentId, studentId: input.studentId };
  },
});

registerAction({
  name: 'consent.revoke',
  fn: FUNCTIONS.apiCore,
  roles: ['parent', 'student'],
  input: z.object({ studentId: z.string().min(1).max(80) }).strip(),
  consentExempt: true,
  audit: 'consent.revoke',
  scope: async (ctx, input) => canConsent(ctx.repo, ctx.caller.userId, ctx.caller.roles, ctx.caller.schoolId, input.studentId),
  async handler(ctx, input) {
    const student = await ctx.repo.getStudent(input.studentId);
    if (!student || student.schoolId !== ctx.caller.schoolId) throw new AppError('NOT_FOUND', '资源不存在');
    const consents = await ctx.repo.listConsentsForStudent(input.studentId);
    const current = consents.find((doc) => doc.revokedAt == null);
    if (!current) throw new AppError('NOT_FOUND', '资源不存在');
    await ctx.repo.db.compareAndSet(COLLECTIONS.consents, current._id, undefined, { revokedAt: ctx.clock.now() });
    await ctx.repo.db.compareAndSet(COLLECTIONS.studentProfiles, input.studentId, undefined, { consentStatus: 'revoked' });
    const userId = asString(student.userId);
    if (userId) await ctx.repo.updateUser(userId, { status: 'suspended', updatedAt: ctx.clock.now(), updatedBy: ctx.caller.userId });
    return { ok: true, studentId: input.studentId };
  },
});

async function canConsent(
  repo: { isGuardianOf: (parentId: string, studentId: string, schoolId: string) => Promise<boolean>; isSelf: (userId: string, studentId: string) => Promise<boolean> },
  userId: string,
  roles: string[],
  schoolId: string,
  studentId: string,
): Promise<boolean> {
  if (roles.includes('parent') && (await repo.isGuardianOf(userId, studentId, schoolId))) return true;
  if (roles.includes('student') && (await repo.isSelf(userId, studentId))) return true;
  return false;
}
