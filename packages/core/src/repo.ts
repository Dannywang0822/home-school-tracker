import { COLLECTIONS, type Role } from '@hst/shared';
import { AppError } from './app-error.js';
import type { Doc, DocStore } from './db/types.js';
import { asNumber, asString, asStringArray, canonicalJson, nid, sha256 } from './util.js';

function alive(doc: Doc): boolean {
  return doc.deletedAt == null;
}

export class Repo {
  constructor(readonly db: DocStore) {}

  async getUser(id: string): Promise<Doc | null> {
    const doc = await this.db.get(COLLECTIONS.users, id);
    return doc && alive(doc) ? doc : null;
  }

  async findIdentity(provider: string, key: string): Promise<Doc | null> {
    const rows = await this.db.query(
      COLLECTIONS.authIdentities,
      (doc) => alive(doc) && doc.provider === provider && doc.key === key && doc.unboundAt == null,
    );
    return rows[0] ?? null;
  }

  async listIdentities(userId: string): Promise<Doc[]> {
    return this.db.query(
      COLLECTIONS.authIdentities,
      (doc) => alive(doc) && doc.userId === userId && doc.unboundAt == null,
    );
  }

  async insertIdentity(doc: Doc): Promise<void> {
    await this.db.insert(COLLECTIONS.authIdentities, doc);
  }

  async updateUser(id: string, patch: Partial<Doc>): Promise<Doc> {
    const result = await this.db.compareAndSet(COLLECTIONS.users, id, undefined, patch);
    if (!result.ok) throw new AppError('NOT_FOUND', '资源不存在');
    return result.doc;
  }

  async getStudent(id: string): Promise<Doc | null> {
    const doc = await this.db.get(COLLECTIONS.studentProfiles, id);
    return doc && alive(doc) ? doc : null;
  }

  async findStudentByUserId(userId: string): Promise<Doc | null> {
    const rows = await this.db.query(
      COLLECTIONS.studentProfiles,
      (doc) => alive(doc) && doc.userId === userId,
    );
    return rows[0] ?? null;
  }

  async guardiansOfStudent(studentId: string, schoolId: string): Promise<Doc[]> {
    return this.db.query(
      COLLECTIONS.guardianships,
      (doc) =>
        alive(doc) &&
        doc.studentId === studentId &&
        doc.schoolId === schoolId &&
        doc.status === 'active',
    );
  }

  async activeChildLinks(parentId: string, schoolId: string): Promise<Doc[]> {
    return this.db.query(
      COLLECTIONS.guardianships,
      (doc) =>
        alive(doc) &&
        doc.parentId === parentId &&
        doc.schoolId === schoolId &&
        doc.status === 'active',
    );
  }

  async isGuardianOf(parentId: string, studentId: string, schoolId: string): Promise<boolean> {
    const rows = await this.db.query(
      COLLECTIONS.guardianships,
      (doc) =>
        alive(doc) &&
        doc.parentId === parentId &&
        doc.studentId === studentId &&
        doc.schoolId === schoolId &&
        doc.status === 'active',
    );
    return rows.length > 0;
  }

  async isSelf(userId: string, studentId: string): Promise<boolean> {
    const student = await this.getStudent(studentId);
    return student?.userId === userId;
  }

  async teachesCourse(teacherId: string, courseId: string, schoolId: string, now: number): Promise<boolean> {
    const rows = await this.db.query(COLLECTIONS.teachingAssignments, (doc) => {
      if (!alive(doc) || doc.teacherId !== teacherId || doc.courseId !== courseId || doc.schoolId !== schoolId) {
        return false;
      }
      const endAt = asNumber(doc.endAt);
      return endAt == null || endAt > now;
    });
    return rows.length > 0;
  }

  async courseIdsForTeacher(teacherId: string, schoolId: string, now: number): Promise<string[]> {
    const rows = await this.db.query(COLLECTIONS.teachingAssignments, (doc) => {
      if (!alive(doc) || doc.teacherId !== teacherId || doc.schoolId !== schoolId) return false;
      const endAt = asNumber(doc.endAt);
      return endAt == null || endAt > now;
    });
    return rows.map((doc) => asString(doc.courseId)).filter((id): id is string => Boolean(id));
  }

  async teachesStudent(teacherId: string, studentId: string, schoolId: string, now: number): Promise<boolean> {
    const courseIds = new Set(await this.courseIdsForTeacher(teacherId, schoolId, now));
    if (courseIds.size === 0) return false;
    const rows = await this.db.query(
      COLLECTIONS.enrollments,
      (doc) =>
        alive(doc) &&
        doc.studentId === studentId &&
        doc.schoolId === schoolId &&
        doc.status === 'active' &&
        courseIds.has(asString(doc.courseId) ?? ''),
    );
    return rows.length > 0;
  }

