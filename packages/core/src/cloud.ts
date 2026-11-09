import { ERROR_MESSAGES, FUNCTIONS, type FunctionName } from '@hst/shared';
import { readCloudAuth } from './auth/caller.js';
import { newRequestId } from './util.js';
import { evaluateInvoke } from './rules/evaluate.js';

export function normalizeEvent(event: unknown): unknown {
  if (!event || typeof event !== 'object') return event;
  const record = event as Record<string, unknown>;
  if (typeof record.action === 'string') return record;
  if (typeof record.body === 'string') {
    try {
      return JSON.parse(record.body) as unknown;
    } catch {
      return record;
    }
  }
  if (record.body && typeof record.body === 'object') return record.body;
  return record;
}

/**
 * Cloud function entry. Week 1 does not connect to CloudBase: without
 * HST_DATA_BACKEND=cloudbase the function refuses the call instead of
 * serving demo data. Identity comes only from the platform context.
 */
export function createFunctionMain(functionName: FunctionName) {
  return async function main(_event: unknown, context: unknown) {
    const requestId = newRequestId();
    const auth = readCloudAuth(context);
    const invoke = evaluateInvoke({
      functionName,
      auth: auth
        ? { uid: auth.uid ?? auth.openId ?? auth.customUserId ?? null, loginType: auth.loginType ?? null }
        : null,
    });
    if (invoke.decision === 'deny') {
      return {
        ok: false,
        error: { code: 'UNAUTHENTICATED', message: ERROR_MESSAGES.UNAUTHENTICATED.zh },
        requestId,
      };
    }
    if (process.env.HST_DATA_BACKEND !== 'cloudbase') {
      return {
        ok: false,
        error: { code: 'INTERNAL', message: '数据后端未配置' },
        requestId,
      };
    }
    return {
      ok: false,
      error: { code: 'NOT_IMPLEMENTED', message: 'CloudBase 适配器将在有凭据后启用' },
      requestId,
    };
  };
}

export function createCronMain(functionName: FunctionName) {
  return async function main(_event: unknown, context: unknown) {
    const requestId = newRequestId();
    const auth = readCloudAuth(context);
    if (auth || functionName === FUNCTIONS.apiCore) {
      return {
        ok: false,
        error: { code: 'PERMISSION_DENIED', message: ERROR_MESSAGES.PERMISSION_DENIED.zh },
        requestId,
      };
    }
    const invoke = evaluateInvoke({ functionName, auth: null });
    if (invoke.decision !== 'deny') {
      return {
        ok: false,
        error: { code: 'PERMISSION_DENIED', message: ERROR_MESSAGES.PERMISSION_DENIED.zh },
        requestId,
      };
    }
    return { ok: true, data: { job: functionName, status: 'noop' }, requestId };
  };
}
