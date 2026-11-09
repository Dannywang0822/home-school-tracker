import {
  ERROR_MESSAGES,
  type ApiResult,
  type ErrorCode,
  type FunctionName,
  type Locale,
  apiRequestSchema,
} from '@hst/shared';
import { ZodError } from 'zod';
import { AppError } from './app-error.js';
import type { AuthContext, Caller } from './auth/caller.js';
import { resolveCaller } from './auth/caller.js';
import { getAction } from './auth/registry.js';
import type { Clock } from './clock.js';
import type { AppConfig } from './config.js';
import type { DocStore } from './db/types.js';
import { MemoryObjectStorage, type ObjectStorage } from './storage/types.js';
import { Repo } from './repo.js';
import { asString, newRequestId } from './util.js';
import './actions/load.js';

const TARGET_KEYS = ['studentId', 'taskId', 'threadId', 'fileId', 'planId', 'experienceId', 'projectId', 'courseId'] as const;

export interface DispatchDeps {
  db: DocStore;
  clock: Clock;
  config: AppConfig;
  storage?: ObjectStorage;
}

export function createDispatcher(deps: DispatchDeps) {
  return async function dispatch(
    functionName: FunctionName | string,
    raw: unknown,
    auth: AuthContext | null,
  ): Promise<ApiResult> {
    const requestId = peekRequestId(raw);
    const locale = peekLocale(raw);
    try {
      const parsed = apiRequestSchema.safeParse(raw);
      if (!parsed.success) {
        return failure(requestId, 'INVALID_ARGUMENT', locale, fieldErrors(parsed.error));
      }
      const action = getAction(parsed.data.action);
      if (!action || action.fn !== functionName) {
        return failure(requestId, 'INVALID_ARGUMENT', parsed.data.locale ?? locale);
      }
      const requestLocale = parsed.data.locale ?? locale;
      const caller = await resolveIfNeeded(deps, auth, action.public === true);
      if (!action.public && !caller) {
        return failure(parsed.data.requestId ?? requestId, 'UNAUTHENTICATED', requestLocale);
      }
      const effective = caller ?? anonymousCaller(requestLocale);
      if (!action.public && !effective.roles.some((role) => action.roles.includes(role))) {
        await deny(deps, effective, parsed.data.action, 'PERMISSION_DENIED', parsed.data.requestId ?? requestId, parsed.data.data);
        return failure(parsed.data.requestId ?? requestId, 'PERMISSION_DENIED', requestLocale);
      }
      if (caller && caller.mustChangePassword && !action.allowDuringPasswordChange) {
        return failure(parsed.data.requestId ?? requestId, 'PASSWORD_CHANGE_REQUIRED', requestLocale);
      }
      if (caller && !caller.consentOk && !action.consentExempt) {
        return failure(parsed.data.requestId ?? requestId, 'CONSENT_REQUIRED', requestLocale, {
          studentIds: caller.pendingConsentStudentIds,
        });
      }
      const inputParsed = action.input.safeParse(parsed.data.data ?? {});
      if (!inputParsed.success) {
        return failure(parsed.data.requestId ?? requestId, 'INVALID_ARGUMENT', requestLocale, {
          fields: zodFields(inputParsed.error),
        });
      }
      const repo = new Repo(deps.db);
      const ctx = {
        caller: effective,
        repo,
        clock: deps.clock,
        requestId: parsed.data.requestId ?? requestId,
        locale: requestLocale,
        functionName,
        config: deps.config,
        storage: deps.storage ?? new MemoryObjectStorage(),
      };
      if (action.idempotent && parsed.data.requestId && caller) {
        const cached = await repo.getIdempotent(`${caller.userId}:${parsed.data.requestId}`, deps.clock.now());
        const stored = cached?.response;
        if (stored && typeof stored === 'object') return stored as ApiResult;
      }
      const allowed = await action.scope(ctx, inputParsed.data);
      if (!allowed) {
        await deny(deps, effective, parsed.data.action, 'NOT_FOUND', ctx.requestId, inputParsed.data);
        return failure(ctx.requestId, 'NOT_FOUND', requestLocale);
      }
      const data = await action.handler(ctx, inputParsed.data);
      const result: ApiResult = { ok: true, data, requestId: ctx.requestId };
      if (action.audit && caller) {
        await repo.appendAudit({
          at: deps.clock.now(),
          actorUserId: caller.userId,
          actorRoles: caller.roles,
          action: action.audit,
          result: 'ok',
          requestId: ctx.requestId,
          client: caller.client,
          studentId: idFrom(data, 'studentId'),
          targetId: idFrom(data, 'guardianshipId') ?? idFrom(data, 'messageId') ?? idFrom(data, 'jobId') ?? idFrom(data, 'inviteId'),
          meta: { action: action.audit },
        });
      }
      if (action.idempotent && parsed.data.requestId && caller) {
        await repo.putIdempotent({
          _id: `${caller.userId}:${parsed.data.requestId}`,
          response: result as unknown as DocRecord,
          expiresAt: deps.clock.now() + 10 * 60 * 1000,
        });
      }
      return result;
    } catch (error) {
      if (error instanceof AppError) {
        const caller = await resolveQuietly(deps, auth);
        if (caller && (error.code === 'NOT_FOUND' || error.code === 'PERMISSION_DENIED' || error.code === 'RATE_LIMITED' || error.code === 'INVITE_INVALID')) {
          await deny(deps, caller, peekAction(raw), error.code, requestId, undefined);
        }
        return failure(requestId, error.code, locale, publicDetails(error));
      }
      if (error instanceof ZodError) {
        return failure(requestId, 'INVALID_ARGUMENT', locale, { fields: zodFields(error) });
      }
      console.error(JSON.stringify({ requestId, code: 'INTERNAL' }));
      return failure(requestId, 'INTERNAL', locale);
    }
  };
}

