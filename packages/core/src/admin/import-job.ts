import { COLLECTIONS, isRole, type Role } from '@hst/shared';
import { AppError } from '../app-error.js';
import type { Repo } from '../repo.js';
import { asNumber, asString, asStringArray, hashDevPassword, nid, randomTempPassword, sha256 } from '../util.js';
import type { CsvError } from './csv.js';
import { readTable } from './csv.js';

const ROLES = new Set(['teacher', 'student', 'parent', 'cas_coordinator', 'ee_coordinator', 'supervisor', 'admin']);
const RELATIONS = new Set(['mother', 'father', 'guardian', 'other']);
const TEACHING_ROLES = new Set(['lead', 'co', 'assistant']);
const MENTOR_TYPES = new Set(['EE_SUPERVISOR', 'PP_SUPERVISOR', 'CP_SUPERVISOR', 'CAS_ADVISOR', 'IA_TEACHER']);
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PHONE = /^\+[1-9]\d{6,14}$/;

export interface ImportContext {
  repo: Repo;
  schoolId: string;
  actorId: string;
  now: number;
}

export async function validateImport(ctx: ImportContext, type: string, csv: string) {
  const table = readTable(type, csv);
  const errors = [...table.errors];
  if (errors.length === 0) {
    const seen = new Set<string>();
    for (let index = 0; index < table.records.length; index += 1) {
      const record = table.records[index] ?? {};
      const row = index + 2;
      errors.push(...(await validateRow(ctx, type, record, row, seen)));
    }
  }
  const preview = table.records.slice(0, 20).map((record) => sanitizePreview(record));
  const jobId = nid('job_');
  await ctx.repo.db.insert(COLLECTIONS.importJobs, {
    _id: jobId,
    schoolId: ctx.schoolId,
    type,
    dryRun: true,
    status: errors.length > 0 ? 'failed' : 'ready',
    total: table.records.length,
    ok: 0,
    failed: errors.length,
    errors: errors.slice(0, 500),
    preview,
    csvHash: sha256(csv),
    csv: errors.length > 0 ? '' : csv,
    createdBy: ctx.actorId,
    createdAt: ctx.now,
    credentials: [],
    credentialsRead: false,
  });
  if (errors.length > 0) {
    throw new AppError('IMPORT_VALIDATION_FAILED', '导入文件有错误', {
      jobId,
      total: table.records.length,
      errors: errors.slice(0, 500),
    });
  }
  return { jobId, total: table.records.length, errors: [], preview };
}

export async function runImport(ctx: ImportContext, jobId: string) {
  const job = await ctx.repo.db.get(COLLECTIONS.importJobs, jobId);
  if (!job || job.schoolId !== ctx.schoolId || job.createdBy !== ctx.actorId) {
    throw new AppError('NOT_FOUND', '资源不存在');
  }
  if (job.status === 'done') {
    return { jobId, status: 'done', created: asNumber(job.created) ?? 0, updated: asNumber(job.updated) ?? 0 };
  }
  if (job.status !== 'ready' || typeof job.csv !== 'string' || job.csv.length === 0) {
    throw new AppError('FAILED_PRECONDITION', '导入还没有通过检查');
  }
  const type = asString(job.type) ?? '';
  const table = readTable(type, job.csv);
  const credentials: Array<{ email: string; userId: string; tempPassword: string }> = [];
  let created = 0;
  let updated = 0;
  const batchSize = 20;
  for (let offset = 0; offset < table.records.length; offset += batchSize) {
    const batch = table.records.slice(offset, offset + batchSize);
    for (const record of batch) {
      const result = await applyRow(ctx, type, record);
      if (result.created) created += 1;
      else updated += 1;
      if (result.tempPassword && result.email && result.userId) {
        credentials.push({ email: result.email, userId: result.userId, tempPassword: result.tempPassword });
      }
    }
  }
  await ctx.repo.db.compareAndSet(COLLECTIONS.importJobs, jobId, undefined, {
    status: 'done',
    dryRun: false,
    ok: table.records.length,
    failed: 0,
    created,
    updated,
    finishedAt: ctx.now,
    csv: '',
    credentials,
    credentialsRead: false,
  });
  return { jobId, status: 'done', created, updated };
}

