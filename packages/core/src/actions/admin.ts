import { FUNCTIONS } from '@hst/shared';
import { z } from 'zod';
import { ensureSchoolDefaults } from '../admin/defaults.js';
import { importStatus, runImport, validateImport } from '../admin/import-job.js';
import { AppError } from '../app-error.js';
import { displayNameOf } from '../auth/access.js';
import { registerAction } from '../auth/registry.js';
import { COLLECTIONS } from '@hst/shared';
import { asString, asStringArray, hashInviteCode, nid, randomSecret } from '../util.js';

const id = z.string().min(1).max(80);
const i18n = z.object({ zh: z.string().min(1).max(80), en: z.string().max(80).optional() });
const adminOnly = ['admin'] as const;

registerAction({
  name: 'admin.structure.list',
  fn: FUNCTIONS.apiAdmin,
  roles: adminOnly,
  input: z.object({}).strip(),
  scope: async () => true,
  async handler(ctx) {
    const schoolId = ctx.caller.schoolId;
    const [years, terms, grades, classes, subjects, courses] = await Promise.all([
      ctx.repo.listSchool(COLLECTIONS.academicYears, schoolId),
      ctx.repo.listSchool(COLLECTIONS.terms, schoolId),
      ctx.repo.listSchool(COLLECTIONS.grades, schoolId),
      ctx.repo.listSchool(COLLECTIONS.classes, schoolId),
      ctx.repo.listSchool(COLLECTIONS.subjects, schoolId),
      ctx.repo.listSchool(COLLECTIONS.courses, schoolId),
    ]);
    return {
      years: years.map((doc) => ({ id: doc._id, name: doc.name, isCurrent: doc.isCurrent === true, status: doc.status })),
      terms: terms.map((doc) => ({ id: doc._id, yearId: doc.yearId, index: doc.index, name: doc.name })),
      grades: grades.map((doc) => ({ id: doc._id, programme: doc.programme, level: doc.level, name: doc.name })),
      classes: classes.map((doc) => ({ id: doc._id, yearId: doc.yearId, programme: doc.programme, name: doc.name, gradeId: doc.gradeId })),
      subjects: subjects.map((doc) => ({ id: doc._id, programme: doc.programme, groupCode: doc.groupCode, code: doc.code, name: doc.name })),
      courses: courses.map((doc) => ({ id: doc._id, yearId: doc.yearId, subjectId: doc.subjectId, programme: doc.programme, name: doc.name, homeroomClassId: doc.homeroomClassId })),
    };
  },
});

registerAction({
  name: 'admin.subject.ensureDefaults',
  fn: FUNCTIONS.apiAdmin,
  roles: adminOnly,
  input: z.object({}).strip(),
  scope: async () => true,
  async handler(ctx) {
    return ensureSchoolDefaults(ctx.repo, ctx.caller.schoolId, ctx.caller.userId, ctx.clock.now());
  },
});

registerAction({
  name: 'admin.year.upsert',
  fn: FUNCTIONS.apiAdmin,
  roles: adminOnly,
  input: z.object({ name: z.string().min(4).max(20), startDate: z.number(), endDate: z.number(), isCurrent: z.boolean().optional() }).strip(),
  scope: async () => true,
  async handler(ctx, input) {
    const existing = await ctx.repo.findYearByName(ctx.caller.schoolId, input.name);
    if (existing) throw new AppError('ALREADY_EXISTS', '记录已存在');
    if (input.endDate <= input.startDate) throw new AppError('INVALID_ARGUMENT', '参数不正确');
    const yearId = nid('year_');
    if (input.isCurrent) {
      const years = await ctx.repo.listSchool(COLLECTIONS.academicYears, ctx.caller.schoolId);
      for (const year of years) {
        if (year.isCurrent === true) await ctx.repo.db.compareAndSet(COLLECTIONS.academicYears, year._id, undefined, { isCurrent: false });
      }
    }
    await ctx.repo.db.insert(COLLECTIONS.academicYears, {
      _id: yearId,
      schoolId: ctx.caller.schoolId,
      name: input.name,
      startDate: input.startDate,
      endDate: input.endDate,
      isCurrent: input.isCurrent === true,
      status: 'active',
      createdAt: ctx.clock.now(),
      createdBy: ctx.caller.userId,
      updatedAt: ctx.clock.now(),
      updatedBy: ctx.caller.userId,
      schemaVersion: 1,
    });
    return { id: yearId };
  },
});