type DocRecord = { _id: string; [key: string]: unknown };

async function resolveIfNeeded(deps: DispatchDeps, auth: AuthContext | null, isPublic: boolean): Promise<Caller | null> {
  if (!auth || (!auth.uid && !auth.openId && !auth.customUserId) || auth.loginType === 'ANONYMOUS') {
    if (isPublic) return null;
    throw new AppError('UNAUTHENTICATED', '未登录');
  }
  return resolveCaller(new Repo(deps.db), auth);
}

async function resolveQuietly(deps: DispatchDeps, auth: AuthContext | null): Promise<Caller | null> {
  try {
    if (!auth) return null;
    return await resolveCaller(new Repo(deps.db), auth);
  } catch {
    return null;
  }
}

async function deny(
  deps: DispatchDeps,
  caller: Caller,
  actionName: string,
  code: ErrorCode,
  requestId: string,
  input: unknown,
): Promise<void> {
  if (!caller.userId) return;
  const repo = new Repo(deps.db);
  const auditAction = code === 'INVITE_INVALID' || actionName.startsWith('guardian.redeem') || actionName.startsWith('guardian.confirm')
    ? 'invite.redeem'
    : 'authz.denied';
  await repo.appendAudit({
    at: deps.clock.now(),
    actorUserId: caller.userId,
    actorRoles: caller.roles,
    action: auditAction,
    result: 'denied',
    requestId,
    client: caller.client,
    targetType: actionName,
    targetId: targetFrom(input),
    studentId: studentFrom(input),
    meta: { code, action: actionName },
  });
  const window = String(Math.floor(deps.clock.now() / (10 * 60 * 1000)));
  const hit = await repo.hitRateLimit('authz.denied', caller.userId, window, 10_000);
  if (hit.count === 20) {
    const admins = await repo.listAdmins(caller.schoolId);
    for (const admin of admins) {
      const dedupeKey = `authz-alert:${admin._id}:${window}`;
      if (await repo.findNotificationByDedupe(dedupeKey)) continue;
      await repo.insertNotification({
        _id: `ntf_alert_${admin._id}_${window}`,
        recipientUserId: admin._id,
        recipientAuthUid: '',
        type: 'system',
        title: { zh: '异常访问告警', en: 'Access alert' },
        body: { zh: '同一账号 10 分钟内被拒绝 20 次', en: '20 denied requests in 10 minutes' },
        link: '',
        refType: 'audit',
        refId: caller.userId,
        digest: { pending: false },
        dedupeKey,
        createdAt: deps.clock.now(),
        schoolId: caller.schoolId,
      });
    }
  }
}

function anonymousCaller(locale: Locale): Caller {
  return {
    userId: '',
    roles: [],
    schoolId: '',
    client: 'web',
    consentOk: true,
    pendingConsentStudentIds: [],
    status: 'active',
    mustChangePassword: false,
    locale,
  };
}

function failure(requestId: string, code: ErrorCode, locale: Locale, details?: Record<string, unknown>): ApiResult {
  const error: { code: ErrorCode; message: string; details?: Record<string, unknown> } = {
    code,
    message: ERROR_MESSAGES[code][locale] ?? ERROR_MESSAGES[code].zh,
  };
  if (details && Object.keys(details).length > 0) error.details = details;
  return { ok: false, error, requestId };
}

function publicDetails(error: AppError): Record<string, unknown> | undefined {
  if (!error.details) return undefined;
  const allowed: Record<string, unknown> = {};
  for (const key of ['fields', 'studentIds', 'retryAfterSec', 'status', 'jobId', 'total', 'errors'] as const) {
    if (key in error.details) allowed[key] = error.details[key];
  }
  return Object.keys(allowed).length > 0 ? allowed : undefined;
}

function fieldErrors(error: ZodError): Record<string, unknown> {
  return { fields: zodFields(error) };
}

function zodFields(error: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    fields[issue.path.join('.') || '_'] = issue.message;
  }
  return fields;
}

function peekRequestId(raw: unknown): string {
  if (raw && typeof raw === 'object' && 'requestId' in raw && typeof raw.requestId === 'string') {
    return raw.requestId;
  }
  return newRequestId();
}

function peekLocale(raw: unknown): Locale {
  if (raw && typeof raw === 'object' && 'locale' in raw && (raw.locale === 'zh' || raw.locale === 'en')) {
    return raw.locale;
  }
  return 'zh';
}

function peekAction(raw: unknown): string {
  if (raw && typeof raw === 'object' && 'action' in raw && typeof raw.action === 'string') return raw.action;
  return '';
}

function targetFrom(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const record = input as Record<string, unknown>;
  for (const key of TARGET_KEYS) {
    const value = asString(record[key]);
    if (value && value.length <= 80) return value;
  }
  return undefined;
}

function studentFrom(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const value = asString((input as Record<string, unknown>).studentId);
  return value && value.length <= 80 ? value : undefined;
}

function idFrom(data: unknown, key: string): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const value = asString((data as Record<string, unknown>)[key]);
  return value && value.length <= 80 ? value : undefined;
}
