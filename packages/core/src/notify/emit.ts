import type { Locale } from '@hst/shared';
import type { Clock } from '../clock.js';
import type { Doc } from '../db/types.js';
import type { Repo } from '../repo.js';
import { asString, asStringArray, nid } from '../util.js';
import { EmailOutboxAdapter, shouldSendImmediate } from './email-outbox.js';
import { localeOf, prefsFromDoc } from './prefs.js';
import type { NotifyEvent, RecipientReason, UserLite } from './types.js';
import { WechatSubscribeAdapter } from './wechat.js';

const emailAdapter = new EmailOutboxAdapter();
const wechatAdapter = new WechatSubscribeAdapter();

export interface EmitOptions {
  repo: Repo;
  clock: Clock;
  fromAddress: string;
  schoolId: string;
}

/**
 * Writes in-app notifications and, for high-importance immediate email, an outbox row.
 * Recipients are checked against the student relationship. A caller cannot add an
 * unrelated user, including a revoked guardian.
 */
export async function emitNotification(event: NotifyEvent, options: EmitOptions): Promise<void> {
  const recipients = await resolveRecipients(options.repo, event, options.schoolId, options.clock.now());
  for (const recipient of recipients) {
    const userDoc = await options.repo.getUser(recipient.userId);
    if (!userDoc) continue;
    const user = toUserLite(userDoc);
    const prefs = prefsFromDoc(await options.repo.getPrefs(user._id), user);
    const locale = localeOf(prefs, user);
    const dedupeKey = event.dedupeKey.endsWith(`:${user._id}`) ? event.dedupeKey : `${event.dedupeKey}:${user._id}`;
    if (!(await options.repo.findNotificationByDedupe(dedupeKey))) {
      const authUid = await webUid(options.repo, user._id);
      const copy = minimalCopy(event, locale);
      await options.repo.insertNotification({
        _id: nid('ntf_'),
        recipientUserId: user._id,
        recipientAuthUid: authUid,
        type: event.type,
        studentId: event.studentId,
        title: copy.title,
        body: copy.body,
        link: event.link ?? event.vars.link ?? '',
        refType: event.refType,
        refId: event.refId,
        digest: { pending: !shouldSendImmediate(prefs, event) },
        dedupeKey,
        createdAt: options.clock.now(),
        schoolId: options.schoolId,
      });
    }
    const emailAllowed = recipient.reason !== 'guardian' || (await guardianWantsEmail(options.repo, event.studentId, user._id, options.schoolId));
    if (emailAllowed && shouldSendImmediate(prefs, event) && emailAdapter.isEnabledFor(user, prefs, event)) {
      const rendered = await emailAdapter.render(event, user, locale);
      await emailAdapter.deliver(rendered, {
        repo: options.repo,
        clock: options.clock,
        fromAddress: options.fromAddress,
      });
    }
    if (wechatAdapter.isEnabledFor(user, prefs, event)) {
      const rendered = await wechatAdapter.render(event, user, locale);
      await wechatAdapter.deliver(rendered, {
        repo: options.repo,
        clock: options.clock,
        fromAddress: options.fromAddress,
      });
    }
  }
}

async function guardianWantsEmail(repo: Repo, studentId: string | undefined, parentId: string, schoolId: string): Promise<boolean> {
  if (!studentId) return false;
  const links = await repo.guardiansOfStudent(studentId, schoolId);
  const link = links.find((doc) => doc.parentId === parentId);
  return Boolean(link) && link?.receivesEmail !== false;
}

async function resolveRecipients(
  repo: Repo,
  event: NotifyEvent,
  schoolId: string,
  now: number,
): Promise<{ userId: string; reason: RecipientReason }[]> {
  const student = event.studentId ? await repo.getStudent(event.studentId) : null;
  const studentUserId = asString(student?.userId);
  const guardians = event.studentId ? await repo.guardiansOfStudent(event.studentId, schoolId) : [];
  const activeGuardianIds = new Set(
    guardians.map((doc) => asString(doc.parentId)).filter((id): id is string => Boolean(id)),
  );
  const requested = event.recipients?.length
    ? event.recipients
    : [
        ...(studentUserId ? [{ userId: studentUserId, reason: 'student' as const }] : []),
        ...[...activeGuardianIds].map((userId) => ({ userId, reason: 'guardian' as const })),
      ];
  const kept: { userId: string; reason: RecipientReason }[] = [];
  const seen = new Set<string>();
  for (const recipient of requested) {
    if (seen.has(recipient.userId)) continue;
    const allowed = await recipientAllowed(repo, recipient, {
      schoolId,
      studentId: event.studentId,
      studentUserId,
      activeGuardianIds,
      now,
    });
    if (!allowed) continue;
    seen.add(recipient.userId);
    kept.push(recipient);
  }
  return kept;
}

async function recipientAllowed(
  repo: Repo,
  recipient: { userId: string; reason: RecipientReason },
  scope: {
    schoolId: string;
    studentId?: string;
    studentUserId?: string;
    activeGuardianIds: Set<string>;
    now: number;
  },
): Promise<boolean> {
  if (recipient.reason === 'student') return recipient.userId === scope.studentUserId;
  if (recipient.reason === 'guardian') return scope.activeGuardianIds.has(recipient.userId);
  if (!scope.studentId) return false;
  if (recipient.reason === 'teacher') {
    return repo.teachesStudent(recipient.userId, scope.studentId, scope.schoolId, scope.now);
  }
  if (recipient.reason === 'supervisor') {
    return repo.mentors(recipient.userId, scope.studentId, scope.schoolId);
  }
  if (recipient.reason === 'coordinator') {
    const user = await repo.getUser(recipient.userId);
    const roles = asStringArray(user?.roles);
    return roles.includes('cas_coordinator') || roles.includes('ee_coordinator');
  }
  return false;
}

function toUserLite(doc: Doc): UserLite {
  const display = doc.displayName;
  return {
    _id: doc._id,
    roles: asStringArray(doc.roles),
    email: asString(doc.email),
    locale: doc.locale === 'en' ? 'en' : 'zh',
    displayName:
      display && typeof display === 'object'
        ? {
            zh: asString((display as { zh?: unknown }).zh) ?? '',
            en: asString((display as { en?: unknown }).en),
          }
        : undefined,
  };
}

async function webUid(repo: Repo, userId: string): Promise<string> {
  const identities = await repo.listIdentities(userId);
  const web = identities.find((doc) => doc.provider === 'cloudbase_uid');
  return asString(web?.key) ?? '';
}

function minimalCopy(event: NotifyEvent, locale: Locale): { title: { zh: string; en: string }; body: { zh: string; en: string } } {
  const title = (event.vars.title ?? event.vars.taskTitle ?? event.type).slice(0, 80);
  const zh = `${title} 有更新`;
  const en = `${title} was updated`;
  return {
    title: { zh: title, en: title },
    body: { zh, en: locale === 'en' ? en : zh },
  };
}

export { emailAdapter, wechatAdapter };
