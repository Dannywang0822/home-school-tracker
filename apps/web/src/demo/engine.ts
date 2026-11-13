import { COLLECTIONS } from '@hst/shared';
import { MemoryObjectStorage, createDispatcher, frozenClock, hashDevPassword } from '@hst/core';
import type { ApiResult } from '@hst/shared';
import { DEV_DEMO_PASSWORD, NOW, PEPPER, createFixture, verifyDevPassword } from '@hst/fixture';

interface DemoEngine {
  dispatch: ReturnType<typeof createDispatcher>;
  storage: MemoryObjectStorage;
  db: Awaited<ReturnType<typeof createFixture>>['db'];
  sessions: Map<string, string>;
  codes: Map<string, { code: string; expiresAt: number }>;
}

let enginePromise: Promise<DemoEngine> | null = null;

function engine(): Promise<DemoEngine> {
  if (!enginePromise) enginePromise = boot();
  return enginePromise;
}

async function boot(): Promise<DemoEngine> {
  const fixture = await createFixture();
  const storage = new MemoryObjectStorage();
  return {
    db: fixture.db,
    storage,
    sessions: new Map(),
    codes: new Map(),
    dispatch: createDispatcher({
      db: fixture.db,
      storage,
      clock: frozenClock(NOW),
      config: { invitePepper: PEPPER, mailFrom: 'dannysuperbot@mail.grokbot.com', wechatConfigured: false },
    }),
  };
}

function tokenFor(uid: string): string {
  return `demo.${uid}`;
}

async function loginWithPassword(email: string, password: string): Promise<{ uid: string } | null> {
  const demo = await engine();
  const normalized = email.trim().toLowerCase();
  const users = await demo.db.query(COLLECTIONS.users, (doc) => doc.email === normalized && doc.deletedAt == null);
  const user = users[0];
  if (user && user.devLoginHash === hashDevPassword(password)) {
    const identities = await demo.db.query(
      COLLECTIONS.authIdentities,
      (doc) => doc.userId === user._id && doc.provider === 'cloudbase_uid' && doc.unboundAt == null,
    );
    const uid = identities[0]?.key;
    if (typeof uid === 'string') return { uid };
  }
  const known = verifyDevPassword(normalized, password);
  return known ? { uid: known.uid } : null;
}

function strongPassword(value: string): boolean {
  if (value.length < 8 || value.length > 32) return false;
  return [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(value)).length >= 3;
}

export async function demoRequest(path: string, body: unknown, token: string): Promise<ApiResult> {
  const demo = await engine();
  const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  if (path === '/api/dev/login') {
    const email = typeof record.email === 'string' ? record.email : '';
    const password = typeof record.password === 'string' ? record.password : '';
    const found = await loginWithPassword(email, password);
    if (!found) return { ok: false, error: { code: 'UNAUTHENTICATED', message: '邮箱或密码不正确' }, requestId: 'demo-login' };
    const issued = tokenFor(found.uid);
    demo.sessions.set(issued, found.uid);
    return { ok: true, data: { token: issued }, requestId: 'demo-login' };
  }
  if (path === '/api/dev/email-code/send') {
    const email = typeof record.email === 'string' ? record.email.trim().toLowerCase() : '';
    const known = verifyDevPassword(email, DEV_DEMO_PASSWORD);
    if (!known) return { ok: true, data: { sent: true }, requestId: 'demo-code' };
    const code = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
    demo.codes.set(email, { code, expiresAt: Date.now() + 10 * 60 * 1000 });
    return { ok: true, data: { sent: true, demoCode: code }, requestId: 'demo-code' };
  }
  if (path === '/api/dev/email-code/verify') {
    const email = typeof record.email === 'string' ? record.email.trim().toLowerCase() : '';
    const code = typeof record.code === 'string' ? record.code.trim() : '';
    const pending = demo.codes.get(email);
    const known = verifyDevPassword(email, DEV_DEMO_PASSWORD);
    if (!pending || pending.expiresAt < Date.now() || !known || pending.code !== code) {
      return { ok: false, error: { code: 'UNAUTHENTICATED', message: '验证码不正确或已过期' }, requestId: 'demo-code' };
    }
    demo.codes.delete(email);
    const issued = tokenFor(known.uid);
    demo.sessions.set(issued, known.uid);
    return { ok: true, data: { token: issued }, requestId: 'demo-code' };
  }
  if (path === '/api/dev/upload') {
    const uid = demo.sessions.get(token) ?? (token.startsWith('demo.') ? token.slice(5) : '');
    const name = typeof record.name === 'string' ? record.name.slice(0, 180) : '';
    const mime = typeof record.mime === 'string' ? record.mime : '';
    const dataBase64 = typeof record.dataBase64 === 'string' ? record.dataBase64 : '';
    if (!uid || !name || !mime || !dataBase64) {
      return { ok: false, error: { code: 'INVALID_ARGUMENT', message: '参数不正确' }, requestId: 'demo-upload' };
    }
    const body = decodeBase64(dataBase64);
    if (body.byteLength === 0 || body.byteLength > 20 * 1024 * 1024) {
      return { ok: false, error: { code: 'FILE_TOO_LARGE', message: '文件太大' }, requestId: 'demo-upload' };
    }
    const tmp = `hst_tmp/demo/${crypto.randomUUID().replaceAll('-', '')}`;
    await demo.storage.put(tmp, { body, mime });
    return { ok: true, data: { tmpCloudFileId: tmp, size: body.byteLength }, requestId: 'demo-upload' };
  }
  if (path === '/api/dev/password') {
    const uid = demo.sessions.get(token) ?? (token.startsWith('demo.') ? token.slice(5) : '');
    const password = typeof record.password === 'string' ? record.password : '';
    if (!uid || !strongPassword(password)) {
      return { ok: false, error: { code: 'INVALID_ARGUMENT', message: '密码不符合要求' }, requestId: 'demo-password' };
    }
    const identities = await demo.db.query(
      COLLECTIONS.authIdentities,
      (doc) => doc.provider === 'cloudbase_uid' && doc.key === uid && doc.unboundAt == null,
    );
    const userId = identities[0]?.userId;
    if (typeof userId !== 'string') {
      return { ok: false, error: { code: 'UNAUTHENTICATED', message: '未登录' }, requestId: 'demo-password' };
    }
    await demo.db.compareAndSet(COLLECTIONS.users, userId, undefined, { devLoginHash: hashDevPassword(password) });
    return { ok: true, data: { updated: true }, requestId: 'demo-password' };
  }
  const functionName = path.replace(/^\/api\//, '');
  const uid = demo.sessions.get(token) ?? (token.startsWith('demo.') ? token.slice(5) : '');
  if (!uid) return { ok: false, error: { code: 'UNAUTHENTICATED', message: '未登录' }, requestId: 'demo' };
  return demo.dispatch(functionName, record, { uid, loginType: 'EMAIL', client: 'web' });
}

export function isStaticDemo(): boolean {
  return import.meta.env.VITE_STATIC_DEMO === 'true';
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