export async function importStatus(ctx: ImportContext, jobId: string) {
  const job = await ctx.repo.db.get(COLLECTIONS.importJobs, jobId);
  if (!job || job.schoolId !== ctx.schoolId || job.createdBy !== ctx.actorId) {
    throw new AppError('NOT_FOUND', '资源不存在');
  }
  const credentials = job.credentialsRead === true ? [] : Array.isArray(job.credentials) ? job.credentials : [];
  if (credentials.length > 0) {
    await ctx.repo.db.compareAndSet(COLLECTIONS.importJobs, jobId, undefined, { credentials: [], credentialsRead: true });
  }
  return {
    jobId,
    status: job.status,
    total: job.total,
    ok: job.ok,
    failed: job.failed,
    created: job.created ?? 0,
    updated: job.updated ?? 0,
    errors: job.errors ?? [],
    preview: job.preview ?? [],
    credentials,
  };
}

async function validateRow(ctx: ImportContext, type: string, record: Record<string, string>, row: number, seen: Set<string>): Promise<CsvError[]> {
  if (type === 'users') return validateUser(ctx, record, row, seen);
  if (type === 'guardianships') return validateGuardian(ctx, record, row, seen);
  if (type === 'courses') return validateCourse(ctx, record, row, seen);
  if (type === 'teaching') return validateTeaching(ctx, record, row, seen);
  if (type === 'enrollments') return validateEnrollment(ctx, record, row, seen);
  if (type === 'mentorships') return validateMentorship(ctx, record, row, seen);
  return [{ row, code: 'BAD_TYPE', message: '不支持的导入类型' }];
}

async function validateUser(ctx: ImportContext, record: Record<string, string>, row: number, seen: Set<string>): Promise<CsvError[]> {
  const errors: CsvError[] = [];
  const email = record.email?.toLowerCase() ?? '';
  if (!ROLES.has(record.role ?? '')) errors.push({ row, code: 'BAD_ROLE', message: '角色不正确' });
  if (!EMAIL.test(email)) errors.push({ row, code: 'BAD_EMAIL', message: '邮箱不正确' });
  if (email && seen.has(`user:${email}`)) errors.push({ row, code: 'DUPLICATE', message: '文件里邮箱重复' });
  if (email) seen.add(`user:${email}`);
  if (record.phone && !PHONE.test(record.phone)) errors.push({ row, code: 'BAD_PHONE', message: '手机号需为 E.164' });
  if (!record.display_name_zh) errors.push({ row, code: 'BAD_NAME', message: '缺少中文名' });
  if (record.role === 'student') {
    if (!record.student_no) errors.push({ row, code: 'BAD_STUDENT_NO', message: '缺少学号' });
    if (record.programme !== 'MYP' && record.programme !== 'DP') errors.push({ row, code: 'BAD_PROGRAMME', message: '课程应为 MYP 或 DP' });
    if (record.age_band !== 'under14' && record.age_band !== '14plus') errors.push({ row, code: 'BAD_AGE_BAND', message: '年龄段应为 under14 或 14plus' });
    if (!/^\d{4}$/.test(record.graduation_year ?? '')) errors.push({ row, code: 'BAD_YEAR', message: '毕业年不正确' });
    const grade = record.programme && record.grade_level ? await ctx.repo.findGrade(ctx.schoolId, record.programme, record.grade_level) : null;
    if (!grade) errors.push({ row, code: 'UNKNOWN_GRADE', message: '年级不存在' });
    const year = (await ctx.repo.listSchool(COLLECTIONS.academicYears, ctx.schoolId)).find((doc) => doc.isCurrent === true);
    const homeroom = year && record.homeroom_class ? await ctx.repo.findClassByName(ctx.schoolId, year._id, record.homeroom_class) : null;
    if (!homeroom) errors.push({ row, code: 'UNKNOWN_CLASS', message: '行政班不存在' });
  }
  return errors;
}

