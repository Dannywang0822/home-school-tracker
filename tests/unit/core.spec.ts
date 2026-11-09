import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { COLLECTIONS, FUNCTIONS } from '@hst/shared';
import {
  Repo,
  WechatSubscribeAdapter,
  emitNotification,
  getAction,
  hashInviteCode,
  listActions,
  quietUntil,
  registerAction,
  safeTemplateVars,
} from '@hst/core';
import { PEPPER, ids } from '@hst/fixture';
import { call, harness } from '../helpers.js';

describe('identity is separate from the business user', () => {
  it('resolves customUserId before uid, and openId through the binding table', async () => {
    const env = await harness();
    const custom = await env.dispatch(
      FUNCTIONS.apiCore,
      { action: 'me.get', data: { callerUserId: ids.p2 }, requestId: randomUUID(), locale: 'zh' },
      { customUserId: ids.p1, uid: 'uid_p2', loginType: 'CUSTOM' },
    );
    expect(custom.ok).toBe(true);
    if (custom.ok) expect((custom.data as { user: { id: string } }).user.id).toBe(ids.p1);

    const wechat = await env.dispatch(
      FUNCTIONS.apiCore,
      { action: 'me.get', data: {}, requestId: randomUUID(), locale: 'zh' },
      { openId: 'oid_p2', loginType: 'WECHAT' },
    );
    expect(wechat.ok).toBe(true);
    if (wechat.ok) expect((wechat.data as { user: { id: string } }).user.id).toBe(ids.p2);

    const missing = await env.dispatch(
      FUNCTIONS.apiCore,
      { action: 'me.get', data: {}, requestId: randomUUID(), locale: 'zh' },
      { uid: 'does-not-exist', loginType: 'EMAIL' },
    );
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.code).toBe('UNAUTHENTICATED');
  });

  it('stores a wechat bind code as a hash', async () => {
    const env = await harness();
    const created = await call(env, 'uid_p1', 'auth.wechatBindCode');
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const code = (created.data as { code: string }).code;
    expect(code).toHaveLength(6);
    const rows = await env.db.query(COLLECTIONS.inviteCodes, (doc) => doc.type === 'wechat_bind');
    expect(JSON.stringify(rows)).not.toContain(code);
    expect(rows[0]?.codeHash).toBe(hashInviteCode(code, PEPPER));
  });

  it('serves the privacy policy without a session', async () => {
    const env = await harness();
    const result = await env.dispatch(
      FUNCTIONS.authPublic,
      { action: 'consent.policy', data: { kind: 'privacy', locale: 'zh' }, requestId: randomUUID(), locale: 'zh' },
      null,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(JSON.stringify(result.data)).toContain('演示隐私政策');
    expect(JSON.stringify(result)).not.toContain('stu_');
  });
});

describe('notify adapters', () => {
  it('leaves wechat subscribe unimplemented', async () => {
    const adapter = new WechatSubscribeAdapter();
    expect(adapter.isEnabledFor({ _id: 'u', roles: [], locale: 'zh' }, {
      locale: 'zh',
      channels: {
        email: { enabled: true, mode: 'immediate', types: {} },
        wechat_subscribe: { enabled: true, templateIds: { x: 'y' } },
      },
    }, { type: 'system', refType: 'system', refId: '1', vars: {}, importance: 'high', dedupeKey: 'k' })).toBe(false);
    const delivered = await adapter.deliver(
      {
        channel: 'wechat_subscribe',
        toUserId: 'u',
        locale: 'zh',
        subject: '',
        text: '',
        html: '',
        templateKey: 'system',
        dedupeKey: 'k',
        kind: 'immediate',
        priority: 10,
      },
      { repo: null as never, clock: { now: () => 0 }, fromAddress: 'x' },
    );
    expect(delivered.status).toBe('not_implemented');
  });

  it('delays email that falls inside quiet hours and does not duplicate a dedupe key', async () => {
    const env = await harness();
    const night = Date.parse('2026-11-09T15:30:00.000Z');
    expect(quietUntil(night, '22:00', '07:00')).toBe(Date.parse('2026-11-09T23:00:00.000Z'));
    const event = {
      type: 'grade_released' as const,
      studentId: ids.s1,
      refType: 'task',
      refId: ids.taskS1Released,
      importance: 'high' as const,
      dedupeKey: 'quiet-grade',
      vars: { title: '科学测验', comment: 'cny_should_not_render' },
    };
    const opts = { repo: new Repo(env.db), clock: { now: () => night }, fromAddress: 'dannysuperbot@mail.grokbot.com', schoolId: ids.school };
    await emitNotification(event, opts);
    await emitNotification(event, opts);
    const rows = await env.db.query(COLLECTIONS.outbox, (doc) => doc.dedupeKey === `quiet-grade:${ids.p1}` || doc.toUserId === ids.p1);
    const parent = rows.find((row) => row.toUserId === ids.p1);
    expect(parent?.scheduledAt).toBe(Date.parse('2026-11-09T23:00:00.000Z'));
    expect(JSON.stringify(parent)).not.toContain('cny_should_not_render');
    expect(rows.filter((row) => row.toUserId === ids.p1)).toHaveLength(1);
    expect(safeTemplateVars({ title: 'ok', comment: 'secret', score: '7' })).toEqual({ title: 'ok' });
  });
});