  async isHomeroomOf(teacherId: string, studentId: string, schoolId: string): Promise<boolean> {
    const student = await this.getStudent(studentId);
    const classId = asString(student?.homeroomClassId);
    if (!student || student.schoolId !== schoolId || !classId) return false;
    const homeroom = await this.db.get(COLLECTIONS.classes, classId);
    if (!homeroom || !alive(homeroom)) return false;
    return asStringArray(homeroom.homeroomTeacherIds).includes(teacherId);
  }

  async mentors(mentorId: string, studentId: string, schoolId: string, type?: string): Promise<boolean> {
    const rows = await this.db.query(
      COLLECTIONS.mentorships,
      (doc) =>
        alive(doc) &&
        doc.mentorId === mentorId &&
        doc.studentId === studentId &&
        doc.schoolId === schoolId &&
        doc.status === 'active' &&
        (type == null || doc.type === type),
    );
    return rows.length > 0;
  }

  async getSchool(id: string): Promise<Doc | null> {
    return this.db.get(COLLECTIONS.schools, id);
  }

  async currentYear(schoolId: string): Promise<Doc | null> {
    const rows = await this.db.query(
      COLLECTIONS.academicYears,
      (doc) => alive(doc) && doc.schoolId === schoolId && doc.isCurrent === true,
    );
    return rows[0] ?? null;
  }

  async currentTerm(yearId: string, now: number): Promise<Doc | null> {
    const rows = await this.db.query(
      COLLECTIONS.terms,
      (doc) => alive(doc) && doc.yearId === yearId,
    );
    rows.sort((a, b) => (asNumber(a.index) ?? 0) - (asNumber(b.index) ?? 0));
    return (
      rows.find((doc) => (asNumber(doc.startDate) ?? 0) <= now && now <= (asNumber(doc.endDate) ?? 0)) ??
      rows[0] ??
      null
    );
  }

  async getClass(id: string): Promise<Doc | null> {
    const doc = await this.db.get(COLLECTIONS.classes, id);
    return doc && alive(doc) ? doc : null;
  }

  async getCourse(id: string): Promise<Doc | null> {
    const doc = await this.db.get(COLLECTIONS.courses, id);
    return doc && alive(doc) ? doc : null;
  }

  async getTask(id: string): Promise<Doc | null> {
    const doc = await this.db.get(COLLECTIONS.tasks, id);
    return doc && alive(doc) ? doc : null;
  }

  async listProgressForStudent(studentId: string, schoolId: string): Promise<Doc[]> {
    return this.db.query(
      COLLECTIONS.taskProgress,
      (doc) => alive(doc) && doc.studentId === studentId && doc.schoolId === schoolId,
    );
  }

  async progressFor(taskId: string, studentId: string): Promise<Doc | null> {
    const rows = await this.db.query(
      COLLECTIONS.taskProgress,
      (doc) => alive(doc) && doc.taskId === taskId && doc.studentId === studentId,
    );
    return rows[0] ?? null;
  }

  async getTasks(ids: string[]): Promise<Doc[]> {
    if (ids.length === 0) return [];
    const wanted = new Set(ids);
    return this.db.query(COLLECTIONS.tasks, (doc) => alive(doc) && wanted.has(doc._id));
  }

  async listAssessmentsForStudent(studentId: string, schoolId: string): Promise<Doc[]> {
    return this.db.query(
      COLLECTIONS.assessments,
      (doc) => alive(doc) && doc.studentId === studentId && doc.schoolId === schoolId,
    );
  }

  async listSummaries(studentId: string, schoolId: string): Promise<Doc[]> {
    return this.db.query(
      COLLECTIONS.termSummaries,
      (doc) => alive(doc) && doc.studentId === studentId && doc.schoolId === schoolId,
    );
  }

  async listRoster(courseId: string, schoolId: string): Promise<Doc[]> {
    const enrollments = await this.db.query(
      COLLECTIONS.enrollments,
      (doc) => alive(doc) && doc.courseId === courseId && doc.schoolId === schoolId && doc.status === 'active',
    );
    const students: Doc[] = [];
    for (const enrollment of enrollments) {
      const studentId = asString(enrollment.studentId);
      if (!studentId) continue;
      const student = await this.getStudent(studentId);
      if (student) students.push(student);
    }
    return students;
  }

  async getThread(id: string): Promise<Doc | null> {
    const doc = await this.db.get(COLLECTIONS.threads, id);
    return doc && alive(doc) ? doc : null;
  }