async function validateGuardian(ctx: ImportContext, record: Record<string, string>, row: number, seen: Set<string>): Promise<CsvError[]> {
  const errors: CsvError[] = [];
  const parentKey = (record.parent_email_or_phone ?? '').toLowerCase();
  if (!RELATIONS.has(record.relation ?? '')) errors.push({ row, code: 'BAD_RELATION', message: '亲属关系不正确' });
  if (record.is_primary !== 'true' && record.is_primary !== 'false') errors.push({ row, code: 'BAD_PRIMARY', message: 'is_primary 应为 true 或 false' });
  const parent = EMAIL.test(parentKey) ? await ctx.repo.findUserByEmail(ctx.schoolId, parentKey) : null;
  if (!parent) errors.push({ row, code: 'UNKNOWN_PARENT', message: '找不到家长账号' });
  const student = record.student_no ? await ctx.repo.findStudentByNo(ctx.schoolId, record.student_no) : null;
  if (!student) errors.push({ row, code: 'UNKNOWN_STUDENT', message: '找不到学生' });
  const key = `guard:${parentKey}:${record.student_no}`;
  if (seen.has(key)) errors.push({ row, code: 'DUPLICATE', message: '文件里亲子关系重复' });
  seen.add(key);
  return errors;
}

async function validateCourse(ctx: ImportContext, record: Record<string, string>, row: number, seen: Set<string>): Promise<CsvError[]> {
  const errors: CsvError[] = [];
  const year = record.year ? await ctx.repo.findYearByName(ctx.schoolId, record.year) : null;
  if (!year) errors.push({ row, code: 'UNKNOWN_YEAR', message: '学年不存在' });
  const subject = record.subject_code ? await ctx.repo.findSubjectByCode(ctx.schoolId, record.subject_code) : null;
  if (!subject) errors.push({ row, code: 'UNKNOWN_SUBJECT', message: '学科不存在' });
  if (!record.course_name_zh) errors.push({ row, code: 'BAD_NAME', message: '缺少教学班名称' });
  if (subject && record.grade_level) {
    const grade = await ctx.repo.findGrade(ctx.schoolId, asString(subject.programme) ?? '', record.grade_level);
    if (!grade) errors.push({ row, code: 'UNKNOWN_GRADE', message: '年级不存在' });
  }
  if (year && record.homeroom_class) {
    const homeroom = await ctx.repo.findClassByName(ctx.schoolId, year._id, record.homeroom_class);
    if (!homeroom) errors.push({ row, code: 'UNKNOWN_CLASS', message: '行政班不存在' });
  }
  const key = `course:${record.year}:${record.course_name_zh}`;
  if (seen.has(key)) errors.push({ row, code: 'DUPLICATE', message: '文件里教学班重复' });
  seen.add(key);
  return errors;
}

async function validateTeaching(ctx: ImportContext, record: Record<string, string>, row: number, seen: Set<string>): Promise<CsvError[]> {
  const errors: CsvError[] = [];
  const email = record.teacher_email?.toLowerCase() ?? '';
  const teacher = EMAIL.test(email) ? await ctx.repo.findUserByEmail(ctx.schoolId, email) : null;
  if (!teacher || !asStringArray(teacher.roles).includes('teacher')) errors.push({ row, code: 'UNKNOWN_TEACHER', message: '找不到老师' });
  const year = (await ctx.repo.listSchool(COLLECTIONS.academicYears, ctx.schoolId)).find((doc) => doc.isCurrent === true);
  const course = year && record.course_name_zh ? await ctx.repo.findCourseByName(ctx.schoolId, year._id, record.course_name_zh) : null;
  if (!course) errors.push({ row, code: 'UNKNOWN_COURSE', message: '找不到教学班' });
  if (!TEACHING_ROLES.has(record.role ?? '')) errors.push({ row, code: 'BAD_ROLE', message: '任教角色不正确' });
  const key = `teach:${email}:${record.course_name_zh}`;
  if (seen.has(key)) errors.push({ row, code: 'DUPLICATE', message: '文件里任教关系重复' });
  seen.add(key);
  return errors;
}

async function validateEnrollment(ctx: ImportContext, record: Record<string, string>, row: number, seen: Set<string>): Promise<CsvError[]> {
  const errors: CsvError[] = [];
  const student = record.student_no ? await ctx.repo.findStudentByNo(ctx.schoolId, record.student_no) : null;
  if (!student) errors.push({ row, code: 'UNKNOWN_STUDENT', message: '找不到学生' });
  const year = (await ctx.repo.listSchool(COLLECTIONS.academicYears, ctx.schoolId)).find((doc) => doc.isCurrent === true);
  const course = year && record.course_name_zh ? await ctx.repo.findCourseByName(ctx.schoolId, year._id, record.course_name_zh) : null;
  if (!course) errors.push({ row, code: 'UNKNOWN_COURSE', message: '找不到教学班' });
  const key = `enr:${record.student_no}:${record.course_name_zh}`;
  if (seen.has(key)) errors.push({ row, code: 'DUPLICATE', message: '文件里选课重复' });
  seen.add(key);
  return errors;
}

