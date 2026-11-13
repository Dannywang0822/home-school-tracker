import { COLLECTIONS } from '@hst/shared';
import type { Doc } from '../db/types.js';
import type { Repo } from '../repo.js';

type Text = { zh: string; en: string };
type CriterionSeed = { criterion: 'A' | 'B' | 'C' | 'D'; title: Text };

const GUIDE = '2014/2021';

const MYP_GROUPS: { groupCode: string; criteria: CriterionSeed[] }[] = [
  group('LL', [
    ['A', '分析', 'Analysing'],
    ['B', '组织', 'Organizing'],
    ['C', '创作文本', 'Producing text'],
    ['D', '运用语言', 'Using language'],
  ]),
  group('LA', [
    ['A', '聆听', 'Listening'],
    ['B', '阅读', 'Reading'],
    ['C', '口语', 'Speaking'],
    ['D', '写作', 'Writing'],
  ]),
  group('IS', [
    ['A', '了解与理解', 'Knowing and understanding'],
    ['B', '探究', 'Investigating'],
    ['C', '交流', 'Communicating'],
    ['D', '批判性思考', 'Thinking critically'],
  ]),
  group('SCI', [
    ['A', '了解与理解', 'Knowing and understanding'],
    ['B', '探究与设计', 'Inquiring and designing'],
    ['C', '处理与评价', 'Processing and evaluating'],
    ['D', '反思科学的影响', 'Reflecting on the impacts of science'],
  ]),
  group('MATH', [
    ['A', '了解与理解', 'Knowing and understanding'],
    ['B', '探究规律', 'Investigating patterns'],
    ['C', '交流', 'Communicating'],
    ['D', '在现实情境中应用数学', 'Applying mathematics in real-life contexts'],
  ]),
  group('ARTS', [
    ['A', '探究', 'Investigating'],
    ['B', '发展', 'Developing'],
    ['C', '创作或表演', 'Creating or performing'],
    ['D', '评价', 'Evaluating'],
  ]),
  group('PHE', [
    ['A', '了解与理解', 'Knowing and understanding'],
    ['B', '为表现做计划', 'Planning for performance'],
    ['C', '应用与表现', 'Applying and performing'],
    ['D', '反思并改进表现', 'Reflecting and improving performance'],
  ]),
  group('DES', [
    ['A', '探究与分析', 'Inquiring and analysing'],
    ['B', '发展想法', 'Developing ideas'],
    ['C', '制作解决方案', 'Creating the solution'],
    ['D', '评价', 'Evaluating'],
  ]),
  group('PP', [
    ['A', '规划', 'Planning'],
    ['B', '技能应用', 'Applying skills'],
    ['C', '反思', 'Reflecting'],
  ]),
  group('CP', [
    ['A', '规划', 'Planning'],
    ['B', '技能应用', 'Applying skills'],
    ['C', '反思', 'Reflecting'],
  ]),
];

const DP_PARTS: { code: string; zh: string; en: string; type: 'internal' | 'external'; weightPct: number }[] = [
  { code: 'IA', zh: '内部评估', en: 'Internal assessment', type: 'internal', weightPct: 20 },
  { code: 'P1', zh: '试卷 1', en: 'Paper 1', type: 'external', weightPct: 20 },
  { code: 'P2', zh: '试卷 2', en: 'Paper 2', type: 'external', weightPct: 36 },
  { code: 'P3', zh: '试卷 3', en: 'Paper 3', type: 'external', weightPct: 24 },
  { code: 'EA', zh: '外部评估', en: 'External assessment', type: 'external', weightPct: 80 },
];

function group(groupCode: string, rows: Array<['A' | 'B' | 'C' | 'D', string, string]>): {
  groupCode: string;
  criteria: CriterionSeed[];
} {
  return {
    groupCode,
    criteria: rows.map(([criterion, zh, en]) => ({ criterion, title: { zh, en } })),
  };
}

function criterionId(schoolId: string, groupCode: string, criterion: string): string {
  return `crt_${schoolId}_${groupCode}_${criterion}`;
}

/** Inserts MYP criteria (eight groups plus PP/CP) and DP components for each DP subject. Idempotent. */
export async function ensureAssessmentCatalog(repo: Repo, schoolId: string, actorId: string, now: number): Promise<void> {
  const existing = await repo.db.query(
    COLLECTIONS.assessmentCriteria,
    (doc) => doc.schoolId === schoolId && doc.deletedAt == null,
  );
  if (existing.length === 0) {
    for (const item of MYP_GROUPS) {
      for (const criterion of item.criteria) {
        const doc: Doc = {
          _id: criterionId(schoolId, item.groupCode, criterion.criterion),
          schoolId,
          programme: item.groupCode === 'PP' || item.groupCode === 'CP' ? item.groupCode : 'MYP',
          groupCode: item.groupCode,
          criterion: criterion.criterion,
          title: criterion.title,
          maxLevel: 8,
          strands: [],
          guideVersion: GUIDE,
          createdAt: now,
          createdBy: actorId,
          updatedAt: now,
          updatedBy: actorId,
          schemaVersion: 1,
        };
        await repo.db.insert(COLLECTIONS.assessmentCriteria, doc);
      }
    }
  }
  const subjects = await repo.db.query(
    COLLECTIONS.subjects,
    (doc) => doc.schoolId === schoolId && doc.deletedAt == null && doc.programme === 'DP',
  );
  const components = await repo.db.query(
    COLLECTIONS.dpComponents,
    (doc) => doc.schoolId === schoolId && doc.deletedAt == null,
  );
  const have = new Set(components.map((doc) => `${doc.subjectId}:${doc.code}`));
  for (const subject of subjects) {
    for (const part of DP_PARTS) {
      if (have.has(`${subject._id}:${part.code}`)) continue;
      await repo.db.insert(COLLECTIONS.dpComponents, {
        _id: `dpc_${subject._id}_${part.code}`,
        schoolId,
        subjectId: subject._id,
        code: part.code,
        name: { zh: part.zh, en: part.en },
        type: part.type,
        weightPct: part.weightPct,
        createdAt: now,
        createdBy: actorId,
        updatedAt: now,
        updatedBy: actorId,
        schemaVersion: 1,
      });
    }
  }
}
