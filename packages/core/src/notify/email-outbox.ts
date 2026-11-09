import { MAIL_FROM, type Locale } from '@hst/shared';
import type { Doc } from '../db/types.js';
import { nid, quietUntil, safeTemplateVars } from '../util.js';
import type {
  ChannelAdapter,
  DeliverCtx,
  DeliverResult,
  NotificationPrefs,
  NotifyEvent,
  RenderedMessage,
  UserLite,
} from './types.js';

const TYPE_LABEL: Record<string, Record<Locale, string>> = {
  task_new: { zh: '新任务', en: 'New task' },
  task_due_soon: { zh: '任务即将截止', en: 'Task due soon' },
  task_overdue: { zh: '任务已逾期', en: 'Task overdue' },
  grade_released: { zh: '成绩已发布', en: 'Grade released' },
  comment_new: { zh: '新评语', en: 'New comment' },
  feedback_new: { zh: '新反馈', en: 'New feedback' },
  milestone_due_soon: { zh: '里程碑即将截止', en: 'Milestone due soon' },
  milestone_overdue: { zh: '里程碑已逾期', en: 'Milestone overdue' },
  cas_reviewed: { zh: 'CAS 审核结果', en: 'CAS review' },
  cas_due: { zh: 'CAS 截止提醒', en: 'CAS reminder' },
  system: { zh: '系统通知', en: 'System notice' },
};

export class EmailOutboxAdapter implements ChannelAdapter {
  readonly channel = 'email' as const;

  isEnabledFor(user: UserLite, prefs: NotificationPrefs, event: NotifyEvent): boolean {
    if (!user.email) return false;
    const email = prefs.channels.email;
    if (!email.enabled || email.mode === 'off') return false;
    if (email.types[event.type] === false) return false;
    return true;
  }

  async render(event: NotifyEvent, user: UserLite, locale: Locale): Promise<RenderedMessage> {
    const vars = safeTemplateVars(event.vars);
    const label = TYPE_LABEL[event.type]?.[locale] ?? TYPE_LABEL.system[locale];
    const title = vars.title ?? vars.taskTitle ?? label;
    const subject = locale === 'en' ? `${label}: ${title}` : `${label}：${title}`;
    const lines = [
      locale === 'en' ? 'Open the school portal to read the details. This email does not include scores or comments.' : '请登录家校联络平台查看详情。邮件不包含分数或评语。',
      vars.subject ? (locale === 'en' ? `Subject: ${vars.subject}` : `学科：${vars.subject}`) : '',
      vars.dueAt ? (locale === 'en' ? `Due: ${vars.dueAt}` : `截止：${vars.dueAt}`) : '',
      vars.link ? (locale === 'en' ? `Link: ${vars.link}` : `链接：${vars.link}`) : '',
    ].filter(Boolean);
    const text = lines.join('\n');
    return {
      channel: 'email',
      toUserId: user._id,
      locale,
      subject,
      text,
      html: `<p>${escapeHtml(text).replaceAll('\n', '<br>')}</p>`,
      templateKey: event.type,
      dedupeKey: dedupeFor(event.dedupeKey, user._id),
      kind: 'immediate',
      priority: event.importance === 'high' ? 0 : 10,
    };
  }

  async deliver(message: RenderedMessage, ctx: DeliverCtx): Promise<DeliverResult> {
    const existing = await ctx.repo.findOutboxByDedupe(message.dedupeKey);
    if (existing) {
      return { status: 'queued', outboxId: existing._id, reason: 'duplicate' };
    }
    const user = await ctx.repo.getUser(message.toUserId);
    const to = typeof user?.email === 'string' ? user.email : '';
    if (!to) return { status: 'skipped', reason: 'no_email' };
    const now = ctx.clock.now();
    const prefs = await ctx.repo.getPrefs(message.toUserId);
    const quiet = quietHoursOf(prefs);
    const delayed = quiet ? quietUntil(now, quiet.start, quiet.end) : null;
    const doc: Doc = {
      _id: nid('obx_'),
      channel: 'email',
      from: ctx.fromAddress || MAIL_FROM,
      to,
      toUserId: message.toUserId,
      subject: message.subject,
      text: message.text,
      html: message.html,
      templateKey: message.templateKey,
      locale: message.locale,
      kind: message.kind,
      dedupeKey: message.dedupeKey,
      priority: message.priority,
      status: 'pending',
      attempts: 0,
      scheduledAt: delayed ?? now,
      version: 1,
      createdAt: now,
      schoolId: user?.schoolId,
    };
    await ctx.repo.insertOutbox(doc);
    return { status: 'queued', outboxId: doc._id };
  }
}

function dedupeFor(dedupeKey: string, userId: string): string {
  return dedupeKey.endsWith(`:${userId}`) ? dedupeKey : `${dedupeKey}:${userId}`;
}

function quietHoursOf(doc: Doc | null): { start: string; end: string } | null {
  if (!doc || !doc.quietHours || typeof doc.quietHours !== 'object') {
    return { start: '22:00', end: '07:00' };
  }
  const quiet = doc.quietHours as { start?: unknown; end?: unknown };
  if (typeof quiet.start !== 'string' || typeof quiet.end !== 'string') return { start: '22:00', end: '07:00' };
  return { start: quiet.start, end: quiet.end };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

export function shouldSendImmediate(prefs: NotificationPrefs, event: NotifyEvent): boolean {
  return event.importance === 'high' && prefs.channels.email.mode === 'immediate';
}