registerAction({
  name: 'admin.term.upsert',
  fn: FUNCTIONS.apiAdmin,
  roles: adminOnly,
  input: z.object({ yearId: id, index: z.union([z.literal(1), z.literal(2)]), name: i18n, startDate: z.number(), endDate: z.number() }).strip(),
  scope: async (ctx, input) => Boolean(await ctx.repo.db.get(COLLECTIONS.academicYears, input.yearId)),
  async handler(ctx, input) {
    const year = await ctx.repo.db.get(COLLECTIONS.academicYears, input.yearId);
    if (!year || year.schoolId !== ctx.caller.schoolId) throw new AppError('NOT_FOUND', '资源不存在');
    const terms = await ctx.repo.listSchool(COLLECTIONS.terms, ctx.caller.schoolId);
    if (terms.some((doc) => doc.yearId === input.yearId && doc.index === input.index)) throw new AppError('ALREADY_EXISTS', '记录已存在');
    const termId = nid('term_');
    await ctx.repo.db.insert(COLLECTIONS.terms, {
      _id: termId,
      schoolId: ctx.caller.schoolId,
      yearId: input.yearId,
      index: input.index,
      name: input.name,
      startDate: input.startDate,
      endDate: input.endDate,
      createdAt: ctx.clock.now(),
      createdBy: ctx.caller.userId,
      schemaVersion: 1,
    });
    return { id: termId };
  },
});

registerAction({
  name: 'admin.grade.upsert',
  fn: FUNCTIONS.apiAdmin,
  roles: adminOnly,
  input: z.object({ programme: z.enum(['MYP', 'DP']), level: z.string().min(2).max(12), name: i18n }).strip(),
  scope: async () => true,
  async handler(ctx, input) {
    if (await ctx.repo.findGrade(ctx.caller.schoolId, input.programme, input.level)) throw new AppError('ALREADY_EXISTS', '记录已存在');
    const gradeId = nid('grd_');
    await ctx.repo.db.insert(COLLECTIONS.grades, {
      _id: gradeId,
      schoolId: ctx.caller.schoolId,
      programme: input.programme,
      level: input.level,
      name: input.name,
      createdAt: ctx.clock.now(),
      createdBy: ctx.caller.userId,
      schemaVersion: 1,
    });
    return { id: gradeId };
  },
});

registerAction({
  name: 'admin.class.upsert',
  fn: FUNCTIONS.apiAdmin,
  roles: adminOnly,
  input: z.object({
    yearId: id,
    gradeId: id.optional(),
    programme: z.enum(['MYP', 'DP']),
    name: i18n,
    homeroomTeacherIds: z.array(id).max(5).optional(),
  }).strip(),
  scope: async (ctx, input) => {
    const year = await ctx.repo.db.get(COLLECTIONS.academicYears, input.yearId);
    return Boolean(year && year.schoolId === ctx.caller.schoolId);
  },
  async handler(ctx, input) {
    if (await ctx.repo.findClassByName(ctx.caller.schoolId, input.yearId, input.name.zh)) throw new AppError('ALREADY_EXISTS', '记录已存在');
    const classId = nid('cls_');
    await ctx.repo.db.insert(COLLECTIONS.classes, {
      _id: classId,
      schoolId: ctx.caller.schoolId,
      yearId: input.yearId,
      gradeId: input.gradeId,
      programme: input.programme,
      name: input.name,
      homeroomTeacherIds: input.homeroomTeacherIds ?? [],
      createdAt: ctx.clock.now(),
      createdBy: ctx.caller.userId,
      schemaVersion: 1,
    });
    return { id: classId };
  },
});

