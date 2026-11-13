import { FUNCTIONS, ROLES, type Role } from '@hst/shared';
import { z } from 'zod';
import { AppError } from '../app-error.js';
import { activeChildIds, displayNameOf, maskDisplayName } from '../auth/access.js';
import { registerAction } from '../auth/registry.js';
import type { Doc } from '../db/types.js';
import { hashInviteCode, nid, asString, randomSecret } from '../util.js';

const humanRoles = ROLES.filter((role) => role !== 'ops_mailer');

const noInput = z.object({}).strip();

function i18n(value: unknown): { zh: string; en?: string } {
  if (value && typeof value === 'object') {
    const record = value as { zh?: unknown; en?: unknown };
    const en = asString(record.en);
    return en ? { zh: asString(record.zh) ?? '', en } : { zh: asString(record.zh) ?? '' };
  }
  return { zh: '' };
}

async function childrenOf(ctx: Parameters<typeof activeChildIds>[0]) {
  if (!ctx.caller.roles.includes('parent')) return [];
  const ids = (await activeChildIds(ctx)).sort();
  const items = [];
  for (const studentId of ids) {
    const student = await ctx.repo.getStudent(studentId);
    const user = student ? await ctx.repo.getUser(asString(student.userId) ?? '') : null;
    const homeroom = student ? await ctx.repo.getClass(asString(student.homeroomClassId) ?? '') : null;
    items.push({
      studentId,
      displayName: displayNameOf(user),
      programme: student?.programme ?? '',
      className: i18n(homeroom?.name),
      relation: await relationOf(ctx, studentId),
    });
  }
  return items;
}

async function relationOf(ctx: Parameters<typeof activeChildIds>[0], studentId: string): Promise<string> {
  const links = await ctx.repo.activeChildLinks(ctx.caller.userId, ctx.caller.schoolId);
  const link = links.find((doc) => doc.studentId === studentId);
  return asString(link?.relation) ?? 'guardian';
}

async function userView(ctx: Parameters<typeof activeChildIds>[0]) {
  const user = await ctx.repo.getUser(ctx.caller.userId);
  const student = ctx.caller.roles.includes('student') ? await ctx.repo.findStudentByUserId(ctx.caller.userId) : null;
  return {
    id: ctx.caller.userId,
    displayName: displayNameOf(user),
    roles: ctx.caller.roles,
    locale: ctx.caller.locale,
    status: ctx.caller.status,
    mustChangePassword: ctx.caller.mustChangePassword,
    ...(student ? { studentId: student._id } : {}),
  };
}

registerAction({
  name: 'auth.resolve',
  fn: FUNCTIONS.apiCore,
  roles: ROLES,
  input: noInput,
  consentExempt: true,
  allowDuringPasswordChange: true,
  scope: async () => true,
  async handler(ctx) {
    return {
      user: await userView(ctx),
      children: await childrenOf(ctx),
      pendingConsents: ctx.caller.pendingConsentStudentIds,
    };
  },
});

registerAction({
  name: 'me.get',
  fn: FUNCTIONS.apiCore,
  roles: ROLES,
  input: noInput,
  consentExempt: true,
  allowDuringPasswordChange: true,
  scope: async () => true,
  async handler(ctx) {
    const school = await ctx.repo.getSchool(ctx.caller.schoolId);
    const year = await ctx.repo.currentYear(ctx.caller.schoolId);
    const term = year ? await ctx.repo.currentTerm(year._id, ctx.clock.now()) : null;
    return {
      user: await userView(ctx),
      children: await childrenOf(ctx),
      pendingConsents: ctx.caller.pendingConsentStudentIds,
      school: {
        name: i18n(school?.name),
        timezone: asString(school?.timezone) ?? 'Asia/Shanghai',
        currentYear: year ? { id: year._id, name: year.name } : null,
        currentTerm: term ? { id: term._id, name: i18n(term.name), index: term.index } : null,
      },
    };
  },
});

