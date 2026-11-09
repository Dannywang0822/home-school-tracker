import type { Locale } from '@hst/shared';
import type { Clock } from '../clock.js';
import type { Repo } from '../repo.js';

export const NOTIFY_TYPES = [
  'task_new',
  'task_due_soon',
  'task_overdue',
  'grade_released',
  'comment_new',
  'feedback_new',
  'milestone_due_soon',
  'milestone_overdue',
  'cas_reviewed',
  'cas_due',
  'system',
] as const;

export type NotifyType = (typeof NOTIFY_TYPES)[number];

export type RecipientReason = 'student' | 'guardian' | 'teacher' | 'supervisor' | 'coordinator';

export interface NotifyEvent {
  type: NotifyType;
  studentId?: string;
  refType: string;
  refId: string;
  recipients?: { userId: string; reason: RecipientReason }[];
  vars: Record<string, string>;
  importance: 'high' | 'normal';
  dedupeKey: string;
  link?: string;
}

export interface UserLite {
  _id: string;
  roles: string[];
  email?: string;
  locale: Locale;
  displayName?: { zh: string; en?: string };
}

export interface NotificationPrefs {
  locale: Locale;
  channels: {
    email: {
      enabled: boolean;
      mode: 'immediate' | 'daily' | 'weekly' | 'off';
      types: Record<string, boolean>;
    };
    wechat_subscribe: { enabled: boolean; templateIds: Record<string, string> };
  };
  quietHours?: { start: string; end: string };
}

export interface RenderedMessage {
  channel: 'email' | 'wechat_subscribe';
  toUserId: string;
  locale: Locale;
  subject: string;
  text: string;
  html: string;
  templateKey: string;
  dedupeKey: string;
  kind: 'immediate' | 'digest_weekly' | 'digest_daily';
  priority: number;
}

export interface DeliverCtx {
  repo: Repo;
  clock: Clock;
  fromAddress: string;
}

export interface DeliverResult {
  status: 'queued' | 'sent' | 'skipped' | 'not_implemented';
  outboxId?: string;
  reason?: string;
}

export interface ChannelAdapter {
  readonly channel: 'email' | 'wechat_subscribe';
  isEnabledFor(user: UserLite, prefs: NotificationPrefs, event: NotifyEvent): boolean;
  render(event: NotifyEvent, user: UserLite, locale: Locale): Promise<RenderedMessage>;
  deliver(message: RenderedMessage, ctx: DeliverCtx): Promise<DeliverResult>;
}