registerAction({
  name: 'admin.subject.upsert',
  fn: FUNCTIONS.apiAdmin,
  roles: adminOnly,
  input: z.object({ programme: z.enum(['MYP', 'DP']), groupCode: z.string().min(1).max(12), code: z.string().min(1).max(20), name: i18n }).strip(),
  scope: async () => true,
  async handler(ctx, input) {
    if (await ctx.repo.findSubjectByCode(ctx.caller.schoolId, input.code)) throw new AppError('ALREADY_EXISTS', '记录已存在');
    const subjectId = nid('sub_');
    await ctx.repo.db.insert(COLLECTIONS.subjects, {
      _id: subjectId,
      schoolId: ctx.caller.schoolId,
      programme: input.programme,
      groupCode: input.groupCode,
      code: input.code,
      name: input.name,
      createdAt: ctx.clock.now(),
      createdBy: ctx.caller.userId,
      schemaVersion: 1,
    });
    return { id: subjectId };
  },
});

registerAction({
  name: 'admin.course.upsert',
  fn: FUNCTIONS.apiAdmin,
  roles: adminOnly,
  input: z.object({ yearId: id, subjectId: id, name: i18n, gradeId: id.optional(), homeroomClassId: id.optional() }).strip(),
  scope: async (ctx, input) => {
    const year = await ctx.repo.db.get(COLLECTIONS.academicYears, input.yearId);
    const subject = await ctx.repo.db.get(COLLECTIONS.subjects, input.subjectId);
    return Boolean(year && subject && year.schoolId === ctx.caller.schoolId && subject.schoolId === ctx.caller.schoolId);
  },
  async handler(ctx, input) {
    if (await ctx.repo.findCourseByName(ctx.caller.schoolId, input.yearId, input.name.zh)) throw new AppError('ALREADY_EXISTS', '记录已存在');
    const subject = await ctx.repo.db.get(COLLECTIONS.subjects, input.subjectId);
    const courseId = nid('crs_');
    await ctx.repo.db.insert(COLLECTIONS.courses, {
      _id: courseId,
      schoolId: ctx.caller.schoolId,
      yearId: input.yearId,
      subjectId: input.subjectId,
      programme: subject?.programme,
      gradeId: input.gradeId,
      homeroomClassId: input.homeroomClassId,
      name: input.name,
      createdAt: ctx.clock.now(),
      createdBy: ctx.caller.userId,
      schemaVersion: 1,
    });
    return { id: courseId };
  },
});

const relationInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('guardianship'), parentId: id, studentId: id, relation: z.enum(['mother', 'father', 'guardian', 'other']), isPrimary: z.boolean().optional() }),
  z.object({ kind: z.literal('teaching'), teacherId: id, courseId: id, role: z.enum(['lead', 'co', 'assistant']) }),
  z.object({ kind: z.literal('enrollment'), studentId: id, courseId: id }),
  z.object({ kind: z.literal('mentorship'), mentorId: id, studentId: id, type: z.enum(['EE_SUPERVISOR', 'PP_SUPERVISOR', 'CP_SUPERVISOR', 'CAS_ADVISOR', 'IA_TEACHER']) }),
]);

