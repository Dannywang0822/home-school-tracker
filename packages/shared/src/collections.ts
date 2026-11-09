/** Physical names in the shared CloudBase environment. Logical names in the design docs have no prefix. */
export const HST_PREFIX = 'hst_';

export const COLLECTIONS = {
  users: 'hst_users',
  studentProfiles: 'hst_student_profiles',
  authIdentities: 'hst_auth_identities',
  inviteCodes: 'hst_invite_codes',
  consentPolicies: 'hst_consent_policies',
  consents: 'hst_consents',
  schools: 'hst_schools',
  academicYears: 'hst_academic_years',
  terms: 'hst_terms',
  grades: 'hst_grades',
  classes: 'hst_classes',
  subjects: 'hst_subjects',
  courses: 'hst_courses',
  teachingAssignments: 'hst_teaching_assignments',
  enrollments: 'hst_enrollments',
  guardianships: 'hst_guardianships',
  mentorships: 'hst_mentorships',
  tasks: 'hst_tasks',
  taskProgress: 'hst_task_progress',
  submissions: 'hst_submissions',
  files: 'hst_files',
  assessmentCriteria: 'hst_assessment_criteria',
  dpComponents: 'hst_dp_components',
  assessments: 'hst_assessments',
  termSummaries: 'hst_term_summaries',
  threads: 'hst_threads',
  messages: 'hst_messages',
  threadReads: 'hst_thread_reads',
  notifications: 'hst_notifications',
  notificationPrefs: 'hst_notification_prefs',
  outbox: 'hst_outbox',
  casExperiences: 'hst_cas_experiences',
  casReflections: 'hst_cas_reflections',
  casEvidence: 'hst_cas_evidence',
  casReviews: 'hst_cas_reviews',
  casProjects: 'hst_cas_projects',
  casSummaries: 'hst_cas_summaries',
  milestoneTemplates: 'hst_milestone_templates',
  milestonePlans: 'hst_milestone_plans',
  milestoneItems: 'hst_milestone_items',
  rppfEntries: 'hst_rppf_entries',
  auditLogs: 'hst_audit_logs',
  importJobs: 'hst_import_jobs',
  cronLocks: 'hst_cron_locks',
  rateLimits: 'hst_rate_limits',
  /** Implementation collection: 10-minute idempotency for write actions. Not in the v0.1 design doc. */
  idempotency: 'hst_idempotency',
} as const;

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];

export const ALL_COLLECTIONS: readonly CollectionName[] = Object.values(COLLECTIONS);

export const STORAGE = {
  tmpPrefix: 'hst_tmp/',
  vaultPrefix: 'hst_vault/',
} as const;

export const MAIL_FROM = 'dannysuperbot@mail.grokbot.com';

export function assertHstName(name: string, kind: string): void {
  if (!name.startsWith(HST_PREFIX)) {
    throw new Error(`${kind} "${name}" is missing the ${HST_PREFIX} prefix`);
  }
}
