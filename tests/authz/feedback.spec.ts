import { describe, expect, it } from 'vitest';
import { COLLECTIONS } from '@hst/shared';
import { frozenClock, maintainOutbox, Repo, runWeeklyDigest } from '@hst/core';
import { ids } from '@hst/fixture';
import { call, harness } from '../helpers.js';

const SUNDAY = Date.parse('2026-11-15T10:00:00.000Z');
const MONDAY = Date.parse('2026-11-16T10:00:00.000Z');

describe('feedback and notification jobs', () => {
  it('creates a task thread, limits posts, and lets the author edit within 15 minutes', async () => {
    const env = await harness();
    const created = await call(env, 'uid_p1', 'thread.getOrCreate', {
      contextType: 'task',
      contextId: ids.taskShared,
      studentId: ids.s1,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const threadId = (created.data as { threadId: string }).threadId;
    const denied = await call(env, 'uid_p1', 'thread.getOrCreate', {
      contextType: 'task',
      contextId: ids.taskS2Only,
      studentId: ids.s2,
    });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error.code).toBe('NOT_FOUND');

    let messageId = '';
    for (let index = 0; index < 10; index += 1) {
      const posted = await call(env, 'uid_p1', 'message.post', { threadId, body: `留言 ${index}` });
      expect(posted.ok, String(index)).toBe(true);
      if (posted.ok) messageId = (posted.data as { messageId: string }).messageId;
    }
    const limited = await call(env, 'uid_p1', 'message.post', { threadId, body: '太多了' });
    expect(limited.ok).toBe(false);
    if (!limited.ok) expect(limited.error.code).toBe('RATE_LIMITED');

    const edited = await call(env, 'uid_p1', 'message.edit', { messageId, body: '改过的留言' });
    expect(edited.ok).toBe(true);
    const stranger = await call(env, 'uid_t1', 'message.edit', { messageId, body: '老师不能改家长的话' });
    expect(stranger.ok).toBe(false);
    if (!stranger.ok) expect(stranger.error.code).toBe('PERMISSION_DENIED');

    await env.db.compareAndSet(COLLECTIONS.messages, messageId, undefined, { createdAt: env.now - 16 * 60 * 1000 });
    const late = await call(env, 'uid_p1', 'message.edit', { messageId, body: '太晚了' });
    expect(late.ok).toBe(false);
    if (!late.ok) expect(late.error.code).toBe('PERMISSION_DENIED');

    const teacherList = await call(env, 'uid_t1', 'thread.listMine', {});
    expect(teacherList.ok).toBe(true);
    if (teacherList.ok) {
      const items = (teacherList.data as { items: Array<{ threadId: string; unreadCount: number }> }).items;
      const row = items.find((item) => item.threadId === threadId);
      expect(row?.unreadCount).toBeGreaterThan(0);
    }
    const read = await call(env, 'uid_t1', 'thread.markRead', { threadId });
    expect(read.ok).toBe(true);
    const after = await call(env, 'uid_t1', 'thread.listMine', { unreadOnly: true });
    if (after.ok) {
      const items = (after.data as { items: Array<{ threadId: string }> }).items;
      expect(items.some((item) => item.threadId === threadId)).toBe(false);
    }
  });

  it('builds a Sunday digest and reclaims an expired outbox lease', async () => {
    const env = await harness();
    await env.db.insert(COLLECTIONS.notifications, {
      _id: 'ntf_digest_p1',
      recipientUserId: ids.p1,
      recipientAuthUid: 'uid_p1',
      type: 'comment_new',
      studentId: ids.s1,
      title: { zh: '科学实验', en: 'Sciences lab' },
      body: { zh: '有新留言', en: 'New comment' },
      digest: { pending: true },
      dedupeKey: 'digest-source',
      createdAt: SUNDAY,
      schoolId: ids.school,
    });
    const sunday = await runWeeklyDigest(new Repo(env.db), frozenClock(SUNDAY), ids.school);
    expect(sunday.digests).toBeGreaterThan(0);
    const mail = await env.db.query(COLLECTIONS.outbox, (doc) => String(doc.dedupeKey).startsWith(`digest:${ids.p1}`));
    expect(mail.length).toBe(1);
    expect(JSON.stringify(mail[0])).not.toContain('cny_');
    const again = await runWeeklyDigest(new Repo(env.db), frozenClock(SUNDAY), ids.school);
    expect(again.digests).toBe(0);

    const row = mail[0];
    if (!row) return;
    await env.db.compareAndSet(COLLECTIONS.outbox, row._id, undefined, {
      status: 'claimed',
      leaseUntil: SUNDAY - 1000,
      claimToken: 'old',
      claimedBy: 'worker',
    });
    const maintained = await maintainOutbox(new Repo(env.db), frozenClock(SUNDAY));
    expect(maintained.reclaimed).toBe(1);
    const stored = await env.db.get(COLLECTIONS.outbox, row._id);
    expect(stored?.status).toBe('pending');

    const monday = await runWeeklyDigest(new Repo(env.db), frozenClock(MONDAY), ids.school);
    expect(monday.digests).toBe(0);
  });

  it('saves notification preferences for the caller only', async () => {
    const env = await harness();
    const updated = await call(env, 'uid_p1', 'prefs.update', {
      channels: { email: { enabled: true, mode: 'weekly' } },
      quietHours: { start: '21:00', end: '06:30' },
    });
    expect(updated.ok).toBe(true);
    const read = await call(env, 'uid_p1', 'prefs.get', {});
    expect(read.ok).toBe(true);
    if (read.ok) {
      const prefs = (read.data as { prefs: { channels: { email: { mode: string } }; quietHours: { start: string } } }).prefs;
      expect(prefs.channels.email.mode).toBe('weekly');
      expect(prefs.quietHours.start).toBe('21:00');
    }
    const stats = await call(env, 'uid_ops', 'ops.stats', {});
    expect(stats.ok).toBe(true);
    const hidden = await call(env, 'uid_p1', 'ops.stats', {});
    expect(hidden.ok).toBe(false);
    if (!hidden.ok) expect(hidden.error.code).toBe('PERMISSION_DENIED');
  });
});