registerAction({
  name: 'admin.relation.upsert',
  fn: FUNCTIONS.apiAdmin,
  roles: adminOnly,
  input: relationInput,
  audit: 'relation.change',
  scope: async () => true,
  async handler(ctx, input) {
    const now = ctx.clock.now();
    if (input.kind === 'guardianship') {
      const student = await ctx.repo.getStudent(input.studentId);
      const parent = await ctx.repo.getUser(input.parentId);
      if (!student || !parent || student.schoolId !== ctx.caller.schoolId || parent.schoolId !== ctx.caller.schoolId) {
        throw new AppError('NOT_FOUND', '资源不存在');
      }
      const links = await ctx.repo.db.query(COLLECTIONS.guardianships, (doc) => doc.parentId === input.parentId && doc.studentId === input.studentId);
      if (links[0]) {
        await ctx.repo.db.compareAndSet(COLLECTIONS.guardianships, links[0]._id, undefined, { status: 'active', relation: input.relation, isPrimary: input.isPrimary === true });
        return { id: links[0]._id, studentId: input.studentId };
      }
      const guardianshipId = nid('grd_');
      await ctx.repo.insertGuardianship({
        _id: guardianshipId,
        schoolId: ctx.caller.schoolId,
        parentId: input.parentId,
        studentId: input.studentId,
        relation: input.relation,
        status: 'active',
        source: 'import',
        isPrimary: input.isPrimary === true,
        receivesEmail: true,
        createdAt: now,
        createdBy: ctx.caller.userId,
        schemaVersion: 1,
      });
      return { id: guardianshipId, studentId: input.studentId };
    }
    if (input.kind === 'teaching') {
      const course = await ctx.repo.getCourse(input.courseId);
      const teacher = await ctx.repo.getUser(input.teacherId);
      if (!course || !teacher || course.schoolId !== ctx.caller.schoolId || teacher.schoolId !== ctx.caller.schoolId) throw new AppError('NOT_FOUND', '资源不存在');
      const rows = await ctx.repo.db.query(COLLECTIONS.teachingAssignments, (doc) => doc.teacherId === input.teacherId && doc.courseId === input.courseId);
      if (rows[0]) {
        await ctx.repo.db.compareAndSet(COLLECTIONS.teachingAssignments, rows[0]._id, undefined, { role: input.role, endAt: undefined });
        return { id: rows[0]._id };
      }
      const teachingId = nid('tch_');
      await ctx.repo.db.insert(COLLECTIONS.teachingAssignments, {
        _id: teachingId,
        schoolId: ctx.caller.schoolId,
        yearId: course.yearId,
        teacherId: input.teacherId,
        courseId: input.courseId,
        role: input.role,
        startAt: now,
        createdAt: now,
        createdBy: ctx.caller.userId,
        schemaVersion: 1,
      });
      return { id: teachingId };
    }
    if (input.kind === 'enrollment') {
      const course = await ctx.repo.getCourse(input.courseId);
      const student = await ctx.repo.getStudent(input.studentId);
      if (!course || !student || course.schoolId !== ctx.caller.schoolId || student.schoolId !== ctx.caller.schoolId) throw new AppError('NOT_FOUND', '资源不存在');
      const rows = await ctx.repo.db.query(COLLECTIONS.enrollments, (doc) => doc.studentId === input.studentId && doc.courseId === input.courseId);
      if (rows[0]) {
        await ctx.repo.db.compareAndSet(COLLECTIONS.enrollments, rows[0]._id, undefined, { status: 'active' });
        return { id: rows[0]._id, studentId: input.studentId };
      }
      const enrollmentId = nid('enr_');
      await ctx.repo.db.insert(COLLECTIONS.enrollments, {
        _id: enrollmentId,
        schoolId: ctx.caller.schoolId,
        yearId: course.yearId,
        studentId: input.studentId,
        courseId: input.courseId,
        status: 'active',
        joinedAt: now,
        createdAt: now,
        createdBy: ctx.caller.userId,
        schemaVersion: 1,
      });
      return { id: enrollmentId, studentId: input.studentId };
    }
    const student = await ctx.repo.getStudent(input.studentId);
    const mentor = await ctx.repo.getUser(input.mentorId);
    if (!student || !mentor || student.schoolId !== ctx.caller.schoolId || mentor.schoolId !== ctx.caller.schoolId) throw new AppError('NOT_FOUND', '资源不存在');
    const rows = await ctx.repo.db.query(COLLECTIONS.mentorships, (doc) => doc.mentorId === input.mentorId && doc.studentId === input.studentId && doc.type === input.type);
    if (rows[0]) {
      await ctx.repo.db.compareAndSet(COLLECTIONS.mentorships, rows[0]._id, undefined, { status: 'active' });
      return { id: rows[0]._id, studentId: input.studentId };
    }
    const mentorshipId = nid('men_');
    const year = await ctx.repo.currentYear(ctx.caller.schoolId);
    await ctx.repo.db.insert(COLLECTIONS.mentorships, {
      _id: mentorshipId,
      schoolId: ctx.caller.schoolId,
      yearId: year?._id,
      mentorId: input.mentorId,
      studentId: input.studentId,
      type: input.type,
      status: 'active',
      createdAt: now,
      createdBy: ctx.caller.userId,
      schemaVersion: 1,
    });
    return { id: mentorshipId, studentId: input.studentId };
  },
});

