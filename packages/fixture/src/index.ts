import { COLLECTIONS } from '@hst/shared';
import { MemoryStore, hashDevPassword, hashInviteCode, type Doc } from '@hst/core';

export const NOW = Date.parse('2026-11-09T02:00:00.000Z');
export const PEPPER = 'test-pepper';
export const DEV_DEMO_PASSWORD = 'DemoOnly-2026!';

export const ids = {
  school: 'sch_demo',
  year: 'year_2026',
  term: 'term_2026_1',
  classMyp: 'cls_myp4a',
  classDp: 'cls_dp1a',
  subjectSci: 'sub_sci',
  subjectPhy: 'sub_phy',
  courseSci: 'crs_sci',
  coursePhy: 'crs_phy',
  s1: 'stu_s1',
  s2: 'stu_s2',
  s3: 'stu_s3',
  s4: 'stu_s4',
  minor: 'stu_minor',
  uS1: 'u_s1',
  uS2: 'u_s2',
  uS3: 'u_s3',
  uS4: 'u_s4',
  uMinor: 'u_minor',
  p1: 'u_p1',
  p2: 'u_p2',
  p3: 'u_p3',
  p4: 'u_p4',
  p5: 'u_p5',
  t1: 'u_t1',
  t2: 'u_t2',
  t3: 'u_t3',
  sv1: 'u_sv1',
  cc1: 'u_cc1',
  a1: 'u_a1',
  ops1: 'u_ops1',
  taskShared: 'tsk_sci_shared',
  taskS2Only: 'tsk_s2_only',
  taskS1Released: 'tsk_s1_released',
  taskS1Draft: 'tsk_s1_draft',
  taskS3: 'tsk_s3',
  threadS1: 'thr_s1',
  threadS2: 'thr_s2',
  threadS3: 'thr_s3',
  fileS2: 'fil_s2',
  expS2: 'exp_s2',
  project: 'prj_s1_s2',
  planS2: 'pln_s2',
  planS3: 'pln_s3',
} as const;

export const canary = {
  s2Progress: 'cny_s2_progress',
  s2Submission: 'cny_s2_submission',
  s2Grade: 'cny_s2_grade',
  s1Draft: 'cny_s1_draft',
  s1History: 'cny_s1_history',
  s1Staff: 'cny_s1_staff',
  s2Message: 'cny_s2_message',
  s2Cas: 'cny_s2_cas',
  s2Reflection: 'cny_s2_reflection',
  s2Milestone: 'cny_s2_milestone',
  s2File: 'cny_s2_file',
  s2Rppf: 'cny_s2_rppf',
  s2Preview: 'cny_s2_preview',
  s2Week: 'cny_s2_weektask',
  s2Summary: 'cny_s2_summary',
  p2Notice: 'cny_p2_notice',
  s2Name: '演示学生二',
  p2Email: 'p2@demo.school.local',
} as const;

export const foreignMarkers = Object.values(canary);

const DUE_SHARED = Date.parse('2026-11-11T07:00:00.000Z');
const DUE_S2 = Date.parse('2026-11-10T07:00:00.000Z');

export interface Fixture {
  db: MemoryStore;
  now: number;
  pepper: string;
}

