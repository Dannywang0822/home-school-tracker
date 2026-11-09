import { FUNCTIONS } from '@hst/shared';
import { z } from 'zod';
import { canReadCas, canReadPlan, displayNameOf } from '../auth/access.js';
import { registerAction } from '../auth/registry.js';
import { asString, asStringArray } from '../util.js';

const idSchema = z.string().min(1).max(80);

registerAction({
  name: 'cas.list',
  fn: FUNCTIONS.apiIb,
  roles: ['student', 'parent', 'cas_coordinator', 'supervisor'],
  input: z.object({ studentId: idSchema, status: z.string().max(40).optional() }).strip(),
  scope: async (ctx, input) => canReadCas(ctx, input.studentId),
  async handler(ctx, input) {
    let rows = await ctx.repo.listExperiences(input.studentId, ctx.caller.schoolId);
    if (input.status) rows = rows.filter((doc) => doc.status === input.status);
    return {
      items: rows.map((doc) => ({
        experienceId: doc._id,
        studentId: doc.studentId,
        title: doc.title,
        description: doc.description,
        strands: doc.strands,
        status: doc.status,
      })),
    };
  },
});

registerAction({
  name: 'cas.get',
  fn: FUNCTIONS.apiIb,
  roles: ['student', 'parent', 'cas_coordinator', 'supervisor'],
  input: z.object({ experienceId: idSchema }).strip(),
  scope: async (ctx, input) => {
    const experience = await ctx.repo.getExperience(input.experienceId);
    const studentId = asString(experience?.studentId);
    if (!experience || !studentId) return false;
    return canReadCas(ctx, studentId);
  },
  async handler(ctx, input) {
    const experience = await ctx.repo.getExperience(input.experienceId);
    if (!experience) return { experience: null };
    const reflections = await ctx.repo.listReflections(experience._id);
    return {
      experience: {
        experienceId: experience._id,
        studentId: experience.studentId,
        title: experience.title,
        description: experience.description,
        status: experience.status,
      },
      reflections: reflections.map((doc) => ({ reflectionId: doc._id, body: doc.body })),
    };
  },
});

registerAction({
  name: 'casProject.get',
  fn: FUNCTIONS.apiIb,
  roles: ['student', 'parent', 'cas_coordinator'],
  input: z.object({ projectId: idSchema }).strip(),
  scope: async (ctx, input) => {
    const project = await ctx.repo.getProject(input.projectId);
    if (!project || project.schoolId !== ctx.caller.schoolId) return false;
    const members = asStringArray(project.memberStudentIds);
    if (ctx.caller.roles.includes('cas_coordinator')) return members.length > 0;
    for (const studentId of members) {
      if (ctx.caller.roles.includes('parent') && (await ctx.repo.isGuardianOf(ctx.caller.userId, studentId, ctx.caller.schoolId))) {
        return true;
      }
      if (ctx.caller.roles.includes('student') && (await ctx.repo.isSelf(ctx.caller.userId, studentId))) return true;
    }
    return false;
  },
  async handler(ctx, input) {
    const project = await ctx.repo.getProject(input.projectId);
    const members = asStringArray(project?.memberStudentIds);
    const projected = [];
    for (const studentId of members) {
      const student = await ctx.repo.getStudent(studentId);
      const user = student ? await ctx.repo.getUser(asString(student.userId) ?? '') : null;
      const own =
        (ctx.caller.roles.includes('parent') && (await ctx.repo.isGuardianOf(ctx.caller.userId, studentId, ctx.caller.schoolId))) ||
        (ctx.caller.roles.includes('student') && student?.userId === ctx.caller.userId);
      projected.push(own ? { studentId, displayName: displayNameOf(user) } : { displayName: displayNameOf(user) });
    }
    return {
      projectId: project?._id,
      title: project?.title,
      stage: project?.stage,
      members: projected,
    };
  },
});

registerAction({
  name: 'milestone.getPlan',
  fn: FUNCTIONS.apiIb,
  roles: ['student', 'parent', 'supervisor', 'ee_coordinator', 'cas_coordinator', 'admin', 'teacher'],
  input: z.object({ planId: idSchema }).strip(),
  scope: async (ctx, input) => {
    const plan = await ctx.repo.getPlan(input.planId);
    if (!plan) return false;
    return canReadPlan(ctx, plan);
  },
  async handler(_ctx, input) {
    const plan = await _ctx.repo.getPlan(input.planId);
    return {
      planId: plan?._id,
      programType: plan?.programType,
      title: plan?.title,
      studentIds: asStringArray(plan?.studentIds),
      status: plan?.status,
    };
  },
});

registerAction({
  name: 'rppf.get',
  fn: FUNCTIONS.apiIb,
  roles: ['student', 'parent', 'supervisor', 'ee_coordinator', 'admin'],
  input: z.object({ planId: idSchema }).strip(),
  scope: async (ctx, input) => {
    const plan = await ctx.repo.getPlan(input.planId);
    if (!plan) return false;
    return canReadPlan(ctx, plan);
  },
  async handler(ctx, input) {
    const entries = await ctx.repo.listRppf(input.planId);
    return {
      planId: input.planId,
      entries: entries.map((doc) => ({
        session: doc.session,
        wordCount: doc.wordCount,
        studentReflection: doc.studentReflection,
        supervisorComment: doc.supervisorComment,
      })),
    };
  },
});