async function validateMentorship(ctx: ImportContext, record: Record<string, string>, row: number, seen: Set<string>): Promise<CsvError[]> {
  const errors: CsvError[] = [];
  const email = record.mentor_email?.toLowerCase() ?? '';
  const mentor = EMAIL.test(email) ? await ctx.repo.findUserByEmail(ctx.schoolId, email) : null;
  if (!mentor) errors.push({ row, code: 'UNKNOWN_MENTOR', message: '找不到导师' });
  const student = record.student_no ? await ctx.repo.findStudentByNo(ctx.schoolId, record.student_no) : null;
  if (!student) errors.push({ row, code: 'UNKNOWN_STUDENT', message: '找不到学生' });
  if (!MENTOR_TYPES.has(record.type ?? '')) errors.push({ row, code: 'BAD_TYPE', message: '指导类型不正确' });
  const key = `mentor:${email}:${record.student_no}:${record.type}`;
  if (seen.has(key)) errors.push({ row, code: 'DUPLICATE', message: '文件里指导关系重复' });
  seen.add(key);
  return errors;
}

async function applyRow(ctx: ImportContext, type: string, record: Record<string, string>): Promise<{ created: boolean; email?: string; userId?: string; tempPassword?: string }> {
  if (type === 'users') return applyUser(ctx, record);
  if (type === 'guardianships') return applyGuardian(ctx, record);
  if (type === 'courses') return applyCourse(ctx, record);
  if (type === 'teaching') return applyTeaching(ctx, record);
  if (type === 'enrollments') return applyEnrollment(ctx, record);
  return applyMentorship(ctx, record);
}

async function applyUser(ctx: ImportContext, record: Record<string, string>) {
  const email = record.email?.toLowerCase() ?? '';
  const existing = await ctx.repo.findUserByEmail(ctx.schoolId, email);
  const role = record.role as Role;
  if (!isRole(role)) throw new AppError('IMPORT_VALIDATION_FAILED', '导入文件有错误');
  if (existing) {
    const roles = new Set(asStringArray(existing.roles));
    roles.add(role);
    await ctx.repo.updateUser(existing._id, {
      roles: [...roles],
      displayName: { zh: record.display_name_zh ?? '', en: record.display_name_en || undefined },
      updatedAt: ctx.now,
      updatedBy: ctx.actorId,
    });
    if (role === 'student') await upsertStudentProfile(ctx, existing._id, record);
    return { created: false, email, userId: existing._id };
  }
  const userId = nid('u_');
  const tempPassword = randomTempPassword();
  const student = role === 'student';
  await ctx.repo.db.insert(COLLECTIONS.users, {
    _id: userId,
    schoolId: ctx.schoolId,
    roles: [role],
    displayName: { zh: record.display_name_zh ?? '', en: record.display_name_en || undefined },
    email,
    phone: record.phone || undefined,
    locale: 'zh',
    status: student ? 'pending_consent' : 'active',
    mustChangePassword: true,
    devLoginHash: hashDevPassword(tempPassword),
    createdAt: ctx.now,
    createdBy: ctx.actorId,
    updatedAt: ctx.now,
    updatedBy: ctx.actorId,
    schemaVersion: 1,
  });
  await ctx.repo.insertIdentity({
    _id: nid('idn_'),
    userId,
    provider: 'cloudbase_uid',
    appId: 'local',
    key: `uid_${userId}`,
    boundAt: ctx.now,
    schoolId: ctx.schoolId,
  });
  if (student) await upsertStudentProfile(ctx, userId, record);
  return { created: true, email, userId, tempPassword };
}

