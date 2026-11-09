import { COLLECTIONS } from '@hst/shared';
import type { Repo } from '../repo.js';
import { nid } from '../util.js';

const MYP_SUBJECTS: Array<[string, string, string]> = [
  ['LL', '语言与文学', 'Language and literature'],
  ['LA', '语言习得', 'Language acquisition'],
  ['IS', '个人与社会', 'Individuals and societies'],
  ['SCI', '科学', 'Sciences'],
  ['MATH', '数学', 'Mathematics'],
  ['ARTS', '艺术', 'Arts'],
  ['PHE', '体育与健康教育', 'Physical and health education'],
  ['DES', '设计', 'Design'],
];

const DP_SUBJECTS: Array<[string, string, string, string]> = [
  ['CHINESE_A', 'G1', '中文 A', 'Chinese A'],
  ['ENGLISH_B', 'G2', '英语 B', 'English B'],
  ['HISTORY', 'G3', '历史', 'History'],
  ['PHY', 'G4', '物理', 'Physics'],
  ['MATH_AA', 'G5', '数学 AA', 'Mathematics AA'],
  ['VISUAL_ARTS', 'G6', '视觉艺术', 'Visual arts'],
  ['TOK', 'CORE', '知识论', 'Theory of knowledge'],
  ['EE', 'CORE', '拓展论文', 'Extended essay'],
  ['CAS', 'CORE', 'CAS', 'CAS'],
];

const GRADES: Array<['MYP' | 'DP', string, string, string]> = [
  ['MYP', 'MYP1', 'MYP 1', 'MYP 1'],
  ['MYP', 'MYP2', 'MYP 2', 'MYP 2'],
  ['MYP', 'MYP3', 'MYP 3', 'MYP 3'],
  ['MYP', 'MYP4', 'MYP 4', 'MYP 4'],
  ['MYP', 'MYP5', 'MYP 5', 'MYP 5'],
  ['DP', 'DP1', 'DP 1', 'DP 1'],
  ['DP', 'DP2', 'DP 2', 'DP 2'],
];

export async function ensureSchoolDefaults(repo: Repo, schoolId: string, actorId: string, now: number): Promise<{ created: number }> {
  let created = 0;
  const stamp = {
    schoolId,
    createdAt: now,
    createdBy: actorId,
    updatedAt: now,
    updatedBy: actorId,
    schemaVersion: 1,
  };
  for (const [programme, level, zh, en] of GRADES) {
    if (await repo.findGrade(schoolId, programme, level)) continue;
    await repo.db.insert(COLLECTIONS.grades, {
      ...stamp,
      _id: nid('grd_'),
      programme,
      level,
      name: { zh, en },
      order: GRADES.findIndex((item) => item[1] === level),
    });
    created += 1;
  }
  for (const [code, zh, en] of MYP_SUBJECTS) {
    if (await repo.findSubjectByCode(schoolId, code)) continue;
    await repo.db.insert(COLLECTIONS.subjects, {
      ...stamp,
      _id: nid('sub_'),
      programme: 'MYP',
      groupCode: code,
      code,
      name: { zh, en },
    });
    created += 1;
  }
  for (const [code, groupCode, zh, en] of DP_SUBJECTS) {
    if (await repo.findSubjectByCode(schoolId, code)) continue;
    await repo.db.insert(COLLECTIONS.subjects, {
      ...stamp,
      _id: nid('sub_'),
      programme: 'DP',
      groupCode,
      code,
      name: { zh, en },
    });
    created += 1;
  }
  if (!(await repo.currentPolicy('guardian_minor'))) {
    await repo.db.insert(COLLECTIONS.consentPolicies, {
      _id: nid('pol_'),
      schoolId,
      version: '2026-11-v1',
      kind: 'guardian_minor',
      content: { zh: '未满 14 岁学生的监护人同意书（演示文本）。', en: 'Guardian consent for students under 14 (demo text).' },
      effectiveAt: now,
      requiresReconsent: false,
    });
    created += 1;
  }
  return { created };
}