registerAction({
  name: 'admin.relation.revoke',
  fn: FUNCTIONS.apiAdmin,
  roles: adminOnly,
  input: relationInput,
  audit: 'relation.change',
  scope: async () => true,
  async handler(ctx, input) {
    const now = ctx.clock.now();
    if (input.kind === 'guardianship') {
      const rows = await ctx.repo.db.query(COLLECTIONS.guardianships, (doc) => doc.schoolId === ctx.caller.schoolId && doc.parentId === input.parentId && doc.studentId === input.studentId && doc.status === 'active');
      if (!rows[0]) throw new AppError('NOT_FOUND', '资源不存在');
      await ctx.repo.db.compareAndSet(COLLECTIONS.guardianships, rows[0]._id, undefined, { status: 'revoked', revokedAt: now, revokedBy: ctx.caller.userId });
      return { id: rows[0]._id, studentId: input.studentId };
    }
    if (input.kind === 'teaching') {
      const rows = await ctx.repo.db.query(COLLECTIONS.teachingAssignments, (doc) => doc.schoolId === ctx.caller.schoolId && doc.teacherId === input.teacherId && doc.courseId === input.courseId && doc.endAt == null);
      if (!rows[0]) throw new AppError('NOT_FOUND', '资源不存在');
      await ctx.repo.db.compareAndSet(COLLECTIONS.teachingAssignments, rows[0]._id, undefined, { endAt: now });
      return { id: rows[0]._id };
    }
    if (input.kind === 'enrollment') {
      const rows = await ctx.repo.db.query(COLLECTIONS.enrollments, (doc) => doc.schoolId === ctx.caller.schoolId && doc.studentId === input.studentId && doc.courseId === input.courseId && doc.status === 'active');
      if (!rows[0]) throw new AppError('NOT_FOUND', '资源不存在');
      await ctx.repo.db.compareAndSet(COLLECTIONS.enrollments, rows[0]._id, undefined, { status: 'dropped', leftAt: now });
      return { id: rows[0]._id, studentId: input.studentId };
    }
    const rows = await ctx.repo.db.query(COLLECTIONS.mentorships, (doc) => doc.schoolId === ctx.caller.schoolId && doc.mentorId === input.mentorId && doc.studentId === input.studentId && doc.type === input.type && doc.status === 'active');
    if (!rows[0]) throw new AppError('NOT_FOUND', '资源不存在');
    await ctx.repo.db.compareAndSet(COLLECTIONS.mentorships, rows[0]._id, undefined, { status: 'ended' });
    return { id: rows[0]._id, studentId: input.studentId };
  },
});