describe('outbox claim lock', () => {
  it('ST-06 and ST-08 only one worker claims a message', async () => {
    const env = await harness();
    await emitNotification(
      {
        type: 'task_overdue',
        studentId: ids.s1,
        refType: 'task',
        refId: ids.taskShared,
        importance: 'high',
        dedupeKey: 'lock-test',
        vars: { title: '科学实验' },
      },
      { repo: new Repo(env.db), clock: { now: () => env.now }, fromAddress: 'dannysuperbot@mail.grokbot.com', schoolId: ids.school },
    );
    const denied = await call(env, 'uid_p1', 'ops.claimOutbox', { workerId: 'parent' });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error.code).toBe('PERMISSION_DENIED');

    const row = (await env.db.query(COLLECTIONS.outbox, (doc) => doc.toUserId === ids.p1))[0];
    expect(row).toBeTruthy();
    const repo = new Repo(env.db);
    const version = row?.version as number;
    const first = await repo.tryClaimOutbox(row!._id, version, { status: 'claimed', claimToken: 'worker-a' });
    const second = await repo.tryClaimOutbox(row!._id, version, { status: 'claimed', claimToken: 'worker-b' });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    const stored = await env.db.get(COLLECTIONS.outbox, row!._id);
    expect(stored?.claimToken).toBe('worker-a');

    const claimed = await call(env, 'uid_ops', 'ops.claimOutbox', { workerId: 'ops-2', limit: 10 });
    expect(claimed.ok).toBe(true);
    if (claimed.ok) {
      const items = (claimed.data as { items: Array<{ to: string }> }).items;
      expect(items.some((item) => item.to === 'p1@demo.school.local')).toBe(false);
    }
  });
});

describe('action registry', () => {
  it('refuses an action without scope and routes actions to their function', () => {
    expect(listActions().every((action) => typeof action.scope === 'function')).toBe(true);
    expect(getAction('me.get')?.fn).toBe(FUNCTIONS.apiCore);
    expect(getAction('task.get')?.fn).toBe(FUNCTIONS.apiAcademic);
    expect(getAction('cas.list')?.fn).toBe(FUNCTIONS.apiIb);
    expect(() =>
      registerAction({
        name: 'test.missingScope',
        fn: FUNCTIONS.apiCore,
        roles: ['admin'],
        input: { safeParse: () => ({ success: true, data: {} }) } as never,
        handler: async () => ({}),
      } as never),
    ).toThrow(/scope/);
  });

  it('replays an idempotent message post without writing a second row', async () => {
    const env = await harness();
    const requestId = randomUUID();
    const before = await env.db.count(COLLECTIONS.messages);
    const first = await call(env, 'uid_p1', 'message.post', { threadId: ids.threadS1, body: '收到' }, requestId);
    const second = await call(env, 'uid_p1', 'message.post', { threadId: ids.threadS1, body: '收到' }, requestId);
    expect(first).toEqual(second);
    expect(await env.db.count(COLLECTIONS.messages)).toBe(before + 1);
  });
});