  async listThreadsForStudents(studentIds: string[], schoolId: string): Promise<Doc[]> {
    if (studentIds.length === 0) return [];
    const wanted = new Set(studentIds);
    return this.db.query(
      COLLECTIONS.threads,
      (doc) => alive(doc) && doc.schoolId === schoolId && wanted.has(asString(doc.studentId) ?? ''),
    );
  }

  async listMessages(threadId: string): Promise<Doc[]> {
    const rows = await this.db.query(
      COLLECTIONS.messages,
      (doc) => alive(doc) && doc.threadId === threadId && doc.deletedAt == null,
    );
    rows.sort((a, b) => (asNumber(a.createdAt) ?? 0) - (asNumber(b.createdAt) ?? 0));
    return rows;
  }

  async insertMessage(doc: Doc): Promise<void> {
    await this.db.insert(COLLECTIONS.messages, doc);
  }

  async countMessages(): Promise<number> {
    return this.db.count(COLLECTIONS.messages);
  }

  async getFile(id: string): Promise<Doc | null> {
    const doc = await this.db.get(COLLECTIONS.files, id);
    return doc && alive(doc) ? doc : null;
  }

  async listExperiences(studentId: string, schoolId: string): Promise<Doc[]> {
    return this.db.query(
      COLLECTIONS.casExperiences,
      (doc) => alive(doc) && doc.studentId === studentId && doc.schoolId === schoolId,
    );
  }

  async getExperience(id: string): Promise<Doc | null> {
    const doc = await this.db.get(COLLECTIONS.casExperiences, id);
    return doc && alive(doc) ? doc : null;
  }

  async listReflections(experienceId: string): Promise<Doc[]> {
    return this.db.query(
      COLLECTIONS.casReflections,
      (doc) => alive(doc) && doc.experienceId === experienceId,
    );
  }

  async getProject(id: string): Promise<Doc | null> {
    const doc = await this.db.get(COLLECTIONS.casProjects, id);
    return doc && alive(doc) ? doc : null;
  }

  async getPlan(id: string): Promise<Doc | null> {
    const doc = await this.db.get(COLLECTIONS.milestonePlans, id);
    return doc && alive(doc) ? doc : null;
  }

  async listRppf(planId: string): Promise<Doc[]> {
    return this.db.query(COLLECTIONS.rppfEntries, (doc) => alive(doc) && doc.planId === planId);
  }

  async insertInvite(doc: Doc): Promise<void> {
    await this.db.insert(COLLECTIONS.inviteCodes, doc);
  }

  async consumeInvite(id: string, expectedVersion: number | undefined, patch: Partial<Doc>): Promise<Doc> {
    const result = await this.db.compareAndSet(COLLECTIONS.inviteCodes, id, expectedVersion, patch);
    if (!result.ok) throw new AppError('INVITE_INVALID', '邀请码无效或已过期');
    return result.doc;
  }

  async findInviteByHash(codeHash: string): Promise<Doc | null> {
    const rows = await this.db.query(COLLECTIONS.inviteCodes, (doc) => alive(doc) && doc.codeHash === codeHash);
    return rows[0] ?? null;
  }

  async countGuardianships(): Promise<number> {
    return this.db.count(COLLECTIONS.guardianships);
  }

  async insertGuardianship(doc: Doc): Promise<void> {
    await this.db.insert(COLLECTIONS.guardianships, doc);
  }

  async listNotifications(userId: string): Promise<Doc[]> {
    const rows = await this.db.query(
      COLLECTIONS.notifications,
      (doc) => alive(doc) && doc.recipientUserId === userId,
    );
    rows.sort((a, b) => (asNumber(b.createdAt) ?? 0) - (asNumber(a.createdAt) ?? 0));
    return rows;
  }

  async findNotificationByDedupe(dedupeKey: string): Promise<Doc | null> {
    const rows = await this.db.query(COLLECTIONS.notifications, (doc) => doc.dedupeKey === dedupeKey);
    return rows[0] ?? null;
  }

  async insertNotification(doc: Doc): Promise<void> {
    await this.db.insert(COLLECTIONS.notifications, doc);
  }

  async getPrefs(userId: string): Promise<Doc | null> {
    return this.db.get(COLLECTIONS.notificationPrefs, userId);
  }

  async findOutboxByDedupe(dedupeKey: string): Promise<Doc | null> {
    const rows = await this.db.query(COLLECTIONS.outbox, (doc) => doc.dedupeKey === dedupeKey);
    return rows[0] ?? null;
  }