registerAction({
  name: 'admin.invite.create',
  fn: FUNCTIONS.apiAdmin,
  roles: adminOnly,
  input: z.object({ studentId: id, relation: z.enum(['mother', 'father', 'guardian', 'other']).optional(), expiresInDays: z.number().int().min(1).max(30).optional() }).strip(),
  audit: 'invite.create',
  scope: async (ctx, input) => {
    const student = await ctx.repo.getStudent(input.studentId);
    return Boolean(student && student.schoolId === ctx.caller.schoolId);
  },
  async handler(ctx, input) {
    if (!ctx.config.invitePepper) throw new AppError('FAILED_PRECONDITION', '邀请码密钥未配置');
    const code = randomSecret(8);
    const now = ctx.clock.now();
    const expiresAt = now + (input.expiresInDays ?? 7) * 24 * 60 * 60 * 1000;
    const inviteId = nid('inv_');
    await ctx.repo.insertInvite({
      _id: inviteId,
      schoolId: ctx.caller.schoolId,
      type: 'guardian_bind',
      codeHash: hashInviteCode(code, ctx.config.invitePepper),
      studentId: input.studentId,
      relation: input.relation,
      createdBy: ctx.caller.userId,
      expiresAt,
      maxUses: 1,
      usedCount: 0,
      status: 'active',
      version: 1,
      createdAt: now,
    });
    return { inviteId, code, expiresAt, studentId: input.studentId };
  },
});

registerAction({
  name: 'admin.invite.revoke',
  fn: FUNCTIONS.apiAdmin,
  roles: adminOnly,
  input: z.object({ inviteId: id }).strip(),
  audit: 'invite.revoke',
  scope: async (ctx, input) => {
    const invite = await ctx.repo.db.get(COLLECTIONS.inviteCodes, input.inviteId);
    return Boolean(invite && invite.schoolId === ctx.caller.schoolId);
  },
  async handler(ctx, input) {
    await ctx.repo.db.compareAndSet(COLLECTIONS.inviteCodes, input.inviteId, undefined, { status: 'revoked' });
    return { inviteId: input.inviteId };
  },
});

registerAction({
  name: 'admin.invite.list',
  fn: FUNCTIONS.apiAdmin,
  roles: adminOnly,
  input: z.object({ studentId: id.optional() }).strip(),
  scope: async (ctx, input) => {
    if (!input.studentId) return true;
    const student = await ctx.repo.getStudent(input.studentId);
    return Boolean(student && student.schoolId === ctx.caller.schoolId);
  },
  async handler(ctx, input) {
    const rows = await ctx.repo.listSchool(COLLECTIONS.inviteCodes, ctx.caller.schoolId);
    return {
      items: rows
        .filter((doc) => doc.type === 'guardian_bind' && (!input.studentId || doc.studentId === input.studentId))
        .map((doc) => ({
          inviteId: doc._id,
          studentId: doc.studentId,
          status: doc.status,
          expiresAt: doc.expiresAt,
          usedCount: doc.usedCount ?? 0,
        })),
    };
  },
});

registerAction({
  name: 'admin.import.validate',
  fn: FUNCTIONS.apiAdmin,
  roles: adminOnly,
  input: z.object({
    type: z.enum(['users', 'guardianships', 'courses', 'teaching', 'enrollments', 'mentorships']),
    csv: z.string().min(1).max(500_000),
  }).strip(),
  scope: async () => true,
  async handler(ctx, input) {
    return validateImport(
      { repo: ctx.repo, schoolId: ctx.caller.schoolId, actorId: ctx.caller.userId, now: ctx.clock.now() },
      input.type,
      input.csv,
    );
  },
});

registerAction({
  name: 'admin.import.run',
  fn: FUNCTIONS.apiAdmin,
  roles: adminOnly,
  input: z.object({ jobId: id }).strip(),
  audit: 'import.run',
  idempotent: true,
  scope: async (ctx, input) => {
    const job = await ctx.repo.db.get(COLLECTIONS.importJobs, input.jobId);
    return Boolean(job && job.schoolId === ctx.caller.schoolId && job.createdBy === ctx.caller.userId);
  },
  async handler(ctx, input) {
    return runImport({ repo: ctx.repo, schoolId: ctx.caller.schoolId, actorId: ctx.caller.userId, now: ctx.clock.now() }, input.jobId);
  },
});

