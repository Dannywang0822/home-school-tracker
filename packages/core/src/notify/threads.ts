import { COLLECTIONS } from '@hst/shared';
import type { Doc } from '../db/types.js';
import type { Repo } from '../repo.js';
import { asNumber, asString, asStringArray } from '../util.js';

export function threadReadId(threadId: string, userId: string): string {
  return `${threadId}_${userId}`;
}

export async function participantUserIds(repo: Repo, thread: Doc, schoolId: string): Promise<string[]> {
  const ids = new Set(asStringArray(thread.staffUserIds));
  const studentId = asString(thread.studentId);
  if (!studentId) return [...ids];
  const student = await repo.getStudent(studentId);
  const studentUserId = asString(student?.userId);
  if (studentUserId) ids.add(studentUserId);
  const guardians = await repo.guardiansOfStudent(studentId, schoolId);
  for (const link of guardians) {
    const parentId = asString(link.parentId);
    if (parentId) ids.add(parentId);
  }
  return [...ids];
}

export async function bumpUnread(repo: Repo, thread: Doc, authorUserId: string, now: number): Promise<void> {
  const schoolId = asString(thread.schoolId) ?? '';
  const people = await participantUserIds(repo, thread, schoolId);
  for (const userId of people) {
    if (userId === authorUserId) continue;
    const id = threadReadId(thread._id, userId);
    const existing = await repo.db.get(COLLECTIONS.threadReads, id);
    if (!existing) {
      await repo.db.insert(COLLECTIONS.threadReads, {
        _id: id,
        threadId: thread._id,
        userId,
        schoolId,
        lastReadAt: 0,
        unreadCount: 1,
        updatedAt: now,
        schemaVersion: 1,
      });
      continue;
    }
    await repo.db.compareAndSet(COLLECTIONS.threadReads, id, undefined, {
      unreadCount: (asNumber(existing.unreadCount) ?? 0) + 1,
      updatedAt: now,
    });
  }
}

export async function markThreadRead(repo: Repo, threadId: string, userId: string, schoolId: string, now: number): Promise<void> {
  const id = threadReadId(threadId, userId);
  const existing = await repo.db.get(COLLECTIONS.threadReads, id);
  if (!existing) {
    await repo.db.insert(COLLECTIONS.threadReads, {
      _id: id,
      threadId,
      userId,
      schoolId,
      lastReadAt: now,
      unreadCount: 0,
      updatedAt: now,
      schemaVersion: 1,
    });
    return;
  }
  await repo.db.compareAndSet(COLLECTIONS.threadReads, id, undefined, {
    lastReadAt: now,
    unreadCount: 0,
    updatedAt: now,
  });
}

export async function unreadFor(repo: Repo, threadId: string, userId: string): Promise<number> {
  const row = await repo.db.get(COLLECTIONS.threadReads, threadReadId(threadId, userId));
  return asNumber(row?.unreadCount) ?? 0;
}