async function upsertStudentProfile(ctx: ImportContext, userId: string, record: Record<string, string>) {
  const existing = await ctx.repo.findStudentByUserId(userId);
  const year = (await ctx.repo.listSchool(COLLECTIONS.academicYears, ctx.schoolId)).find((doc) => doc.isCurrent === true);
  const grade = await ctx.repo.findGrade(ctx.schoolId, record.programme ?? '', record.grade_level ?? '');
  const homeroom = year ? await ctx.repo.findClassByName(ctx.schoolId, year._id, record.homeroom_class ?? '') : null;
  const patch = {
    studentNo: record.student_no,
    programme: record.programme,
    gradeId: grade?._id,
    homeroomClassId: homeroom?._id,
    ageBand: record.age_band,
    graduationYear: Number(record.graduation_year),
    updatedAt: ctx.now,
    updatedBy: ctx.actorId,
  };
  if (existing) {
    await ctx.repo.db.compareAndSet(COLLECTIONS.studentProfiles, existing._id, undefined, patch);
    return;
  }
  await ctx.repo.db.insert(COLLECTIONS.studentProfiles, {
    _id: nid('stu_'),
    schoolId: ctx.schoolId,
    userId,
    consentStatus: 'required',
    createdAt: ctx.now,
    createdBy: ctx.actorId,
    schemaVersion: 1,
    ...patch,
  });
}

async function applyGuardian(ctx: ImportContext, record: Record<string, string>) {
  const parent = await ctx.repo.findUserByEmail(ctx.schoolId, (record.parent_email_or_phone ?? '').toLowerCase());
  const student = await ctx.repo.findStudentByNo(ctx.schoolId, record.student_no ?? '');
  if (!parent || !student) throw new AppError('FAILED_PRECONDITION', '导入对象已变化');
  const links = await ctx.repo.db.query(
    COLLECTIONS.guardianships,
    (doc) => doc.parentId === parent._id && doc.studentId === student._id && doc.schoolId === ctx.schoolId,
  );
  if (links[0]) {
    await ctx.repo.db.compareAndSet(COLLECTIONS.guardianships, links[0]._id, undefined, {
      status: 'active',
      relation: record.relation,
      isPrimary: record.is_primary === 'true',
      receivesEmail: true,
      updatedAt: ctx.now,
    });
    return { created: false };
  }
  await ctx.repo.insertGuardianship({
    _id: nid('grd_'),
    schoolId: ctx.schoolId,
    parentId: parent._id,
    studentId: student._id,
    relation: record.relation,
    status: 'active',
    source: 'import',
    isPrimary: record.is_primary === 'true',
    receivesEmail: true,
    createdAt: ctx.now,
    createdBy: ctx.actorId,
    updatedAt: ctx.now,
    updatedBy: ctx.actorId,
    schemaVersion: 1,
  });
  return { created: true };
}

async function applyCourse(ctx: ImportContext, record: Record<string, string>) {
  const year = await ctx.repo.findYearByName(ctx.schoolId, record.year ?? '');
  const subject = await ctx.repo.findSubjectByCode(ctx.schoolId, record.subject_code ?? '');
  if (!year || !subject) throw new AppError('FAILED_PRECONDITION', '导入对象已变化');
  const existing = await ctx.repo.findCourseByName(ctx.schoolId, year._id, record.course_name_zh ?? '');
  const grade = await ctx.repo.findGrade(ctx.schoolId, asString(subject.programme) ?? '', record.grade_level ?? '');
  const homeroom = record.homeroom_class ? await ctx.repo.findClassByName(ctx.schoolId, year._id, record.homeroom_class) : null;
  if (existing) {
    await ctx.repo.db.compareAndSet(COLLECTIONS.courses, existing._id, undefined, {
      name: { zh: record.course_name_zh, en: record.course_name_en || undefined },
      gradeId: grade?._id,
      homeroomClassId: homeroom?._id,
      updatedAt: ctx.now,
    });
    return { created: false };
  }
  await ctx.repo.db.insert(COLLECTIONS.courses, {
    _id: nid('crs_'),
    schoolId: ctx.schoolId,
    yearId: year._id,
    subjectId: subject._id,
    programme: subject.programme,
    gradeId: grade?._id,
    name: { zh: record.course_name_zh, en: record.course_name_en || undefined },
    homeroomClassId: homeroom?._id,
    createdAt: ctx.now,
    createdBy: ctx.actorId,
    updatedAt: ctx.now,
    updatedBy: ctx.actorId,
    schemaVersion: 1,
  });
  return { created: true };
}