registerAction({
  name: 'admin.import.status',
  fn: FUNCTIONS.apiAdmin,
  roles: adminOnly,
  input: z.object({ jobId: id }).strip(),
  scope: async (ctx, input) => {
    const job = await ctx.repo.db.get(COLLECTIONS.importJobs, input.jobId);
    return Boolean(job && job.schoolId === ctx.caller.schoolId && job.createdBy === ctx.caller.userId);
  },
  async handler(ctx, input) {
    return importStatus({ repo: ctx.repo, schoolId: ctx.caller.schoolId, actorId: ctx.caller.userId, now: ctx.clock.now() }, input.jobId);
  },
});

registerAction({
  name: 'admin.user.list',
  fn: FUNCTIONS.apiAdmin,
  roles: adminOnly,
  input: z.object({ role: z.string().max(40).optional(), query: z.string().max(80).optional() }).strip(),
  scope: async () => true,
  async handler(ctx, input) {
    const users = await ctx.repo.listSchool(COLLECTIONS.users, ctx.caller.schoolId);
    const query = input.query?.toLowerCase();
    return {
      items: users
        .filter((doc) => !input.role || asStringArray(doc.roles).includes(input.role))
        .filter((doc) => {
          if (!query) return true;
          const email = asString(doc.email)?.toLowerCase() ?? '';
          const name = displayNameOf(doc).zh.toLowerCase();
          return email.includes(query) || name.includes(query);
        })
        .map((doc) => ({
          id: doc._id,
          displayName: displayNameOf(doc),
          roles: doc.roles,
          email: doc.email,
          status: doc.status,
          locale: doc.locale,
        })),
    };
  },
});

registerAction({
  name: 'admin.consent.report',
  fn: FUNCTIONS.apiAdmin,
  roles: adminOnly,
  input: z.object({ classId: id.optional() }).strip(),
  scope: async (ctx, input) => {
    if (!input.classId) return true;
    const homeroom = await ctx.repo.getClass(input.classId);
    return Boolean(homeroom && homeroom.schoolId === ctx.caller.schoolId);
  },
  async handler(ctx, input) {
    let students = await ctx.repo.listSchool(COLLECTIONS.studentProfiles, ctx.caller.schoolId);
    if (input.classId) students = students.filter((doc) => doc.homeroomClassId === input.classId);
    const items = [];
    for (const student of students) {
      const user = await ctx.repo.getUser(asString(student.userId) ?? '');
      const consents = await ctx.repo.listConsentsForStudent(student._id);
      const granted = consents.find((doc) => doc.revokedAt == null);
      items.push({
        studentId: student._id,
        displayName: displayNameOf(user),
        status: student.consentStatus,
        grantedVersion: granted?.policyVersion,
      });
    }
    return { items };
  },
});

registerAction({
  name: 'admin.audit.query',
  fn: FUNCTIONS.apiAdmin,
  roles: adminOnly,
  input: z.object({
    actorUserId: id.optional(),
    studentId: id.optional(),
    action: z.string().max(80).optional(),
    from: z.number().optional(),
    to: z.number().optional(),
  }).strip(),
  scope: async (ctx, input) => {
    if (input.studentId) {
      const student = await ctx.repo.getStudent(input.studentId);
      if (!student || student.schoolId !== ctx.caller.schoolId) return false;
    }
    if (input.actorUserId) {
      const actor = await ctx.repo.getUser(input.actorUserId);
      if (!actor || actor.schoolId !== ctx.caller.schoolId) return false;
    }
    return true;
  },
  async handler(ctx, input) {
    const rows = await ctx.repo.queryAudit({
      actorUserId: input.actorUserId,
      studentId: input.studentId,
      action: input.action,
      from: input.from,
      to: input.to,
    });
    return {
      items: rows.slice(0, 100).map((doc) => ({
        at: doc.at,
        actorUserId: doc.actorUserId,
        action: doc.action,
        targetType: doc.targetType,
        targetId: doc.targetId,
        studentId: doc.studentId,
        result: doc.result,
      })),
    };
  },
});
