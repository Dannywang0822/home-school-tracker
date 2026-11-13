export type WeekStatus = 'done' | 'in_progress' | 'paused' | 'planned';

export interface WeekPlan {
  id: string;
  status: WeekStatus;
  updated: string;
  zh: { title: string; goal: string; delivery: string; note: string };
  en: { title: string; goal: string; delivery: string; note: string };
}

/** Dates are calendar days in Asia/Shanghai. */
export const PLAN_UPDATED = '2026-11-13';

export const WEEKS: WeekPlan[] = [
  {
    id: 'W0',
    status: 'in_progress',
    updated: '2026-11-09',
    zh: {
      title: '确认假设与部署条件',
      goal: '确认学校规模、登录方式、学期结构、发件方案，并准备 CloudBase 环境、域名备案和运营 bot。',
      delivery: 'assumptions.md 从“待确认”改为“已确认”；开发环境和生产环境可用。',
      note: '共享环境 ID、公开仓库和发件队列已经按任务确定。学校业务假设和 CAM 密钥仍未齐，所以上云继续等待。',
    },
    en: {
      title: 'Confirm assumptions and deploy prerequisites',
      goal: 'Confirm school size, sign-in, term structure and mail delivery, and prepare the CloudBase environment, ICP filing and the ops mail bot.',
      delivery: 'assumptions.md marked confirmed, with usable dev and production environments.',
      note: 'The shared environment id, public repository and outbox were fixed by the task. School assumptions and CAM keys are still open, so cloud deploy stays blocked.',
    },
  },
  {
    id: 'W1',
    status: 'done',
    updated: '2026-11-09',
    zh: {
      title: '地基',
      goal: 'Monorepo、统一 API、角色与登录身份分离、关系权限、审计、限流、通知适配器接口、中英登录页。',
      delivery: 'CI 跑通测试。家长读不到别人孩子的数据有用例证明。邮件只进 hst_outbox。',
      note: '已合入 main（bb2bb80）。没有凭据，所以没有部署到 CloudBase；规则用本地解释器验证。',
    },
    en: {
      title: 'Foundation',
      goal: 'Monorepo, shared API envelope, separate login identity and business user, relationship checks, audit, rate limits, notification adapters, bilingual sign-in.',
      delivery: 'CI runs the tests. Cases show a parent cannot read another child. Mail is only queued in hst_outbox.',
      note: 'Merged to main (bb2bb80). No CloudBase deploy without credentials; security rules are checked by a local evaluator.',
    },
  },
  {
    id: 'W2',
    status: 'done',
    updated: '2026-11-09',
    zh: {
      title: '组织与账号',
      goal: '学年、学期、年级、班级、MYP 八大学科组与 DP 科目、教学班、亲子/任教/导师关系、CSV 导入、邀请码、知情同意。',
      delivery: '管理员页面可导入虚构数据。未同意前不能看孩子数据。老师只看任教班。',
      note: '已合入 main（6a28151）。CSV 直接提交文本。CreateUser 仍是本地建号，不调用腾讯云。',
    },
    en: {
      title: 'Organisation and accounts',
      goal: 'Years, terms, grades, classes, MYP subject groups and DP subjects, courses, guardian/teaching/mentor links, CSV import, invite codes, consent.',
      delivery: 'Admin screens import fictional data. No child data before consent. Teachers see only their courses.',
      note: 'Merged to main (6a28151). CSV is submitted as text. CreateUser is a local account provisioner, not a Tencent API call.',
    },
  },
  {
    id: 'W3',
    status: 'done',
    updated: '2026-11-09',
    zh: {
      title: '任务与完成跟踪',
      goal: '布置、发布、提交、标记完成、班级完成情况，以及 tmp → vault 附件和逾期计算。',
      delivery: '老师发布后，学生和家长立即可见。PX-05/06/08/09 通过。未同意的人看不到任务。',
      note: '已合入 main（980587b）。逾期只改状态，不发通知。存储是可替换的内存适配器。',
    },
    en: {
      title: 'Tasks and completion',
      goal: 'Assign, publish, submit, mark done, class completion, tmp → vault files, and overdue calculation.',
      delivery: 'After publish, the student and parent see the task immediately. PX-05/06/08/09 pass. People without consent see no tasks.',
      note: 'Merged to main (980587b). Overdue only changes status; it does not send notifications. Storage is a replaceable in-memory adapter.',
    },
  },
  {
    id: 'W4',
    status: 'done',
    updated: '2026-11-13',
    zh: {
      title: 'IB 评估',
      goal: 'MYP Criteria A–D、PP/CP、DP 评估组成、草稿与发布、学期汇总和成长曲线。',
      delivery: '老师发布后，家长和学生能看到分数和评语。TX-03、TX-04、PX-22 通过。',
      note: '本分支实现。通知中心、邮件队列和每周汇总仍是第 5 周。IA 只保留数据挂钩，不做第 7 周的里程碑页面。',
    },
    en: {
      title: 'IB assessment',
      goal: 'MYP criteria A–D, PP/CP, DP components, draft versus release, term summaries and growth.',
      delivery: 'After a teacher releases a grade, the parent and student see the score and comment. TX-03, TX-04 and PX-22 pass.',
      note: 'Implemented on this branch. The notification center, mail queue and weekly digest stay in week 5. IA is only a data hook, not the week 7 milestone screens.',
    },
  },
  {
    id: 'W5',
    status: 'done',
    updated: '2026-11-13',
    zh: {
      title: '反馈与通知',
      goal: '对话串、未读、邮件队列、每周汇总、通知偏好。微信订阅消息保持空实现。',
      delivery: '成绩发布后家长收到队列中的邮件。PX-03/07/13/20/22 和 ST-06/07/08 通过。',
      note: '本分支实现通知中心、留言和发件队列。运营 bot 还不能真正把信发出去。',
    },
    en: {
      title: 'Feedback and notifications',
      goal: 'Threads, unread counts, the mail queue, weekly digests and preferences. WeChat subscribe stays a stub.',
      delivery: 'A released grade queues mail for the parent. PX-03/07/13/20/22 and ST-06/07/08 pass.',
      note: 'This branch adds the notification center, comments and the outbox. The ops bot still cannot deliver real mail.',
    },
  },
  {
    id: 'W6',
    status: 'planned',
    updated: '2026-11-13',
    zh: {
      title: 'CAS',
      goal: '经历、反思、证据、协调员审核、7 项学习成果和 CAS 项目。',
      delivery: '演示数据里的 CAS 流程能走通。SX-04、MX-03 通过。',
      note: '尚未开始。',
    },
    en: {
      title: 'CAS',
      goal: 'Experiences, reflections, evidence, coordinator review, the seven learning outcomes and CAS projects.',
      delivery: 'The sample CAS flow works. SX-04 and MX-03 pass.',
      note: 'Not started.',
    },
  },
  {
    id: 'W7',
    status: 'planned',
    updated: '2026-11-13',
    zh: {
      title: '里程碑（EE / 个人项目 / 社区项目）',
      goal: '模板、计划、导师、RPPF、逾期提醒给学生和家长。',
      delivery: 'EE 逾期提醒可以进发件队列。MX-01/02、SX-05 通过。',
      note: '尚未开始。',
    },
    en: {
      title: 'Milestones (EE / personal project / community project)',
      goal: 'Templates, plans, supervisors, RPPF, and overdue reminders for students and parents.',
      delivery: 'An overdue EE can queue a reminder. MX-01/02 and SX-05 pass.',
      note: 'Not started.',
    },
  },
  {
    id: 'W8',
    status: 'planned',
    updated: '2026-11-13',
    zh: {
      title: '看板、演示数据、安全审计、上云',
      goal: '完善各角色看板，种入 MYP/DP 各一班演示数据，做手机走查，并部署到 CloudBase。',
      delivery: '安全审计报告通过，并给出部署地址。',
      note: '尚未开始。当前演示仍是 GitHub Pages 上的静态站，不是腾讯云生产环境。',
    },
    en: {
      title: 'Dashboards, demo data, security audit, cloud deploy',
      goal: 'Finish role dashboards, seed one MYP and one DP class, check mobile browsers, and deploy to CloudBase.',
      delivery: 'The security audit report passes and a deploy URL is published.',
      note: 'Not started. The current demo is still the static GitHub Pages site, not the Tencent production environment.',
    },
  },
  {
    id: 'W9',
    status: 'planned',
    updated: '2026-11-13',
    zh: {
      title: '缓冲',
      goal: '修缺陷、学校试用、文档定稿、写小程序接入说明。',
      delivery: '试用问题有结论，小程序只需新增前端。',
      note: '尚未开始。',
    },
    en: {
      title: 'Buffer',
      goal: 'Fix defects, run a school trial, freeze the docs, and write the mini-program handoff.',
      delivery: 'Trial issues are resolved. A mini program would add a frontend only.',
      note: 'Not started.',
    },
  },
];

export const CURRENT_WORK = {
  status: 'done' as WeekStatus,
  updated: '2026-11-13',
  zh: {
    title: '第 5 周反馈与通知',
    goal: '任务留言、未读、通知中心、通知频率和免打扰。成绩发布写入站内通知和发件队列。',
    delivery: '静态演示里 t1 发布成绩后，p1 在通知页看到提醒和演示邮件。双方可以在任务页留言。',
    note: '微信订阅仍是空实现。运营 bot 还不能真正发信。CAS 还没开始。',
  },
  en: {
    title: 'Week 5 feedback and notifications',
    goal: 'Task comments, unread counts, a notification center, frequency and quiet hours. Releasing a grade writes an in-app notice and an outbox row.',
    delivery: 'In the static demo, after t1 releases a grade, p1 sees the notice and a demo mail preview. Both sides can comment on the task page.',
    note: 'WeChat subscribe stays a stub. The ops bot still cannot send real mail. CAS has not started.',
  },
};
