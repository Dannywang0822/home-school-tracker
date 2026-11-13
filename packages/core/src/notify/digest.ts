import { COLLECTIONS, MAIL_FROM } from '@hst/shared';
import type { Clock } from '../clock.js';
import type { Doc } from '../db/types.js';
import type { Repo } from '../repo.js';
import { asNumber, asString, asStringArray, nid } from '../util.js';
import { prefsFromDoc } from './prefs.js';
import type { UserLite } from './types.js';

const DAY = 24 * 60 * 60 * 1000;
const NINETY_DAYS = 90 * DAY;

export async function runWeeklyDigest(repo: Repo, clock: Clock, schoolId: string, fromAddress = MAIL_FROM): Promise<{ digests: number }> {
  const now = clock.now();
  const shanghai = new Date(now + 8 * 60 * 60 * 1000);
  const sunday = shanghai.getUTCDay() === 0;
  const dayKey = `${shanghai.getUTCFullYear()}-${String(shanghai.getUTCMonth() + 1).padStart(2, '0')}-${String(shanghai.getUTCDate()).padStart(2, '0')}`;
  const users = await repo.db.query(COLLECTIONS.users, (doc) => doc.deletedAt == null && doc.schoolId === schoolId);
  let digests = 0;
  for (const userDoc of users) {
    const user = toUser(userDoc);
    if (!user.email) continue;
    const prefs = prefsFromDoc(await repo.getPrefs(user._id), user);
    const mode = prefs.channels.email.mode;
    if (!prefs.channels.email.enabled || mode === 'off') continue;
    const weekly = sunday && (mode === 'weekly' || mode === 'immediate');
    const daily = mode === 'daily';
    if (!weekly && !daily) continue;
    const pending = await repo.db.query(
      COLLECTIONS.notifications,
      (doc) => doc.recipientUserId === user._id && isRecord(doc.digest) && doc.digest.pending === true,
    );
    if (pending.length === 0) continue;
    const kind = daily ? 'digest_daily' : 'digest_weekly';
    const dedupeKey = daily ? `digest-daily:${user._id}:${dayKey}` : `digest:${user._id}:${isoWeekKey(now)}`;
    if (await repo.findOutboxByDedupe(dedupeKey)) continue;
    const locale = prefs.locale;
    const titles = pending.map((doc) => titleOf(doc, locale)).filter(Boolean).slice(0, 20);
    const upcoming = await upcomingCount(repo, userDoc, schoolId, now);
    const subject = locale === 'en' ? 'Weekly school update' : daily ? '每日学习摘要' : '每周学习汇总';
    const intro = locale === 'en'
      ? 'This email lists titles only. Open the portal for details. It does not include scores or comments.'
      : '这封邮件只列标题。请登录平台查看详情，邮件不含分数或评语。';
    const extra = locale === 'en' ? `Tasks due next week: ${upcoming}` : `下周到期的任务：${upcoming}`;
    const text = [intro, ...titles, extra].join('\n');
    await repo.insertOutbox({
      _id: nid('obx_'),
      channel: 'email',
      from: fromAddress,
      to: user.email,
      toUserId: user._id,
      subject: daily && locale === 'en' ? 'Daily school update' : subject,
      text,
      html: `<p>${escapeHtml(text).replaceAll('\n', '<br>')}</p>`,
      templateKey: kind,
      locale,
      kind,
      dedupeKey,
      priority: 10,
      status: 'pending',
      attempts: 0,
      scheduledAt: now,
      version: 1,
      createdAt: now,
      schoolId,
    });
    for (const note of pending) {
      const digest = isRecord(note.digest) ? { ...note.digest, pending: false } : { pending: false };
      await repo.db.compareAndSet(COLLECTIONS.notifications, note._id, undefined, { digest });
    }
    digests += 1;
  }
  return { digests };
}

export async function maintainOutbox(repo: Repo, clock: Clock): Promise<{ reclaimed: number; failed: number; purged: number }> {
  const now = clock.now();
  const rows = await repo.db.query(COLLECTIONS.outbox, (doc) => doc.deletedAt == null);
  let reclaimed = 0;
  let failed = 0;
  let purged = 0;
  for (const row of rows) {
    const leaseUntil = asNumber(row.leaseUntil) ?? 0;
    if (row.status === 'claimed' && leaseUntil > 0 && leaseUntil < now) {
      const version = asNumber(row.version);
      const updated = await repo.tryClaimOutbox(row._id, version ?? 0, {
        status: 'pending',
        claimToken: '',
        claimedBy: '',
        leaseUntil: 0,
      });
      if (updated.ok) reclaimed += 1;
      continue;
    }
    const attempts = asNumber(row.attempts) ?? 0;
    if (row.status === 'pending' && attempts >= 5) {
      const version = asNumber(row.version);
      const updated = await repo.tryClaimOutbox(row._id, version ?? 0, { status: 'failed' });
      if (updated.ok) failed += 1;
      continue;
    }
    const sentAt = asNumber(row.sentAt) ?? asNumber(row.createdAt) ?? now;
    if (row.status === 'sent' && now - sentAt > NINETY_DAYS) {
      await repo.db.compareAndSet(COLLECTIONS.outbox, row._id, undefined, { deletedAt: now, status: 'purged' });
      purged += 1;
    }
  }
  return { reclaimed, failed, purged };
}

function toUser(doc: Doc): UserLite {
  return {
    _id: doc._id,
    roles: asStringArray(doc.roles),
    email: asString(doc.email),
    locale: doc.locale === 'en' ? 'en' : 'zh',
  };
}

function titleOf(doc: Doc, locale: 'zh' | 'en'): string {
  const title = doc.title;
  if (title && typeof title === 'object') {
    const record = title as { zh?: unknown; en?: unknown };
    const text = locale === 'en' ? asString(record.en) ?? asString(record.zh) : asString(record.zh);
    return text ?? '';
  }
  return asString(title) ?? '';
}

async function upcomingCount(repo: Repo, user: Doc, schoolId: string, now: number): Promise<number> {
  const studentIds: string[] = [];
  if (asStringArray(user.roles).includes('parent')) {
    const links = await repo.activeChildLinks(user._id, schoolId);
    for (const link of links) {
      const studentId = asString(link.studentId);
      if (studentId) studentIds.push(studentId);
    }
  }
  if (asStringArray(user.roles).includes('student')) {
    const self = await repo.findStudentByUserId(user._id);
    if (self) studentIds.push(self._id);
  }
  const start = now;
  const end = now + 7 * DAY;
  let count = 0;
  for (const studentId of studentIds) {
    const progress = await repo.listProgressForStudent(studentId, schoolId);
    for (const row of progress) {
      const dueAt = asNumber(row.dueAt) ?? 0;
      if (dueAt >= start && dueAt < end) count += 1;
    }
  }
  return count;
}

function isoWeekKey(now: number): string {
  const shanghai = new Date(now + 8 * 60 * 60 * 1000);
  const date = new Date(Date.UTC(shanghai.getUTCFullYear(), shanghai.getUTCMonth(), shanghai.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
