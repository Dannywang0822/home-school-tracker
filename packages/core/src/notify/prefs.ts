import type { Locale } from '@hst/shared';
import type { Doc } from '../db/types.js';
import { asString, isRecord } from '../util.js';
import type { NotificationPrefs, UserLite } from './types.js';

export function defaultPrefs(user: UserLite): NotificationPrefs {
  const isTeacher = user.roles.includes('teacher');
  const mode = isTeacher ? 'daily' : 'immediate';
  return {
    locale: user.locale,
    channels: {
      email: {
        enabled: true,
        mode,
        types: {
          task_new: true,
          task_due_soon: true,
          task_overdue: true,
          grade_released: true,
          comment_new: true,
          feedback_new: true,
          milestone_due_soon: true,
          milestone_overdue: true,
          cas_reviewed: true,
          cas_due: true,
          system: true,
        },
      },
      wechat_subscribe: { enabled: false, templateIds: {} },
    },
    quietHours: { start: '22:00', end: '07:00' },
  };
}

export function prefsFromDoc(doc: Doc | null, user: UserLite): NotificationPrefs {
  if (!doc) return defaultPrefs(user);
  const base = defaultPrefs(user);
  const channels = isRecord(doc.channels) ? doc.channels : {};
  const email = isRecord(channels.email) ? channels.email : {};
  const mode = email.mode;
  return {
    locale: doc.locale === 'en' || doc.locale === 'zh' ? doc.locale : user.locale,
    channels: {
      email: {
        enabled: email.enabled !== false,
        mode: mode === 'daily' || mode === 'weekly' || mode === 'off' || mode === 'immediate' ? mode : base.channels.email.mode,
        types: { ...base.channels.email.types, ...(isRecord(email.types) ? boolMap(email.types) : {}) },
      },
      wechat_subscribe: { enabled: false, templateIds: {} },
    },
    quietHours: isRecord(doc.quietHours)
      ? {
          start: asString(doc.quietHours.start) ?? '22:00',
          end: asString(doc.quietHours.end) ?? '07:00',
        }
      : base.quietHours,
  };
}

function boolMap(value: Record<string, unknown>): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'boolean') out[key] = item;
  }
  return out;
}

export function localeOf(prefs: NotificationPrefs, user: UserLite): Locale {
  return prefs.locale || user.locale;
}