async function applyTeaching(ctx: ImportContext, record: Record<string, string>) {
  const teacher = await ctx.repo.findUserByEmail(ctx.schoolId, (record.teacher_email ?? '').toLowerCase());
  const year = (await ctx.repo.listSchool(COLLECTIONS.academicYears, ctx.schoolId)).find((doc) => doc.isCurrent === true);
  const course = year ? await ctx.repo.findCourseByName(ctx.schoolId, year._id, record.course_name_zh ?? '') : null;
  if (!teacher || !course || !year) throw new AppError('FAILED_PRECONDITION', '导入对象已变化');
  const existing = await ctx.repo.db.query(
    COLLECTIONS.teachingAssignments,
    (doc) => doc.teacherId === teacher._id && doc.courseId === course._id && doc.schoolId === ctx.schoolId,
  );
  if (existing[0]) {
    await ctx.repo.db.compareAndSet(COLLECTIONS.teachingAssignments, existing[0]._id, undefined, {
      role: record.role,
      endAt: undefined,
      updatedAt: ctx.now,
    });
    return { created: false };
  }
  await ctx.repo.db.insert(COLLECTIONS.teachingAssignments, {
    _id: nid('tch_'),
    schoolId: ctx.schoolId,
    yearId: year._id,
    teacherId: teacher._id,
    courseId: course._id,
    role: record.role,
    startAt: ctx.now,
    createdAt: ctx.now,
    createdBy: ctx.actorId,
    schemaVersion: 1,
  });
  return { created: true };
}

async function applyEnrollment(ctx: ImportContext, record: Record<string, string>) {
  const student = await ctx.repo.findStudentByNo(ctx.schoolId, record.student_no ?? '');
  const year = (await ctx.repo.listSchool(COLLECTIONS.academicYears, ctx.schoolId)).find((doc) => doc.isCurrent === true);
  const course = year ? await ctx.repo.findCourseByName(ctx.schoolId, year._id, record.course_name_zh ?? '') : null;
  if (!student || !course || !year) throw new AppError('FAILED_PRECONDITION', '导入对象已变化');
  const existing = await ctx.repo.db.query(
    COLLECTIONS.enrollments,
    (doc) => doc.studentId === student._id && doc.courseId === course._id,
  );
  if (existing[0]) {
    await ctx.repo.db.compareAndSet(COLLECTIONS.enrollments, existing[0]._id, undefined, { status: 'active', updatedAt: ctx.now });
    return { created: false };
  }
  await ctx.repo.db.insert(COLLECTIONS.enrollments, {
    _id: nid('enr_'),
    schoolId: ctx.schoolId,
    yearId: year._id,
    studentId: student._id,
    courseId: course._id,
    status: 'active',
    joinedAt: ctx.now,
    createdAt: ctx.now,
    createdBy: ctx.actorId,
    schemaVersion: 1,
  });
  return { created: true };
}

async function applyMentorship(ctx: ImportContext, record: Record<string, string>) {
  const mentor = await ctx.repo.findUserByEmail(ctx.schoolId, (record.mentor_email ?? '').toLowerCase());
  const student = await ctx.repo.findStudentByNo(ctx.schoolId, record.student_no ?? '');
  const year = (await ctx.repo.listSchool(COLLECTIONS.academicYears, ctx.schoolId)).find((doc) => doc.isCurrent === true);
  if (!mentor || !student || !year) throw new AppError('FAILED_PRECONDITION', '导入对象已变化');
  const existing = await ctx.repo.db.query(
    COLLECTIONS.mentorships,
    (doc) => doc.mentorId === mentor._id && doc.studentId === student._id && doc.type === record.type,
  );
  if (existing[0]) {
    await ctx.repo.db.compareAndSet(COLLECTIONS.mentorships, existing[0]._id, undefined, { status: 'active', updatedAt: ctx.now });
    return { created: false };
  }
  await ctx.repo.db.insert(COLLECTIONS.mentorships, {
    _id: nid('men_'),
    schoolId: ctx.schoolId,
    yearId: year._id,
    mentorId: mentor._id,
    studentId: student._id,
    type: record.type,
    status: 'active',
    createdAt: ctx.now,
    createdBy: ctx.actorId,
    schemaVersion: 1,
  });
  return { created: true };
}

function sanitizePreview(record: Record<string, string>): Record<string, string> {
  const copy = { ...record };
  if (copy.phone) copy.phone = `${copy.phone.slice(0, 3)}…`;
  return copy;
}
