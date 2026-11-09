export const FUNCTIONS = {
  authPublic: 'hst_auth_public',
  apiCore: 'hst_api_core',
  apiAcademic: 'hst_api_academic',
  apiIb: 'hst_api_ib',
  apiAdmin: 'hst_api_admin',
  ops: 'hst_ops',
  cronPublish: 'hst_cron_publish',
  cronReminders: 'hst_cron_reminders',
  cronWeeklyDigest: 'hst_cron_weekly_digest',
  cronRetention: 'hst_cron_retention',
  cronOutboxMaintain: 'hst_cron_outbox_maintain',
} as const;

export type FunctionName = (typeof FUNCTIONS)[keyof typeof FUNCTIONS];

export const ALL_FUNCTIONS: readonly FunctionName[] = Object.values(FUNCTIONS);

export const CRON_FUNCTIONS: readonly FunctionName[] = [
  FUNCTIONS.cronPublish,
  FUNCTIONS.cronReminders,
  FUNCTIONS.cronWeeklyDigest,
  FUNCTIONS.cronRetention,
  FUNCTIONS.cronOutboxMaintain,
];

/** HTTP gateway may expose these. Cron functions are trigger-only. */
export const GATEWAY_FUNCTIONS: readonly FunctionName[] = ALL_FUNCTIONS.filter(
  (name) => !CRON_FUNCTIONS.includes(name),
);