  async insertOutbox(doc: Doc): Promise<void> {
    await this.db.insert(COLLECTIONS.outbox, doc);
  }

  async listOutbox(): Promise<Doc[]> {
    return this.db.query(COLLECTIONS.outbox, () => true);
  }

  async listPendingOutbox(now: number): Promise<Doc[]> {
    const rows = await this.db.query(
      COLLECTIONS.outbox,
      (doc) => doc.status === 'pending' && (asNumber(doc.scheduledAt) ?? 0) <= now,
    );
    rows.sort((a, b) => {
      const priority = (asNumber(a.priority) ?? 0) - (asNumber(b.priority) ?? 0);
      if (priority !== 0) return priority;
      return (asNumber(a.scheduledAt) ?? 0) - (asNumber(b.scheduledAt) ?? 0);
    });
    return rows;
  }

  async tryClaimOutbox(
    id: string,
    expectedVersion: number,
    patch: Partial<Doc>,
  ): Promise<{ ok: true; doc: Doc } | { ok: false }> {
    const result = await this.db.compareAndSet(COLLECTIONS.outbox, id, expectedVersion, patch);
    if (!result.ok) return { ok: false };
    return { ok: true, doc: result.doc };
  }

  async getOutbox(id: string): Promise<Doc | null> {
    return this.db.get(COLLECTIONS.outbox, id);
  }

  async listAdmins(schoolId: string): Promise<Doc[]> {
    return this.db.query(
      COLLECTIONS.users,
      (doc) => alive(doc) && doc.schoolId === schoolId && asStringArray(doc.roles).includes('admin'),
    );
  }

  async getIdempotent(key: string, now: number): Promise<Doc | null> {
    const doc = await this.db.get(COLLECTIONS.idempotency, key);
    if (!doc) return null;
    if ((asNumber(doc.expiresAt) ?? 0) < now) return null;
    return doc;
  }

  async putIdempotent(doc: Doc): Promise<void> {
    const existing = await this.db.get(COLLECTIONS.idempotency, doc._id);
    if (existing) {
      await this.db.compareAndSet(COLLECTIONS.idempotency, doc._id, undefined, doc);
      return;
    }
    await this.db.insert(COLLECTIONS.idempotency, doc);
  }

  async hitRateLimit(action: string, userId: string, window: string, limit: number): Promise<{
    allowed: boolean;
    count: number;
  }> {
    const id = `${action}:${userId}:${window}`;
    const existing = await this.db.get(COLLECTIONS.rateLimits, id);
    const count = (asNumber(existing?.count) ?? 0) + 1;
    if (!existing) {
      await this.db.insert(COLLECTIONS.rateLimits, { _id: id, count, action, userId, window });
    } else {
      await this.db.compareAndSet(COLLECTIONS.rateLimits, id, undefined, { count });
    }
    return { allowed: count <= limit, count };
  }

  async appendAudit(entry: {
    at: number;
    actorUserId: string;
    actorRoles: Role[];
    action: string;
    targetType?: string;
    targetId?: string;
    studentId?: string;
    result: 'ok' | 'denied' | 'error';
    meta?: Record<string, unknown>;
    requestId: string;
    client: 'web' | 'mp';
  }): Promise<void> {
    const previous = await this.db.query(COLLECTIONS.auditLogs, () => true);
    previous.sort((a, b) => (asNumber(a.at) ?? 0) - (asNumber(b.at) ?? 0));
    const prev = previous.at(-1);
    const prevHash = asString(prev?.hash) ?? '0';
    const body = {
      at: entry.at,
      actorUserId: entry.actorUserId,
      actorRoles: entry.actorRoles,
      action: entry.action,
      targetType: entry.targetType ?? '',
      targetId: entry.targetId ?? '',
      studentId: entry.studentId ?? '',
      result: entry.result,
      meta: entry.meta ?? {},
      requestId: entry.requestId,
      client: entry.client,
      prevHash,
    };
    const hash = sha256(canonicalJson(body));
    await this.db.insert(COLLECTIONS.auditLogs, {
      _id: nid('aud_'),
      ...body,
      hash,
    });
  }

  async listAuditForActor(actorUserId: string): Promise<Doc[]> {
    return this.db.query(COLLECTIONS.auditLogs, (doc) => doc.actorUserId === actorUserId);
  }

  async currentPolicy(kind: string): Promise<Doc | null> {
    const rows = await this.db.query(COLLECTIONS.consentPolicies, (doc) => doc.kind === kind);
    rows.sort((a, b) => (asNumber(b.effectiveAt) ?? 0) - (asNumber(a.effectiveAt) ?? 0));
    return rows[0] ?? null;
  }
}