registerAction({
  name: 'me.update',
  fn: FUNCTIONS.apiCore,
  roles: humanRoles,
  input: z
    .object({
      locale: z.enum(['zh', 'en']).optional(),
      displayName: z.object({ zh: z.string().min(1).max(40), en: z.string().max(40).optional() }).optional(),
    })
    .strip(),
  consentExempt: true,
  allowDuringPasswordChange: true,
  scope: async () => true,
  async handler(ctx, input) {
    const patch: Partial<Doc> = { updatedAt: ctx.clock.now(), updatedBy: ctx.caller.userId };
    if (input.locale) patch.locale = input.locale;
    if (input.displayName) patch.displayName = input.displayName;
    await ctx.repo.updateUser(ctx.caller.userId, patch);
    if (input.locale) ctx.caller.locale = input.locale;
    return { user: await userView(ctx) };
  },
});

registerAction({
  name: 'auth.passwordChanged',
  fn: FUNCTIONS.apiCore,
  roles: humanRoles,
  input: noInput,
  consentExempt: true,
  allowDuringPasswordChange: true,
  scope: async () => true,
  async handler(ctx) {
    await ctx.repo.updateUser(ctx.caller.userId, {
      mustChangePassword: false,
      updatedAt: ctx.clock.now(),
      updatedBy: ctx.caller.userId,
    });
    return { ok: true };
  },
});

registerAction({
  name: 'consent.policy',
  fn: FUNCTIONS.authPublic,
  roles: ROLES,
  public: true,
  input: z.object({ kind: z.enum(['privacy', 'guardian_minor']), locale: z.enum(['zh', 'en']).optional() }).strip(),
  consentExempt: true,
  allowDuringPasswordChange: true,
  scope: async () => true,
  async handler(ctx, input) {
    const policy = await ctx.repo.currentPolicy(input.kind);
    if (!policy) throw new AppError('NOT_FOUND', '资源不存在');
    return {
      version: policy.version,
      content: i18n(policy.content),
      effectiveAt: policy.effectiveAt,
    };
  },
});

registerAction({
  name: 'auth.identities',
  fn: FUNCTIONS.apiCore,
  roles: humanRoles,
  input: noInput,
  consentExempt: true,
  allowDuringPasswordChange: true,
  scope: async () => true,
  async handler(ctx) {
    const rows = await ctx.repo.listIdentities(ctx.caller.userId);
    return {
      items: rows.map((doc) => ({ provider: doc.provider, boundAt: doc.boundAt })),
    };
  },
});

registerAction({
  name: 'auth.wechatBindCode',
  fn: FUNCTIONS.apiCore,
  roles: humanRoles,
  input: noInput,
  consentExempt: true,
  allowDuringPasswordChange: true,
  idempotent: true,
  scope: async () => true,
  async handler(ctx) {
    if (!ctx.config.invitePepper) throw new AppError('FAILED_PRECONDITION', '邀请码密钥未配置');
    const window = String(Math.floor(ctx.clock.now() / 3_600_000));
    const limit = await ctx.repo.hitRateLimit('auth.wechatBindCode', ctx.caller.userId, window, 5);
    if (!limit.allowed) {
      throw new AppError('RATE_LIMITED', '操作太频繁', { retryAfterSec: retryAfter(ctx.clock.now()) });
    }
    const code = randomSecret(6);
    const now = ctx.clock.now();
    await ctx.repo.insertInvite({
      _id: nid('inv_'),
      type: 'wechat_bind',
      codeHash: hashInviteCode(code, ctx.config.invitePepper),
      studentId: '',
      targetUserId: ctx.caller.userId,
      createdBy: ctx.caller.userId,
      expiresAt: now + 5 * 60 * 1000,
      maxUses: 1,
      usedCount: 0,
      status: 'active',
      version: 1,
      schoolId: ctx.caller.schoolId,
      createdAt: now,
    });
    return { code, expiresAt: now + 5 * 60 * 1000 };
  },
});

registerAction({
  name: 'auth.wechatLogin',
  fn: FUNCTIONS.authPublic,
  roles: ROLES,
  public: true,
  input: z.object({ appId: z.string().min(1).max(64), jsCode: z.string().min(1).max(128) }).strip(),
  consentExempt: true,
  allowDuringPasswordChange: true,
  scope: async () => true,
  async handler(ctx) {
    if (!ctx.config.wechatConfigured) {
      throw new AppError('NOT_IMPLEMENTED', '微信登录尚未配置');
    }
    throw new AppError('NOT_IMPLEMENTED', '微信登录尚未配置');
  },
});

