export type WeekStatus = 'done' | 'in_progress' | 'paused' | 'planned';

export interface WeekPlan {
  id: string;
  status: WeekStatus;
  updated: string;
  zh: { title: string; goal: string; delivery: string; note: string };
  en: { title: string; goal: string; delivery: string; note: string };
}

/** Dates are calendar days in Asia/Shanghai. */
export const PLAN_UPDATED = '2026-11-09';

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
    status: 'paused',
    updated: '2026-11-09',
    zh: {
      title: 'IB 评估',
      goal: 'MYP Criteria A–D、DP 1–7 与 IA、草稿与发布、学期汇总和成长曲线。',
      delivery: '家长能看到已发布的分数和评语。TX-03/04 通过。',
      note: 'Danny 决定第 4 周及以后暂缓。',
    },
    en: {
      title: 'IB assessment',
      goal: 'MYP criteria A–D, DP 1–7 and IA, draft versus release, term summaries and growth.',
      delivery: 'Parents see released scores and comments. TX-03/04 pass.',
      note: 'Danny paused week 4 and everything after it.',
    },
  },
  {
    id: 'W5',
    status: 'paused',
    updated: '2026-11-09',
    zh: {
      title: '反馈与通知',
      goal: '对话串、未读、邮件队列、每周汇总、通知偏好。微信订阅消息保持空实现。',
      delivery: '成绩发布后家长收到队列中的邮件。相关 PX/ST 用例通过。',
      note: '暂缓。第 1 周已经留下适配器接口，发信仍由运营 bot 代发。',
    },
    en: {
      title: 'Feedback and notifications',
      goal: 'Threads, unread counts, the mail queue, weekly digests and preferences. WeChat subscribe stays a stub.',
      delivery: 'A released grade queues mail for the parent. Related PX/ST cases pass.',
      note: 'Paused. Week 1 already left the adapter interface. Sending stays with the ops bot.',
    },
  },
  {
    id: 'W6',
    status: 'paused',
    updated: '2026-11-09',
    zh: {
      title: 'CAS',
      goal: '经历、反思、证据、协调员审核、7 项学习成果和 CAS 项目。',
      delivery: '演示数据里的 CAS 流程能走通。SX-04、MX-03 通过。',
      note: '暂缓。',
    },
    en: {
      title: 'CAS',
      goal: 'Experiences, reflections, evidence, coordinator review, the seven learning outcomes and CAS projects.',
      delivery: 'The sample CAS flow works. SX-04 and MX-03 pass.',
      note: 'Paused.',
    },
  },
  {
    id: 'W7',
    status: 'paused',
    updated: '2026-11-09',
    zh: {
      title: '里程碑（EE / 个人项目 / 社区项目）',
      goal: '模板、计划、导师、RPPF、逾期提醒给学生和家长。',
      delivery: 'EE 逾期提醒可以进发件队列。MX-01/02、SX-05 通过。',
      note: '暂缓。',
    },
    en: {
      title: 'Milestones (EE / personal project / community project)',
      goal: 'Templates, plans, supervisors, RPPF, and overdue reminders for students and parents.',
      delivery: 'An overdue EE can queue a reminder. MX-01/02 and SX-05 pass.',
      note: 'Paused.',
    },
  },
  {
    id: 'W8',
    status: 'paused',
    updated: '2026-11-09',
    zh: {
      title: '看板、演示数据、安全审计、上云',
      goal: '完善各角色看板，种入 MYP/DP 各一班演示数据，做手机走查，并部署到 CloudBase。',
      delivery: '安全审计报告通过，并给出部署地址。',
      note: '暂缓。当前演示是 GitHub Pages 上的静态站，不是腾讯云生产环境。',
    },
    en: {
      title: 'Dashboards, demo data, security audit, cloud deploy',
      goal: 'Finish role dashboards, seed one MYP and one DP class, check mobile browsers, and deploy to CloudBase.',
      delivery: 'The security audit report passes and a deploy URL is published.',
      note: 'Paused. The current demo is a static GitHub Pages site, not the Tencent production environment.',
    },
  },
  {
    id: 'W9',
    status: 'paused',
    updated: '2026-11-09',
    zh: {
      title: '缓冲',
      goal: '修缺陷、学校试用、文档定稿、写小程序接入说明。',
      delivery: '试用问题有结论，小程序只需新增前端。',
      note: '暂缓。',
    },
    en: {
      title: 'Buffer',
      goal: 'Fix defects, run a school trial, freeze the docs, and write the mini-program handoff.',
      delivery: 'Trial issues are resolved. A mini program would add a frontend only.',
      note: 'Paused.',
    },
  },
];

export const CURRENT_WORK = {
  status: 'in_progress' as WeekStatus,
  updated: '2026-11-09',
  zh: {
    title: '静态演示与 GitHub Pages',
    goal: '不依赖本地 API 和 CloudBase，在浏览器里用虚构数据走通管理员、老师、学生、家长前三周的主流程，并把构建结果发布到 GitHub Pages。',
    delivery: 'npm run build -w @hst/web 产出静态文件。推到 main 或手动触发后，由 GitHub Actions 发布。',
    note: '演示站预计地址 https://dannywang0822.github.io/home-school-tracker/ 。刷新页面会回到初始数据。',
  },
  en: {
    title: 'Static demo and GitHub Pages',
    goal: 'Walk the admin, teacher, student and parent flows from the first three weeks in the browser, with fictional data and no local API or CloudBase, then publish the build to GitHub Pages.',
    delivery: 'npm run build -w @hst/web emits static files. GitHub Actions publishes them on push to main or when started by hand.',
    note: 'Expected site: https://dannywang0822.github.io/home-school-tracker/ . A refresh restores the initial demo data.',
  },
};
