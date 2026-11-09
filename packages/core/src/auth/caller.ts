import type { Role } from '@hst/shared';
import { isRole } from '@hst/shared';
import { AppError } from '../app-error.js';
import type { Repo } from '../repo.js';
import { asString, asStringArray } from '../util.js';

export interface AuthContext {
  uid?: string;
  openId?: string;
  customUserId?: string;
  loginType?: string;
  client?: 'web' | 'mp';
}

export interface Caller {
  userId: string;
  roles: Role[];
  schoolId: string;
  client: 'web' | 'mp';
  consentOk: boolean;
  pendingConsentStudentIds: string[];
  status: string;
  mustChangePassword: boolean;
  locale: 'zh' | 'en';
}

export async function resolveCaller(repo: Repo, auth: AuthContext | null): Promise<Caller> {
  if (!auth || auth.loginType === 'ANONYMOUS') {
    throw new AppError('UNAUTHENTICATED', '未登录');
  }
  if (!auth.customUserId && !auth.uid && !auth.openId) {
    throw new AppError('UNAUTHENTICATED', '未登录');
  }

  let userId: string | undefined;
  if (auth.customUserId) {
    const identity = await repo.findIdentity('custom', auth.customUserId);
    if (!identity || identity.userId !== auth.customUserId) {
      throw new AppError('UNAUTHENTICATED', '未登录');
    }
    userId = auth.customUserId;
  } else if (auth.uid) {
    const identity = await repo.findIdentity('cloudbase_uid', auth.uid);
    if (!identity) throw new AppError('UNAUTHENTICATED', '未登录');
    userId = asString(identity.userId);
  } else if (auth.openId) {
    const identity = await repo.findIdentity('wechat_mp_openid', auth.openId);
    if (!identity) throw new AppError('UNAUTHENTICATED', '未登录');
    userId = asString(identity.userId);
  }
  if (!userId) throw new AppError('UNAUTHENTICATED', '未登录');

  const user = await repo.getUser(userId);
  if (!user) throw new AppError('UNAUTHENTICATED', '未登录');
  const status = asString(user.status) ?? '';
  if (status === 'suspended' || status === 'archived' || status === 'invited') {
    throw new AppError('ACCOUNT_DISABLED', '账号已停用', { status });
  }

  const roles = asStringArray(user.roles).filter(isRole);
  const schoolId = asString(user.schoolId) ?? '';
  const consent = await consentState(repo, userId, roles, schoolId);
  return {
    userId,
    roles,
    schoolId,
    client: auth.client ?? (auth.openId && !auth.uid ? 'mp' : 'web'),
    consentOk: consent.ok,
    pendingConsentStudentIds: consent.pending,
    status,
    mustChangePassword: user.mustChangePassword === true,
    locale: user.locale === 'en' ? 'en' : 'zh',
  };
}

async function consentState(
  repo: Repo,
  userId: string,
  roles: Role[],
  schoolId: string,
): Promise<{ ok: boolean; pending: string[] }> {
  if (roles.includes('student')) {
    const profile = await repo.findStudentByUserId(userId);
    if (!profile) return { ok: false, pending: [] };
    if (profile.consentStatus === 'granted') return { ok: true, pending: [] };
    return { ok: false, pending: [profile._id] };
  }
  if (roles.includes('parent')) {
    const links = await repo.activeChildLinks(userId, schoolId);
    const pending: string[] = [];
    for (const link of links) {
      const studentId = asString(link.studentId);
      if (!studentId) continue;
      const student = await repo.getStudent(studentId);
      if (!student || student.consentStatus !== 'granted') pending.push(studentId);
    }
    return { ok: pending.length === 0, pending };
  }
  return { ok: true, pending: [] };
}

export function readCloudAuth(context: unknown): AuthContext | null {
  if (!context || typeof context !== 'object') return null;
  const record = context as Record<string, unknown>;
  const userInfo = (record.userInfo ?? record.user ?? {}) as Record<string, unknown>;
  const uid = asString(userInfo.uid);
  const openId = asString(userInfo.openId ?? userInfo.openid);
  const customUserId = asString(userInfo.customUserId);
  const loginType = asString(userInfo.loginType ?? record.loginType);
  if (!uid && !openId && !customUserId) return null;
  return {
    uid,
    openId,
    customUserId,
    loginType: loginType ?? (openId && !uid ? 'WECHAT' : 'EMAIL'),
  };
}
