import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { COLLECTIONS, ERROR_HTTP_STATUS, GATEWAY_FUNCTIONS } from '@hst/shared';
import { createDispatcher, frozenClock, hashDevPassword, normalizeEvent } from '@hst/core';
import { DEV_DEMO_PASSWORD, NOW, PEPPER, createFixture, verifyDevPassword } from '@hst/fixture';

if (process.env.DEV_AUTH !== '1') {
  console.error('Refusing to start. Set DEV_AUTH=1. This server is a local stand-in and must not be deployed.');
  process.exit(1);
}

const port = Number(process.env.DEV_API_PORT ?? 8787);
const fixture = await createFixture();
const dispatch = createDispatcher({
  db: fixture.db,
  clock: frozenClock(fixture.now),
  config: {
    invitePepper: process.env.INVITE_CODE_PEPPER || PEPPER,
    mailFrom: 'dannysuperbot@mail.grokbot.com',
    wechatConfigured: false,
  },
});

const sessions = new Map<string, { uid: string; loginType: 'EMAIL' }>();
const emailCodes = new Map<string, { code: string; expiresAt: number }>();

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-robots-tag': 'noindex',
  });
  res.end(payload);
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    return null;
  }
}

function tokenFrom(req: IncomingMessage): string {
  const header = req.headers.authorization ?? '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}

function same(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  try {
    if (req.method === 'GET' && url.pathname === '/api/health') {
      send(res, 200, { ok: true, service: 'hst-dev', auth: 'local', now: NOW });
      return;
    }
    if (req.method !== 'POST') {
      send(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: '资源不存在' } });
      return;
    }
    const body = await readBody(req);
    if (body === null || typeof body !== 'object') {
      send(res, 400, { ok: false, error: { code: 'INVALID_ARGUMENT', message: '参数不正确' } });
      return;
    }
    const record = body as Record<string, unknown>;

    if (url.pathname === '/api/dev/login') {
      const email = typeof record.email === 'string' ? record.email.trim().toLowerCase() : '';
      const password = typeof record.password === 'string' ? record.password : '';
      const found = (await loginImported(email, password)) ?? verifyDevPassword(email, password);
      if (!found) {
        send(res, 401, { ok: false, error: { code: 'UNAUTHENTICATED', message: '邮箱或密码不正确' } });
        return;
      }
      const token = randomBytes(32).toString('hex');
      sessions.set(token, { uid: found.uid, loginType: 'EMAIL' });
      send(res, 200, { ok: true, data: { token } });
      return;
    }

    if (url.pathname === '/api/dev/email-code/send') {
      const email = typeof record.email === 'string' ? record.email.trim().toLowerCase() : '';
      const found = verifyDevPassword(email, DEV_DEMO_PASSWORD);
      if (found) {
        const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
        emailCodes.set(email, { code, expiresAt: Date.now() + 10 * 60 * 1000 });
        console.log(`dev email code for ${email}: ${code}`);
      }
      send(res, 200, { ok: true, data: { sent: true } });
      return;
    }

    if (url.pathname === '/api/dev/password') {
      const session = sessions.get(tokenFrom(req));
      const password = typeof record.password === 'string' ? record.password : '';
      if (!session || !strongPassword(password)) {
        send(res, 400, { ok: false, error: { code: 'INVALID_ARGUMENT', message: '密码不符合要求' } });
        return;
      }
      const identities = await fixture.db.query(
        COLLECTIONS.authIdentities,
        (doc) => doc.provider === 'cloudbase_uid' && doc.key === session.uid && doc.unboundAt == null,
      );
      const userId = identities[0]?.userId;
      if (typeof userId !== 'string') {
        send(res, 401, { ok: false, error: { code: 'UNAUTHENTICATED', message: '未登录' } });
        return;
      }
      await fixture.db.compareAndSet(COLLECTIONS.users, userId, undefined, { devLoginHash: hashDevPassword(password) });
      send(res, 200, { ok: true, data: { updated: true } });
      return;
    }

    if (url.pathname === '/api/dev/email-code/verify') {
      const email = typeof record.email === 'string' ? record.email.trim().toLowerCase() : '';
      const code = typeof record.code === 'string' ? record.code.trim() : '';
      const pending = emailCodes.get(email);
      const found = verifyDevPassword(email, DEV_DEMO_PASSWORD);
      if (!pending || pending.expiresAt < Date.now() || !found || !same(pending.code, code)) {
        send(res, 401, { ok: false, error: { code: 'UNAUTHENTICATED', message: '验证码不正确或已过期' } });
        return;
      }
      emailCodes.delete(email);
      const token = randomBytes(32).toString('hex');
      sessions.set(token, { uid: found.uid, loginType: 'EMAIL' });
      send(res, 200, { ok: true, data: { token } });
      return;
    }

    const functionName = url.pathname.replace(/^\/api\//, '');
    if (!(GATEWAY_FUNCTIONS as readonly string[]).includes(functionName)) {
      send(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: '资源不存在' } });
      return;
    }
    const session = sessions.get(tokenFrom(req)) ?? null;
    const result = await dispatch(functionName, normalizeEvent(record), session);
    const status = result.ok ? 200 : ERROR_HTTP_STATUS[result.error.code];
    send(res, status, result);
  } catch (error) {
    console.error(JSON.stringify({ code: 'INTERNAL', message: error instanceof Error ? error.name : 'error' }));
    send(res, 500, { ok: false, error: { code: 'INTERNAL', message: '服务暂时不可用' } });
  }
});

async function loginImported(email: string, password: string): Promise<{ uid: string } | null> {
  const users = await fixture.db.query(COLLECTIONS.users, (doc) => doc.email === email && doc.deletedAt == null);
  const user = users[0];
  if (!user || user.devLoginHash !== hashDevPassword(password)) return null;
  const identities = await fixture.db.query(
    COLLECTIONS.authIdentities,
    (doc) => doc.userId === user._id && doc.provider === 'cloudbase_uid' && doc.unboundAt == null,
  );
  const uid = identities[0]?.key;
  return typeof uid === 'string' ? { uid } : null;
}

function strongPassword(value: string): boolean {
  if (value.length < 8 || value.length > 32) return false;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(value)).length;
  return classes >= 3;
}

server.listen(port, '127.0.0.1', () => {
  console.log(`hst dev api http://127.0.0.1:${port}`);
  console.log('local demo only; accounts live in @hst/fixture');
});
