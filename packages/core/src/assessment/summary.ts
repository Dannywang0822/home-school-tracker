import { COLLECTIONS } from '@hst/shared';
import type { Doc } from '../db/types.js';
import type { Repo } from '../repo.js';
import { asNumber, isRecord } from '../util.js';

const CRITERIA = ['A', 'B', 'C', 'D'] as const;
const DEFAULT_BANDS = [
  { max: 5, grade: 1 },
  { max: 9, grade: 2 },
  { max: 14, grade: 3 },
  { max: 18, grade: 4 },
  { max: 23, grade: 5 },
  { max: 27, grade: 6 },
  { max: 32, grade: 7 },
];

export function medianLevel(samples: number[]): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return Math.round(((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2);
}

export function gradeFromTotal(total: number, boundaries: unknown): number {
  const bands = parseBands(boundaries) ?? DEFAULT_BANDS;
  for (const band of bands) {
    if (total <= band.max) return band.grade;
  }
  return bands.at(-1)?.grade ?? 7;
}

function parseBands(value: unknown): { max: number; grade: number }[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const bands = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    const max = asNumber(item.max);
    const grade = asNumber(item.grade);
    if (max == null || grade == null) return null;
    bands.push({ max, grade });
  }
  return bands.sort((left, right) => left.max - right.max);
}

export async function recomputeTermSummary(
  repo: Repo,
  input: { schoolId: string; studentId: string; subjectId: string; termId: string; yearId: string; scheme: string; actorId: string; now: number },
): Promise<void> {
  const released = await repo.db.query(
    COLLECTIONS.assessments,
    (doc) =>
      doc.deletedAt == null &&
      doc.schoolId === input.schoolId &&
      doc.studentId === input.studentId &&
      doc.subjectId === input.subjectId &&
      doc.termId === input.termId &&
      doc.status === 'released',
  );
  const school = await repo.getSchool(input.schoolId);
  const settings = isRecord(school?.settings) ? school.settings : {};
  const id = `${input.studentId}_${input.subjectId}_${input.termId}`;
  const existing = await repo.db.get(COLLECTIONS.termSummaries, id);
  const patch: Doc = {
    _id: id,
    schoolId: input.schoolId,
    studentId: input.studentId,
    subjectId: input.subjectId,
    termId: input.termId,
    yearId: input.yearId,
    scheme: input.scheme,
    computedAt: input.now,
    updatedAt: input.now,
    updatedBy: input.actorId,
    schemaVersion: 1,
  };
  if (input.scheme === 'DP') {
    const scores = released
      .map((doc) => (isRecord(doc.dp) ? asNumber(doc.dp.score) : undefined))
      .filter((score): score is number => score != null);
    const avg = scores.length === 0 ? 0 : scores.reduce((sum, score) => sum + score, 0) / scores.length;
    patch.dp = { predicted: scores.length === 0 ? 1 : Math.min(7, Math.max(1, Math.round(avg))), avgTaskScore: Math.round(avg * 10) / 10 };
  } else {
    const myp: Record<string, unknown> = {};
    let total = 0;
    for (const key of CRITERIA) {
      const samples = released
        .map((doc) => {
          const cell = isRecord(doc.myp) ? doc.myp[key] : undefined;
          return isRecord(cell) ? asNumber(cell.level) : undefined;
        })
        .filter((level): level is number => level != null);
      if (samples.length === 0) continue;
      const bestFit = medianLevel(samples);
      myp[key] = { bestFit, samples };
      total += bestFit;
    }
    myp.total = total;
    myp.grade = gradeFromTotal(total, settings.mypBoundaries);
    patch.myp = myp;
  }
  if (!existing) {
    await repo.db.insert(COLLECTIONS.termSummaries, {
      ...patch,
      createdAt: input.now,
      createdBy: input.actorId,
    });
    return;
  }
  await repo.db.compareAndSet(COLLECTIONS.termSummaries, id, undefined, patch);
}

export function linkedCriteria(task: Doc): string[] {
  const assessment = task.assessment;
  if (!isRecord(assessment) || assessment.scheme !== 'MYP') return [];
  return Array.isArray(assessment.criteria) ? assessment.criteria.filter((item): item is string => typeof item === 'string') : [];
}

export function taskScheme(task: Doc): 'MYP' | 'DP' | null {
  const assessment = task.assessment;
  if (!isRecord(assessment)) return null;
  if (assessment.scheme === 'MYP' || assessment.scheme === 'DP') return assessment.scheme;
  return null;
}

export function scoresComplete(task: Doc, assessment: Doc | null): boolean {
  const scheme = taskScheme(task);
  if (!scheme || !assessment) return false;
  if (scheme === 'DP') {
    const score = isRecord(assessment.dp) ? asNumber(assessment.dp.score) : undefined;
    return score != null && score >= 1 && score <= 7;
  }
  const myp = isRecord(assessment.myp) ? assessment.myp : {};
  return linkedCriteria(task).every((key) => {
    const cell = myp[key];
    const level = isRecord(cell) ? asNumber(cell.level) : undefined;
    return level != null && level >= 0 && level <= 8;
  });
}