const inviteCode = z.object({ code: z.string().min(8).max(8) }).strip();

registerAction({
  name: 'guardian.redeemInvite',
  fn: FUNCTIONS.apiCore,
  roles: ['parent'] as Role[],
  input: inviteCode,
  consentExempt: true,
  allowDuringPasswordChange: true,
  scope: async () => true,
  async handler(ctx, input) {
    if (!ctx.config.invitePepper) throw new AppError('FAILED_PRECONDITION', '邀请码密钥未配置');
    const window = String(Math.floor(ctx.clock.now() / 3_600_000));
    const limit = await ctx.repo.hitRateLimit('guardian.redeemInvite', ctx.caller.userId, window, 5);
    if (!limit.allowed) {
      throw new AppError('RATE_LIMITED', '操作太频繁', { retryAfterSec: retryAfter(ctx.clock.now()) });
    }
    const invite = await ctx.repo.findInviteByHash(hashInviteCode(input.code, ctx.config.invitePepper));
    if (!invite || invite.status !== 'active' || (typeof invite.expiresAt === 'number' && invite.expiresAt <= ctx.clock.now())) {
      throw new AppError('INVITE_INVALID', '邀请码无效或已过期');
    }
    if ((typeof invite.usedCount === 'number' ? invite.usedCount : 0) >= (typeof invite.maxUses === 'number' ? invite.maxUses : 1)) {
      throw new AppError('INVITE_INVALID', '邀请码无效或已过期');
    }
    const student = await ctx.repo.getStudent(asString(invite.studentId) ?? '');
    const user = student ? await ctx.repo.getUser(asString(student.userId) ?? '') : null;
    const homeroom = student ? await ctx.repo.getClass(asString(student.homeroomClassId) ?? '') : null;
    return {
      studentId: student?._id,
      displayName: maskDisplayName(displayNameOf(user).zh),
      className: i18n(homeroom?.name),
    };
  },
});

registerAction({
  name: 'guardian.confirmInvite',
  fn: FUNCTIONS.apiCore,
  roles: ['parent'] as Role[],
  input: z
    .object({
      code: z.string().min(8).max(8),
      relation: z.enum(['mother', 'father', 'guardian', 'other']),
    })
    .strip(),
  consentExempt: true,
  allowDuringPasswordChange: true,
  audit: 'guardian.bind',
  idempotent: true,
  scope: async () => true,
  async handler(ctx, input) {
    if (!ctx.config.invitePepper) throw new AppError('FAILED_PRECONDITION', '邀请码密钥未配置');
    const invite = await ctx.repo.findInviteByHash(hashInviteCode(input.code, ctx.config.invitePepper));
    if (!invite || invite.status !== 'active' || (typeof invite.expiresAt === 'number' && invite.expiresAt <= ctx.clock.now())) {
      throw new AppError('INVITE_INVALID', '邀请码无效或已过期');
    }
    const version = typeof invite.version === 'number' ? invite.version : undefined;
    const studentId = asString(invite.studentId);
    if (!studentId) throw new AppError('INVITE_INVALID', '邀请码无效或已过期');
    await ctx.repo.consumeInvite(invite._id, version, {
      status: 'used',
      usedCount: (typeof invite.usedCount === 'number' ? invite.usedCount : 0) + 1,
      usedBy: ctx.caller.userId,
      usedAt: ctx.clock.now(),
    });
    const guardianshipId = nid('grd_');
    await ctx.repo.insertGuardianship({
      _id: guardianshipId,
      schoolId: ctx.caller.schoolId,
      parentId: ctx.caller.userId,
      studentId,
      relation: input.relation,
      status: 'active',
      source: 'invite',
      isPrimary: false,
      receivesEmail: true,
      createdAt: ctx.clock.now(),
      createdBy: ctx.caller.userId,
      updatedAt: ctx.clock.now(),
      updatedBy: ctx.caller.userId,
      schemaVersion: 1,
    });
    return { guardianshipId, studentId };
  },
});

function retryAfter(now: number): number {
  return Math.max(1, 3600 - Math.floor((now % 3_600_000) / 1000));
}

