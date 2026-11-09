import { COLLECTIONS } from '@hst/shared';
import type { Doc } from '../db/types.js';
import type { Repo } from '../repo.js';
import { asNumber, asString, asStringArray } from '../util.js';

const OPEN = new Set(['not_started', 'in_progress']);

export async function enrolledStudentIds(repo: Repo, courseId: string, schoolId: string): Promise<string[]> {
  const rows = await repo.db.query(
    COLLECTIONS.enrollments,
    (doc) => doc.courseId === courseId && doc.schoolId === schoolId && doc.status === 'active' && doc.deletedAt == null,
  );
  return rows.map((doc) => asString(doc.studentId)).filter((id): id is string => Boolean(id));
}

export async function publishTask(repo: Repo, task: Doc, actorId: string, now: number): Promise<void> {
  const courseId = asString(task.courseId) ?? '';
  const schoolId = asString(task.schoolId) ?? '';
  const enrolled = new Set(await enrolledStudentIds(repo, courseId, schoolId));
  const requested = asStringArray(task.assigneeStudentIds);
  const studentIds = requested.length > 0 ? requested.filter((id) => enrolled.has(id)) : [...enrolled];
  for (const studentId of studentIds) {
    const progressId = `${task._id}_${studentId}`;
    const existing = await repo.db.get(COLLECTIONS.taskProgress, progressId);
    if (existing) continue;
    const dueAt = asNumber(task.dueAt) ?? now;
    const overdue = dueAt < now;
    await repo.db.insert(COLLECTIONS.taskProgress, {
      _id: progressId,
      schoolId,
      taskId: task._id,
      courseId,
      studentId,
      termId: task.termId,
      subjectId: task.subjectId,
      dueAt,
      status: 'not_started',
      displayStatus: overdue ? 'overdue' : 'not_started',
      isOverdue: overdue,
      isLate: false,
      createdAt: now,
      createdBy: actorId,
      updatedAt: now,
      updatedBy: actorId,
      schemaVersion: 1,
    });
  }
  const progress = await repo.db.query(COLLECTIONS.taskProgress, (doc) => doc.taskId === task._id && doc.deletedAt == null);
  await repo.db.compareAndSet(COLLECTIONS.tasks, task._id, asNumber(task.version), {
    status: 'published',
    stats: summarize(progress),
    updatedAt: now,
    updatedBy: actorId,
  });
}

export async function publishDueTasks(repo: Repo, now: number): Promise<{ published: string[] }> {
  const due = await repo.db.query(
    COLLECTIONS.tasks,
    (doc) => doc.status === 'scheduled' && doc.deletedAt == null && (asNumber(doc.publishAt) ?? 0) <= now,
  );
  const published: string[] = [];
  for (const task of due) {
    await publishTask(repo, task, 'system', now);
    published.push(task._id);
  }
  return { published };
}

/** Marks open work past the deadline. Does not write notifications. */
export async function markOverdue(repo: Repo, now: number): Promise<{ updated: number }> {
  const rows = await repo.db.query(COLLECTIONS.taskProgress, (doc) => {
    if (doc.deletedAt != null || doc.isOverdue === true) return false;
    const status = asString(doc.status) ?? '';
    return OPEN.has(status) && (asNumber(doc.dueAt) ?? Number.POSITIVE_INFINITY) < now;
  });
  for (const row of rows) {
    await repo.db.compareAndSet(COLLECTIONS.taskProgress, row._id, undefined, {
      isOverdue: true,
      displayStatus: 'overdue',
      updatedAt: now,
      updatedBy: 'system',
    });
  }
  return { updated: rows.length };
}

export function summarize(progress: Doc[]): Record<string, number> {
  const count = (status: string) => progress.filter((doc) => doc.displayStatus === status || (status === 'overdue' && doc.isOverdue === true && OPEN.has(asString(doc.status) ?? ''))).length;
  return {
    assigned: progress.length,
    notStarted: progress.filter((doc) => doc.displayStatus === 'not_started').length,
    inProgress: progress.filter((doc) => doc.displayStatus === 'in_progress').length,
    submitted: progress.filter((doc) => doc.displayStatus === 'submitted').length,
    graded: progress.filter((doc) => doc.displayStatus === 'graded').length,
    overdue: count('overdue'),
  };
}

export async function refreshTaskStats(repo: Repo, taskId: string, now: number): Promise<void> {
  const task = await repo.getTask(taskId);
  if (!task) return;
  const progress = await repo.db.query(COLLECTIONS.taskProgress, (doc) => doc.taskId === taskId && doc.deletedAt == null);
  await repo.db.compareAndSet(COLLECTIONS.tasks, taskId, asNumber(task.version), {
    stats: summarize(progress),
    updatedAt: now,
  });
}
