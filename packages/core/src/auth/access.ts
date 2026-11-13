import type { ActionContext } from './registry.js';
import { asString, asStringArray } from '../util.js';
import type { Doc } from '../db/types.js';

export async function activeChildIds(ctx: ActionContext): Promise<string[]> {
  const links = await ctx.repo.activeChildLinks(ctx.caller.userId, ctx.caller.schoolId);
  return links.map((doc) => asString(doc.studentId)).filter((id): id is string => Boolean(id));
}

export async function canReadStudentAcademic(ctx: ActionContext, studentId: string): Promise<boolean> {
  const student = await ctx.repo.getStudent(studentId);
  if (!student || student.schoolId !== ctx.caller.schoolId) return false;
  const { caller, repo, clock } = ctx;
  if (caller.roles.includes('admin')) return true;
  if (caller.roles.includes('parent') && (await repo.isGuardianOf(caller.userId, studentId, caller.schoolId))) {
    return true;
  }
  if (caller.roles.includes('student') && student.userId === caller.userId) return true;
  if (caller.roles.includes('teacher')) {
    if (await repo.teachesStudent(caller.userId, studentId, caller.schoolId, clock.now())) return true;
    if (await repo.isHomeroomOf(caller.userId, studentId, caller.schoolId)) return true;
  }
  return false;
}

export async function canReadCas(ctx: ActionContext, studentId: string): Promise<boolean> {
  const student = await ctx.repo.getStudent(studentId);
  if (!student || student.schoolId !== ctx.caller.schoolId) return false;
  const { caller, repo } = ctx;
  if (caller.roles.includes('parent') && (await repo.isGuardianOf(caller.userId, studentId, caller.schoolId))) {
    return true;
  }
  if (caller.roles.includes('student') && student.userId === caller.userId) return true;
  if (caller.roles.includes('cas_coordinator') && student.programme === 'DP') return true;
  if (caller.roles.includes('supervisor') && (await repo.mentors(caller.userId, studentId, caller.schoolId, 'CAS_ADVISOR'))) {
    return true;
  }
  return false;
}

export async function canReadPlan(ctx: ActionContext, plan: Doc): Promise<boolean> {
  if (plan.schoolId !== ctx.caller.schoolId) return false;
  const studentIds = asStringArray(plan.studentIds);
  if (ctx.caller.roles.includes('admin')) return studentIds.length > 0;
  for (const studentId of studentIds) {
    if (await canReadStudentAcademic(ctx, studentId)) return true;
    if (ctx.caller.roles.includes('supervisor') && (await ctx.repo.mentors(ctx.caller.userId, studentId, ctx.caller.schoolId))) {
      return true;
    }
    const program = asString(plan.programType);
    if (ctx.caller.roles.includes('ee_coordinator') && (program === 'EE' || program === 'PP' || program === 'CP')) {
      return true;
    }
  }
  return false;
}

export function displayNameOf(doc: Doc | null | undefined): { zh: string; en?: string } {
  const value = doc?.displayName;
  if (value && typeof value === 'object') {
    const record = value as { zh?: unknown; en?: unknown };
    const en = asString(record.en);
    return en ? { zh: asString(record.zh) ?? '', en } : { zh: asString(record.zh) ?? '' };
  }
  return { zh: '' };
}

export function maskDisplayName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '*';
  return `${trimmed.slice(0, 1)}**`;
}

export function projectProgress(doc: Doc): { status: string; displayStatus: string; isLate: boolean; submittedAt?: number } {
  const submittedAt = typeof doc.submittedAt === 'number' ? doc.submittedAt : undefined;
  return {
    status: asString(doc.status) ?? 'not_started',
    displayStatus: asString(doc.displayStatus) ?? 'not_started',
    isLate: doc.isLate === true,
    ...(submittedAt != null ? { submittedAt } : {}),
  };
}

export function projectTask(doc: Doc): Record<string, unknown> {
  return {
    taskId: doc._id,
    title: doc.title,
    description: doc.description ?? '',
    dueAt: doc.dueAt,
    status: doc.status,
    type: doc.type,
    requiresSubmission: doc.requiresSubmission !== false,
    allowLate: doc.allowLate === true,
    courseId: doc.courseId,
    subjectId: doc.subjectId,
    programme: doc.programme,
    assessment: doc.assessment ?? null,
  };
}

export function projectAssessment(doc: Doc): Record<string, unknown> | null {
  if (doc.status !== 'released') return null;
  return {
    taskId: doc.taskId,
    taskTitle: doc.taskTitle,
    subject: doc.subject,
    myp: doc.myp,
    dp: doc.dp,
    overallComment: doc.overallComment ?? '',
    releasedAt: doc.releasedAt,
  };
}