export async function createFixture(): Promise<Fixture> {
  const db = new MemoryStore();
  const now = NOW;
  const stamp = (actor: string): Doc => ({
    _id: 'unused',
    schoolId: ids.school,
    createdAt: now,
    createdBy: actor,
    updatedAt: now,
    updatedBy: actor,
    schemaVersion: 1,
  });
  const put = async (collection: string, doc: Doc) => {
    await db.insert(collection, doc);
  };

  await put(COLLECTIONS.schools, {
    ...stamp(ids.a1),
    _id: ids.school,
    name: { zh: '演示学校', en: 'Demo School' },
    timezone: 'Asia/Shanghai',
    settings: { digestWeekday: 0, digestHour: 18, casCoordinatorScope: 'all_dp', fileMaxMB: 20 },
  });
  await put(COLLECTIONS.academicYears, {
    ...stamp(ids.a1),
    _id: ids.year,
    name: '2026-2027',
    startDate: Date.parse('2026-08-01T00:00:00+08:00'),
    endDate: Date.parse('2027-07-01T00:00:00+08:00'),
    isCurrent: true,
    status: 'active',
  });
  await put(COLLECTIONS.terms, {
    ...stamp(ids.a1),
    _id: ids.term,
    yearId: ids.year,
    index: 1,
    name: { zh: '第一学期', en: 'Term 1' },
    startDate: Date.parse('2026-08-01T00:00:00+08:00'),
    endDate: Date.parse('2027-01-15T00:00:00+08:00'),
  });
  await put(COLLECTIONS.classes, {
    ...stamp(ids.a1),
    _id: ids.classMyp,
    yearId: ids.year,
    programme: 'MYP',
    name: { zh: 'MYP4-A', en: 'MYP4-A' },
    homeroomTeacherIds: [ids.t1],
  });
  await put(COLLECTIONS.classes, {
    ...stamp(ids.a1),
    _id: ids.classDp,
    yearId: ids.year,
    programme: 'DP',
    name: { zh: 'DP1-A', en: 'DP1-A' },
    homeroomTeacherIds: [ids.t2],
  });
  await put(COLLECTIONS.subjects, {
    ...stamp(ids.a1),
    _id: ids.subjectSci,
    programme: 'MYP',
    groupCode: 'SCI',
    code: 'SCI',
    name: { zh: '科学', en: 'Sciences' },
  });
  await put(COLLECTIONS.subjects, {
    ...stamp(ids.a1),
    _id: ids.subjectPhy,
    programme: 'DP',
    groupCode: 'G4',
    code: 'PHY',
    name: { zh: '物理', en: 'Physics' },
  });
  await put(COLLECTIONS.courses, {
    ...stamp(ids.a1),
    _id: ids.courseSci,
    yearId: ids.year,
    subjectId: ids.subjectSci,
    programme: 'MYP',
    name: { zh: 'MYP4 科学', en: 'MYP4 Sciences' },
    homeroomClassId: ids.classMyp,
  });
  await put(COLLECTIONS.courses, {
    ...stamp(ids.a1),
    _id: ids.coursePhy,
    yearId: ids.year,
    subjectId: ids.subjectPhy,
    programme: 'DP',
    name: { zh: 'DP1 物理', en: 'DP1 Physics' },
    homeroomClassId: ids.classDp,
    leakMarker: 'cny_dp_course',
  });

  const people: Array<{ id: string; roles: string[]; email: string; zh: string; en: string; uid: string; status?: string }> = [
    { id: ids.uS1, roles: ['student'], email: 's1@demo.school.local', zh: '演示学生一', en: 'Demo Student One', uid: 'uid_s1' },
    { id: ids.uS2, roles: ['student'], email: 's2@demo.school.local', zh: canary.s2Name, en: 'Demo Student Two', uid: 'uid_s2' },
    { id: ids.uS3, roles: ['student'], email: 's3@demo.school.local', zh: '演示学生三', en: 'Demo Student Three', uid: 'uid_s3' },
    { id: ids.uS4, roles: ['student'], email: 's4@demo.school.local', zh: '演示学生四', en: 'Demo Student Four', uid: 'uid_s4' },
    { id: ids.uMinor, roles: ['student'], email: 'minor@demo.school.local', zh: '演示未同意', en: 'Demo Minor', uid: 'uid_minor', status: 'pending_consent' },
    { id: ids.p1, roles: ['parent'], email: 'p1@demo.school.local', zh: '演示家长一', en: 'Demo Parent One', uid: 'uid_p1' },
    { id: ids.p2, roles: ['parent'], email: canary.p2Email, zh: '演示家长二', en: 'Demo Parent Two', uid: 'uid_p2' },
    { id: ids.p3, roles: ['parent'], email: 'p3@demo.school.local', zh: '演示家长三', en: 'Demo Parent Three', uid: 'uid_p3' },
    { id: ids.p4, roles: ['parent'], email: 'p4@demo.school.local', zh: '演示家长四', en: 'Demo Parent Four', uid: 'uid_p4' },
    { id: ids.p5, roles: ['parent'], email: 'p5@demo.school.local', zh: '演示家长五', en: 'Demo Parent Five', uid: 'uid_p5' },
    { id: ids.t1, roles: ['teacher'], email: 't1@demo.school.local', zh: '演示老师一', en: 'Demo Teacher One', uid: 'uid_t1' },
    { id: ids.t2, roles: ['teacher'], email: 't2@demo.school.local', zh: '演示老师二', en: 'Demo Teacher Two', uid: 'uid_t2' },
    { id: ids.t3, roles: ['teacher'], email: 't3@demo.school.local', zh: '演示老师三', en: 'Demo Teacher Three', uid: 'uid_t3' },
    { id: ids.sv1, roles: ['supervisor'], email: 'sv1@demo.school.local', zh: '演示导师', en: 'Demo Supervisor', uid: 'uid_sv1' },
    { id: ids.cc1, roles: ['cas_coordinator'], email: 'cc1@demo.school.local', zh: '演示协调员', en: 'Demo Coordinator', uid: 'uid_cc1' },
    { id: ids.a1, roles: ['admin'], email: 'a1@demo.school.local', zh: '演示管理员', en: 'Demo Admin', uid: 'uid_a1' },
    { id: ids.ops1, roles: ['ops_mailer'], email: 'ops@demo.school.local', zh: '发件机器人', en: 'Mail Bot', uid: 'uid_ops' },
  ];
  for (const person of people) {
    await put(COLLECTIONS.users, {
      ...stamp(ids.a1),
      _id: person.id,
      roles: person.roles,
      displayName: { zh: person.zh, en: person.en },
      email: person.email,
      locale: 'zh',
      status: person.status ?? 'active',
      mustChangePassword: false,
    });
    await put(COLLECTIONS.authIdentities, {
      _id: `idn_${person.uid}`,
      userId: person.id,
      provider: 'cloudbase_uid',
      appId: 'english-little-steps-d0a2b84764b',
      key: person.uid,
      boundAt: now,
      schoolId: ids.school,
    });
  }
  await put(COLLECTIONS.authIdentities, {
    _id: 'idn_p1_custom',
    userId: ids.p1,
    provider: 'custom',
    key: ids.p1,
    boundAt: now,
    schoolId: ids.school,
  });
  await put(COLLECTIONS.authIdentities, {
    _id: 'idn_p2_wx',
    userId: ids.p2,
    provider: 'wechat_mp_openid',
    key: 'oid_p2',
    boundAt: now,
    schoolId: ids.school,
  });

  const students: Array<{ id: string; userId: string; no: string; programme: string; classId: string; consent: string }> = [
    { id: ids.s1, userId: ids.uS1, no: 'S1001', programme: 'MYP', classId: ids.classMyp, consent: 'granted' },
    { id: ids.s2, userId: ids.uS2, no: 'S1002', programme: 'MYP', classId: ids.classMyp, consent: 'granted' },
    { id: ids.s3, userId: ids.uS3, no: 'S2001', programme: 'DP', classId: ids.classDp, consent: 'granted' },
    { id: ids.s4, userId: ids.uS4, no: 'S2002', programme: 'DP', classId: ids.classDp, consent: 'granted' },
    { id: ids.minor, userId: ids.uMinor, no: 'S1009', programme: 'MYP', classId: ids.classMyp, consent: 'required' },
  ];
  for (const student of students) {
    await put(COLLECTIONS.studentProfiles, {
      ...stamp(ids.a1),
      _id: student.id,
      userId: student.userId,
      studentNo: student.no,
      programme: student.programme,
      homeroomClassId: student.classId,
      ageBand: student.id === ids.minor ? 'under14' : '14plus',
      graduationYear: 2028,
      consentStatus: student.consent,
    });
  }

  const links: Array<{ id: string; parentId: string; studentId: string; status: string }> = [
    { id: 'grd_p1s1', parentId: ids.p1, studentId: ids.s1, status: 'active' },
    { id: 'grd_p2s2', parentId: ids.p2, studentId: ids.s2, status: 'active' },
    { id: 'grd_p3s3', parentId: ids.p3, studentId: ids.s3, status: 'active' },
    { id: 'grd_p3s4', parentId: ids.p3, studentId: ids.s4, status: 'active' },
    { id: 'grd_p4s1', parentId: ids.p4, studentId: ids.s1, status: 'revoked' },
  ];
  for (const link of links) {
    await put(COLLECTIONS.guardianships, {
      ...stamp(ids.a1),
      _id: link.id,
      parentId: link.parentId,
      studentId: link.studentId,
      relation: 'guardian',
      status: link.status,
      source: 'import',
      isPrimary: true,
      receivesEmail: true,
      ...(link.status === 'revoked' ? { revokedAt: now, revokedBy: ids.a1 } : {}),
    });
  }

  await put(COLLECTIONS.teachingAssignments, {
    ...stamp(ids.a1),
    _id: 'tch_t1',
    yearId: ids.year,
    teacherId: ids.t1,
    courseId: ids.courseSci,
    role: 'lead',
    startAt: now,
  });
  await put(COLLECTIONS.teachingAssignments, {
    ...stamp(ids.a1),
    _id: 'tch_t2',
    yearId: ids.year,
    teacherId: ids.t2,
    courseId: ids.coursePhy,
    role: 'lead',
    startAt: now,
  });
  for (const enrollment of [
    { id: 'enr_s1', studentId: ids.s1, courseId: ids.courseSci },
    { id: 'enr_s2', studentId: ids.s2, courseId: ids.courseSci },
    { id: 'enr_minor', studentId: ids.minor, courseId: ids.courseSci },
    { id: 'enr_s3', studentId: ids.s3, courseId: ids.coursePhy },
    { id: 'enr_s4', studentId: ids.s4, courseId: ids.coursePhy },
  ]) {
    await put(COLLECTIONS.enrollments, {
      ...stamp(ids.a1),
      _id: enrollment.id,
      yearId: ids.year,
      studentId: enrollment.studentId,
      courseId: enrollment.courseId,
      status: 'active',
      joinedAt: now,
    });
  }
  await put(COLLECTIONS.mentorships, {
    ...stamp(ids.a1),
    _id: 'men_sv1',
    yearId: ids.year,
    mentorId: ids.sv1,
    studentId: ids.s3,
    type: 'EE_SUPERVISOR',
    status: 'active',
  });

  async function task(doc: Doc) {
    await put(COLLECTIONS.tasks, { ...stamp(ids.t1), status: 'published', ...doc });
  }
  await task({
    _id: ids.taskShared,
    courseId: ids.courseSci,
    subjectId: ids.subjectSci,
    programme: 'MYP',
    termId: ids.term,
    yearId: ids.year,
    type: 'homework',
    title: '科学实验',
    description: '请完成本周实验记录',
    dueAt: DUE_SHARED,
    assigneeStudentIds: [ids.s1, ids.s2],
  });
  await task({
    _id: ids.taskS2Only,
    courseId: ids.courseSci,
    subjectId: ids.subjectSci,
    programme: 'MYP',
    termId: ids.term,
    yearId: ids.year,
    type: 'homework',
    title: canary.s2Week,
    description: canary.s2Week,
    dueAt: DUE_S2,
    assigneeStudentIds: [ids.s2],
  });
  await task({
    _id: ids.taskS1Released,
    courseId: ids.courseSci,
    subjectId: ids.subjectSci,
    programme: 'MYP',
    termId: ids.term,
    yearId: ids.year,
    type: 'summative',
    title: '科学测验',
    description: '已发布成绩的任务',
    dueAt: DUE_SHARED,
    assigneeStudentIds: [ids.s1],
  });
  await task({
    _id: ids.taskS1Draft,
    courseId: ids.courseSci,
    subjectId: ids.subjectSci,
    programme: 'MYP',
    termId: ids.term,
    yearId: ids.year,
    type: 'formative',
    title: '科学草稿',
    description: '草稿成绩不可见',
    dueAt: DUE_SHARED,
    assigneeStudentIds: [ids.s1],
  });
  await task({
    _id: ids.taskS3,
    courseId: ids.coursePhy,
    subjectId: ids.subjectPhy,
    programme: 'DP',
    termId: ids.term,
    yearId: ids.year,
    type: 'homework',
    title: '物理作业',
    description: 'DP 作业',
    dueAt: DUE_SHARED,
    assigneeStudentIds: [ids.s3],
    createdBy: ids.t2,
  });

  async function progress(doc: Doc) {
    await put(COLLECTIONS.taskProgress, { ...stamp(ids.t1), ...doc });
  }
  await progress({ _id: `${ids.taskShared}_${ids.s1}`, taskId: ids.taskShared, courseId: ids.courseSci, studentId: ids.s1, termId: ids.term, subjectId: ids.subjectSci, dueAt: DUE_SHARED, status: 'not_started', displayStatus: 'not_started', isOverdue: false, isLate: false });
  await progress({ _id: `${ids.taskShared}_${ids.s2}`, taskId: ids.taskShared, courseId: ids.courseSci, studentId: ids.s2, termId: ids.term, subjectId: ids.subjectSci, dueAt: DUE_SHARED, status: 'graded', displayStatus: 'graded', isOverdue: false, isLate: false, leakMarker: canary.s2Progress });
  await progress({ _id: `${ids.taskS2Only}_${ids.s2}`, taskId: ids.taskS2Only, courseId: ids.courseSci, studentId: ids.s2, termId: ids.term, subjectId: ids.subjectSci, dueAt: DUE_S2, status: 'not_started', displayStatus: 'overdue', isOverdue: true, isLate: false, leakMarker: canary.s2Progress });
  await progress({ _id: `${ids.taskS1Released}_${ids.s1}`, taskId: ids.taskS1Released, courseId: ids.courseSci, studentId: ids.s1, termId: ids.term, subjectId: ids.subjectSci, dueAt: DUE_SHARED, status: 'graded', displayStatus: 'graded', isOverdue: false, isLate: false });
  await progress({ _id: `${ids.taskS1Draft}_${ids.s1}`, taskId: ids.taskS1Draft, courseId: ids.courseSci, studentId: ids.s1, termId: ids.term, subjectId: ids.subjectSci, dueAt: DUE_SHARED, status: 'submitted', displayStatus: 'submitted', isOverdue: false, isLate: false });
  await progress({ _id: `${ids.taskS3}_${ids.s3}`, taskId: ids.taskS3, courseId: ids.coursePhy, studentId: ids.s3, termId: ids.term, subjectId: ids.subjectPhy, dueAt: DUE_SHARED, status: 'not_started', displayStatus: 'not_started', isOverdue: false, isLate: false });
  await progress({ _id: `${ids.taskShared}_${ids.minor}`, taskId: ids.taskShared, courseId: ids.courseSci, studentId: ids.minor, termId: ids.term, subjectId: ids.subjectSci, dueAt: DUE_SHARED, status: 'not_started', displayStatus: 'not_started', isOverdue: false, isLate: false });

  await put(COLLECTIONS.submissions, {
    ...stamp(ids.uS2),
    _id: 'sub_s2',
    progressId: `${ids.taskShared}_${ids.s2}`,
    taskId: ids.taskShared,
    studentId: ids.s2,
    version: 1,
    text: canary.s2Submission,
    fileIds: [ids.fileS2],
    submittedAt: now,
    isLate: false,
  });
  await put(COLLECTIONS.files, {
    ...stamp(ids.uS2),
    _id: ids.fileS2,
    cloudFileId: `cloud://demo/hst_vault/${ids.school}/submission/sub_s2/${ids.fileS2}`,
    stage: 'vault',
    ownerUserId: ids.uS2,
    refType: 'submission',
    refId: 'sub_s2',
    studentId: ids.s2,
    name: canary.s2File,
    mime: 'application/pdf',
    size: 1200,
  });
  await put(COLLECTIONS.assessments, {
    ...stamp(ids.t1),
    _id: `${ids.taskS1Released}_${ids.s1}`,
    taskId: ids.taskS1Released,
    studentId: ids.s1,
    courseId: ids.courseSci,
    subjectId: ids.subjectSci,
    termId: ids.term,
    yearId: ids.year,
    scheme: 'MYP',
    subject: '科学',
    taskTitle: '科学测验',
    myp: { A: { level: 6, comment: '理解准确' } },
    overallComment: '已发布评语',
    status: 'released',
    releasedAt: now,
    history: [{ at: now, by: ids.t1, diff: canary.s1History }],
    version: 1,
  });
  await put(COLLECTIONS.assessments, {
    ...stamp(ids.t1),
    _id: `${ids.taskS1Draft}_${ids.s1}`,
    taskId: ids.taskS1Draft,
    studentId: ids.s1,
    courseId: ids.courseSci,
    subjectId: ids.subjectSci,
    termId: ids.term,
    yearId: ids.year,
    scheme: 'MYP',
    subject: '科学',
    taskTitle: '科学草稿',
    overallComment: canary.s1Draft,
    status: 'draft',
    version: 1,
  });
  await put(COLLECTIONS.assessments, {
    ...stamp(ids.t1),
    _id: `${ids.taskS2Only}_${ids.s2}`,
    taskId: ids.taskS2Only,
    studentId: ids.s2,
    courseId: ids.courseSci,
    subjectId: ids.subjectSci,
    termId: ids.term,
    yearId: ids.year,
    scheme: 'MYP',
    subject: '科学',
    taskTitle: canary.s2Week,
    overallComment: canary.s2Grade,
    status: 'released',
    releasedAt: now,
    version: 1,
  });
  await put(COLLECTIONS.termSummaries, {
    ...stamp(ids.t1),
    _id: `${ids.s2}_${ids.subjectSci}_${ids.term}`,
    studentId: ids.s2,
    subjectId: ids.subjectSci,
    termId: ids.term,
    scheme: 'MYP',
    myp: { A: { bestFit: 5 } },
    leakMarker: canary.s2Summary,
  });
  await put(COLLECTIONS.termSummaries, {
    ...stamp(ids.t1),
    _id: `${ids.s1}_${ids.subjectSci}_${ids.term}`,
    studentId: ids.s1,
    subjectId: ids.subjectSci,
    termId: ids.term,
    scheme: 'MYP',
    myp: { A: { bestFit: 6 } },
  });

  await put(COLLECTIONS.threads, {
    ...stamp(ids.t1),
    _id: ids.threadS1,
    contextType: 'task',
    contextId: ids.taskS1Released,
    studentId: ids.s1,
    staffUserIds: [ids.t1],
    lastMessageAt: now,
    lastMessagePreview: '已发布评语',
    messageCount: 2,
  });
  await put(COLLECTIONS.threads, {
    ...stamp(ids.t1),
    _id: ids.threadS2,
    contextType: 'task',
    contextId: ids.taskS2Only,
    studentId: ids.s2,
    staffUserIds: [ids.t1],
    lastMessageAt: now,
    lastMessagePreview: canary.s2Preview,
    messageCount: 1,
  });
  await put(COLLECTIONS.threads, {
    ...stamp(ids.t2),
    _id: ids.threadS3,
    contextType: 'task',
    contextId: ids.taskS3,
    studentId: ids.s3,
    staffUserIds: [ids.t2],
    lastMessageAt: now,
    lastMessagePreview: '物理讨论',
    messageCount: 0,
  });
  await put(COLLECTIONS.messages, {
    ...stamp(ids.t1),
    _id: 'msg_s1_all',
    threadId: ids.threadS1,
    studentId: ids.s1,
    authorId: ids.t1,
    authorRole: 'teacher',
    kind: 'teacher_comment',
    body: '家长可见留言',
    visibility: 'all',
  });
  await put(COLLECTIONS.messages, {
    ...stamp(ids.t1),
    _id: 'msg_s1_staff',
    threadId: ids.threadS1,
    studentId: ids.s1,
    authorId: ids.t1,
    authorRole: 'teacher',
    kind: 'teacher_comment',
    body: canary.s1Staff,
    visibility: 'staff_student',
  });
  await put(COLLECTIONS.messages, {
    ...stamp(ids.t1),
    _id: 'msg_s2',
    threadId: ids.threadS2,
    studentId: ids.s2,
    authorId: ids.t1,
    authorRole: 'teacher',
    kind: 'teacher_comment',
    body: canary.s2Message,
    visibility: 'all',
  });

  await put(COLLECTIONS.casExperiences, {
    ...stamp(ids.uS2),
    _id: ids.expS2,
    studentId: ids.s2,
    title: '服务经历',
    description: canary.s2Cas,
    strands: ['S'],
    status: 'approved',
  });
  await put(COLLECTIONS.casReflections, {
    ...stamp(ids.uS2),
    _id: 'ref_s2',
    experienceId: ids.expS2,
    studentId: ids.s2,
    body: canary.s2Reflection,
    format: 'text',
  });
  await put(COLLECTIONS.casProjects, {
    ...stamp(ids.uS1),
    _id: ids.project,
    title: '共同活动',
    memberStudentIds: [ids.s1, ids.s2],
    leaderStudentId: ids.s1,
    strands: ['A'],
    stage: 'action',
    status: 'active',
    experienceIds: [ids.expS2],
  });
  await put(COLLECTIONS.milestonePlans, {
    ...stamp(ids.a1),
    _id: ids.planS2,
    programType: 'EE',
    yearId: ids.year,
    studentIds: [ids.s2],
    supervisorId: ids.sv1,
    title: canary.s2Milestone,
    status: 'active',
  });
  await put(COLLECTIONS.milestonePlans, {
    ...stamp(ids.a1),
    _id: ids.planS3,
    programType: 'EE',
    yearId: ids.year,
    studentIds: [ids.s3],
    supervisorId: ids.sv1,
    title: 'S3 论文选题',
    status: 'active',
  });
  await put(COLLECTIONS.rppfEntries, {
    ...stamp(ids.uS2),
    _id: `${ids.planS2}_1`,
    planId: ids.planS2,
    studentId: ids.s2,
    session: 1,
    studentReflection: canary.s2Rppf,
    wordCount: 40,
  });

  await put(COLLECTIONS.notifications, {
    _id: 'ntf_p1',
    recipientUserId: ids.p1,
    recipientAuthUid: 'uid_p1',
    type: 'task_new',
    studentId: ids.s1,
    title: { zh: '科学实验', en: 'Sciences lab' },
    body: { zh: '科学任务有更新', en: 'Science task updated' },
    link: `/p/tasks/${ids.taskShared}?student=${ids.s1}`,
    refType: 'task',
    refId: ids.taskShared,
    digest: { pending: false },
    dedupeKey: `task_new:${ids.taskShared}:${ids.p1}`,
    createdAt: now,
    schoolId: ids.school,
  });
  await put(COLLECTIONS.notifications, {
    _id: 'ntf_p2',
    recipientUserId: ids.p2,
    recipientAuthUid: 'uid_p2',
    type: 'grade_released',
    studentId: ids.s2,
    title: { zh: canary.s2Week, en: canary.s2Week },
    body: { zh: canary.p2Notice, en: canary.p2Notice },
    link: `/p/tasks/${ids.taskS2Only}?student=${ids.s2}`,
    refType: 'task',
    refId: ids.taskS2Only,
    digest: { pending: false },
    dedupeKey: `grade:${ids.taskS2Only}:${ids.p2}`,
    createdAt: now,
    schoolId: ids.school,
  });

  await put(COLLECTIONS.inviteCodes, {
    ...stamp(ids.a1),
    _id: 'inv_used',
    type: 'guardian_bind',
    codeHash: hashInviteCode('USEDCODE', PEPPER),
    studentId: ids.s2,
    status: 'used',
    expiresAt: now + 7 * 24 * 60 * 60 * 1000,
    maxUses: 1,
    usedCount: 1,
    version: 2,
  });
  await put(COLLECTIONS.inviteCodes, {
    ...stamp(ids.a1),
    _id: 'inv_expired',
    type: 'guardian_bind',
    codeHash: hashInviteCode('EXPIRED1', PEPPER),
    studentId: ids.s2,
    status: 'active',
    expiresAt: now - 1000,
    maxUses: 1,
    usedCount: 0,
    version: 1,
  });
  await put(COLLECTIONS.consentPolicies, {
    _id: 'pol_privacy',
    version: '2026-11-v1',
    kind: 'privacy',
    content: { zh: '演示隐私政策，不含任何学生信息。', en: 'Demo privacy policy. No student data.' },
    effectiveAt: now,
    requiresReconsent: false,
    schoolId: ids.school,
  });
  await put(COLLECTIONS.consentPolicies, {
    _id: 'pol_guardian',
    version: '2026-11-v1',
    kind: 'guardian_minor',
    content: { zh: '未满 14 岁学生的监护人同意书（演示文本）。', en: 'Guardian consent for students under 14 (demo text).' },
    effectiveAt: now,
    requiresReconsent: false,
    schoolId: ids.school,
  });

  return { db, now, pepper: PEPPER };
}

export function devPasswordHash(password: string): string {
  return hashDevPassword(password);
}

export function verifyDevPassword(email: string, password: string): { uid: string; userId: string } | null {
  if (password !== DEV_DEMO_PASSWORD) return null;
  const directory: Record<string, { uid: string; userId: string }> = {
    'p1@demo.school.local': { uid: 'uid_p1', userId: ids.p1 },
    'p5@demo.school.local': { uid: 'uid_p5', userId: ids.p5 },
    't1@demo.school.local': { uid: 'uid_t1', userId: ids.t1 },
    's1@demo.school.local': { uid: 'uid_s1', userId: ids.uS1 },
    'a1@demo.school.local': { uid: 'uid_a1', userId: ids.a1 },
    'minor@demo.school.local': { uid: 'uid_minor', userId: ids.uMinor },
  };
  return directory[email.toLowerCase()] ?? null;
}
