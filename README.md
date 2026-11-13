# 家校联络平台

IB 国际学校（MYP / DP）家校联络平台。业务后端按设计走腾讯云 CloudBase；当前可以打开的是浏览器里的静态演示。

想用按钮切换整页语言，请打开演示站的周计划页，点「中文 / EN」：

https://dannywang0822.github.io/home-school-tracker/#/plan

下面先给中文全文，英文全文在后半部分。

---

## 中文

### 现在到哪了

进度日期：**2026-11-13**（Asia/Shanghai）。

| 项 | 状态 | 说明 |
|---|---|---|
| W0 确认假设与部署条件 | 进行中 | 共享环境、公开仓库、发件队列已定。学校业务假设和 CAM 密钥还没齐 |
| W1 地基 | 已完成 | 已合入 main，`bb2bb80`（2026-11-09） |
| W2 组织与账号 | 已完成 | 已合入 main，`6a28151`（2026-11-09） |
| W3 任务与完成跟踪 | 已完成 | 已合入 main，`980587b`（2026-11-09） |
| W4 IB 评估 | 已完成 | 本分支实现（2026-11-13）。老师可打分并发布，家长和学生只看已发布成绩 |
| W5 反馈与通知 | 已完成 | 本分支实现（2026-11-13）。通知中心、留言和发件队列可用。运营 bot 仍不能真正发信 |
| W6 CAS | 计划中 | 尚未开始 |
| W7 里程碑 | 计划中 | 尚未开始 |
| W8 看板、审计、上云 | 计划中 | 尚未开始。当前仍不是 CloudBase 生产站 |
| W9 缓冲 | 计划中 | 尚未开始 |
| 静态演示 + GitHub Pages | 进行中 | 浏览器内虚构数据，不依赖本地 API，也不部署腾讯云 |

状态用词：已完成 / 进行中 / 暂缓 / 计划中。改进度时同时改本文件和 `apps/web/src/plan/weeks.ts`，日期写 Asia/Shanghai 的日历日。

### 八周计划（另加一周缓冲）

原计划共 **8 周开发 + 1 周缓冲**。每周目标和验收如下。

**W0 · 确认假设与部署条件**（进行中，2026-11-09）

- 目标：确认学校规模、登录方式、学期结构、发件方案；准备 CloudBase、域名备案和运营 bot。
- 交付 / 验收：`docs/assumptions.md` 改为已确认，开发和生产环境可用。
- 现状：环境 ID `english-little-steps-d0a2b84764b`（上海，与其他应用共用）、仓库公开、邮件走发件队列，这三件已经按任务定了。其余学校假设和密钥仍开放。

**W1 · 地基**（已完成，2026-11-09，`bb2bb80`）

- 目标：monorepo、统一 API、登录身份与业务用户分离、按亲子/任教/指导关系做权限、审计、限流、通知适配器、中英登录页。
- 交付 / 验收：CI 跑测试。家长读不到别人孩子的数据。邮件只写入 `hst_outbox`。
- 现状：没有凭据，所以没有部署。安全规则用本地解释器验证。

**W2 · 组织与账号**（已完成，2026-11-09，`6a28151`）

- 目标：学年、学期、年级、班级、MYP 八大学科组、DP 科目、教学班、亲子/任教/导师关系、CSV 导入、邀请码、知情同意。
- 交付 / 验收：管理员能导入虚构数据。未同意前看不到孩子数据。老师只看任教班。
- 现状：CSV 以文本提交。建号在本地完成，不调用腾讯云 CreateUser。

**W3 · 任务与完成跟踪**（已完成，2026-11-09，`980587b`）

- 目标：布置、发布、提交、标记完成、班级完成情况、`hst_tmp` → `hst_vault` 附件、逾期计算。
- 交付 / 验收：老师发布后学生和家长立即可见。PX-05/06/08/09 通过。未同意的人看不到任务。
- 现状：逾期只改状态，不发通知。存储是可替换的内存适配器。

**W4 · IB 评估**（已完成，2026-11-13）

- 目标：MYP 八大学科组 Criteria A–D、个人项目和社区项目 A–C、DP 评估组成、草稿与发布、学期汇总和成长曲线。
- 交付 / 验收：老师发布后，家长和学生能看到分数和评语。TX-03、TX-04、PX-22 通过。
- 现状：本分支实现。静态演示里 `t1` 可以给「科学实验」打分并发布，`p1` 在成绩页看到。「科学测验」仍是已发布示例。通知中心、运营发信和 CAS 不在本周。

**W5 · 反馈与通知**（已完成，2026-11-13）

- 目标：对话串、未读、邮件队列、每周汇总、通知偏好。微信订阅消息保持空实现。
- 交付 / 验收：成绩发布后家长的邮件进入队列。PX-03/07/13/20/22、ST-06/07/08 通过。
- 现状：本分支实现通知中心、任务留言和发件队列。运营 bot 还不能真正发信。

**W6 · CAS**（计划中，2026-11-13）

- 目标：经历、反思、证据、协调员审核、7 项学习成果、CAS 项目。
- 交付 / 验收：演示里的 CAS 流程能走通。SX-04、MX-03 通过。

**W7 · 里程碑**（计划中，2026-11-13）

- 目标：EE、个人项目、社区项目的模板、计划、导师、RPPF，以及给学生和家长的逾期提醒。
- 交付 / 验收：EE 逾期提醒可以进入发件队列。MX-01/02、SX-05 通过。

**W8 · 看板、演示数据、安全审计、上云**（计划中，2026-11-13）

- 目标：完善各角色看板，种入 MYP/DP 各一班，做手机走查，部署到 CloudBase。
- 交付 / 验收：安全审计报告通过，并给出部署地址。

**W9 · 缓冲**（计划中，2026-11-13）

- 目标：修缺陷、学校试用、文档定稿、写小程序接入说明。
- 交付 / 验收：试用问题有结论。小程序只新增前端，不改业务后端。

### 演示站

预计地址：https://dannywang0822.github.io/home-school-tracker/

页面上有「静态演示，非真实后端」。周计划页可以切换中文和英文。刷新会回到初始虚构数据。

第一次发布前，在 GitHub 仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。工作流是 `.github/workflows/pages.yml`，在推送到 `main` 或手动触发时构建并发布。本仓库的 PR 不会因此部署到腾讯云。

演示账号都是虚构的，密码 `DemoOnly-2026!`：

| 邮箱 | 角色 |
|---|---|
| a1@demo.school.local | 管理员 |
| t1@demo.school.local | 老师 |
| s1@demo.school.local | 学生 |
| s2@demo.school.local | 学生（逾期任务） |
| p1@demo.school.local | 家长（只绑定演示学生一） |
| minor@demo.school.local | 未满 14 岁、尚未同意的学生 |

老师登录后打开「班级任务」里的「科学实验」，点学生进入批改，保存并发布。家长登录后打开「成绩」，可以看到「科学测验」和刚发布的分数。

### 本地完整联调

```bash
npm ci
npm test
npm run dev
```

浏览器打开 http://127.0.0.1:5173 。`npm run dev` 会带上 `DEV_AUTH=1`，API 在本机 8787，不部署 CloudBase。

只看静态演示、不启 API：

```bash
npm run build -w @hst/web
npm run preview -w @hst/web
```

打开 http://127.0.0.1:4173/home-school-tracker/ 。

### 和设计稿的偏差

- 集合、云函数、存储路径一律 `hst_` 前缀，避免碰共用环境里的其他应用。
- 还没有部署到腾讯云。仓库不放 SecretId、SecretKey 或私钥。
- CSV 直接交文本，不走设计里的 `tmpCloudFileId`。CreateUser 在本地建号。
- 任务附件用内存里的 `ObjectStorage`。正式环境再换成 CloudBase 存储。
- 发布任务后立即可见，靠写入完成记录，不是靠通知。逾期扫描不发邮件。
- 静态演示把同一套权限代码跑在浏览器里。它不是学校正式系统。
- 第 4 周及以后暂缓。

### 公开仓库与数据安全

仓库公开。不要提交密钥、私钥或真实学生资料。凭据只从环境变量读取，`.env.example` 只有变量名。演示人物用虚构姓名和 `@demo.school.local`。除登录、隐私政策和周计划外，页面都要登录。静态演示里的学生也是虚构的。

---

## English

For a button that switches the whole page, open the plan on the demo site and choose 中文 / EN:

https://dannywang0822.github.io/home-school-tracker/#/plan

### Where things stand

Progress date: **2026-11-13** (Asia/Shanghai).

| Item | Status | Notes |
|---|---|---|
| W0 Assumptions and deploy prerequisites | In progress | Shared environment, public repo and outbox are decided. School assumptions and CAM keys are not |
| W1 Foundation | Done | On main, `bb2bb80` (2026-11-09) |
| W2 Organisation and accounts | Done | On main, `6a28151` (2026-11-09) |
| W3 Tasks and completion | Done | On main, `980587b` (2026-11-09) |
| W4 IB assessment | Done | Implemented on this branch (2026-11-13). Teachers can score and release; parents and students see released grades only |
| W5 Feedback and notifications | Done | Implemented on this branch (2026-11-13). Notification center, comments and the outbox work. The ops bot still cannot send real mail |
| W6 CAS | Planned | Not started |
| W7 Milestones | Planned | Not started |
| W8 Dashboards, audit, cloud deploy | Planned | Not started. This is still not the CloudBase production site |
| W9 Buffer | Planned | Not started |
| Static demo + GitHub Pages | In progress | Fictional data in the browser. No local API and no Tencent deploy |

Use Done / In progress / Paused / Planned. When the status changes, update this file and `apps/web/src/plan/weeks.ts`. Dates are calendar days in Asia/Shanghai.

### Eight build weeks, plus one buffer week

**W0 · Confirm assumptions and deploy prerequisites** (In progress, 2026-11-09)

- Goal: confirm school size, sign-in, terms and mail, and prepare CloudBase, ICP filing and the ops bot.
- Delivery: `docs/assumptions.md` confirmed, with usable dev and production environments.
- Now: environment `english-little-steps-d0a2b84764b` (Shanghai, shared), a public repo, and the mail outbox are fixed. Other school assumptions and keys remain open.

**W1 · Foundation** (Done, 2026-11-09, `bb2bb80`)

- Goal: monorepo, shared API, separate login identity and business user, relationship checks, audit, rate limits, notification adapters, bilingual sign-in.
- Delivery: CI runs the tests. A parent cannot read another child. Mail is only queued in `hst_outbox`.
- Now: no CloudBase deploy without credentials. Rules are checked by a local evaluator.

**W2 · Organisation and accounts** (Done, 2026-11-09, `6a28151`)

- Goal: years, terms, grades, classes, eight MYP subject groups, DP subjects, courses, guardian/teaching/mentor links, CSV import, invite codes, consent.
- Delivery: an admin can import fictional data. No child data before consent. Teachers see only their courses.
- Now: CSV is text. Accounts are created locally, not with Tencent CreateUser.

**W3 · Tasks and completion** (Done, 2026-11-09, `980587b`)

- Goal: assign, publish, submit, mark done, class completion, `hst_tmp` → `hst_vault` files, overdue calculation.
- Delivery: after publish, the student and parent see the task immediately. PX-05/06/08/09 pass. People without consent see no tasks.
- Now: overdue only changes status. Storage is a replaceable in-memory adapter.

**W4 · IB assessment** (Done, 2026-11-13)

- Goal: MYP criteria A–D for the eight subject groups, personal and community project criteria A–C, DP components, draft versus release, term summaries and the growth curve.
- Delivery: after release, the parent and student see the score and comment. TX-03, TX-04 and PX-22 pass.
- Now: implemented on this branch. In the static demo, `t1` can grade and release 「科学实验」, and `p1` sees it on the grades page. 「科学测验」 stays the released example. The notification center, ops mailer and CAS are not part of this week.

**W5 · Feedback and notifications** (Done, 2026-11-13)

- Goal: threads, unread counts, the mail queue, weekly digests, preferences. WeChat subscribe stays a stub.
- Delivery: a released grade queues mail for the parent. PX-03/07/13/20/22 and ST-06/07/08 pass.
- Now: this branch adds the notification center, task comments and the outbox. The ops bot still cannot send real mail.

**W6 · CAS** (Planned, 2026-11-13)

- Goal: experiences, reflections, evidence, coordinator review, seven learning outcomes, CAS projects.
- Delivery: the sample CAS flow works. SX-04 and MX-03 pass.

**W7 · Milestones** (Planned, 2026-11-13)

- Goal: EE, personal project and community project templates, plans, supervisors, RPPF, and overdue reminders.
- Delivery: an overdue EE can queue a reminder. MX-01/02 and SX-05 pass.

**W8 · Dashboards, demo data, security audit, cloud deploy** (Planned, 2026-11-13)

- Goal: finish dashboards, seed one MYP and one DP class, check mobile browsers, deploy to CloudBase.
- Delivery: the security audit passes and a deploy URL is published.

**W9 · Buffer** (Planned, 2026-11-13)

- Goal: fix defects, run a school trial, freeze the docs, and write the mini-program handoff.
- Delivery: trial issues are resolved. A mini program adds a frontend only.

### Demo site

Expected URL: https://dannywang0822.github.io/home-school-tracker/

The page says this is a static demo, not a real backend. The plan page switches between Chinese and English. Refreshing restores the initial fictional data.

Before the first publish, set the GitHub repository **Settings → Pages → Build and deployment → Source** to **GitHub Actions**. The workflow is `.github/workflows/pages.yml`. It builds and publishes on push to `main` or when started manually. Pull requests do not deploy to Tencent Cloud.

Demo accounts are fictional. Password: `DemoOnly-2026!`

| Email | Role |
|---|---|
| a1@demo.school.local | Admin |
| t1@demo.school.local | Teacher |
| s1@demo.school.local | Student |
| s2@demo.school.local | Student (overdue task) |
| p1@demo.school.local | Parent (linked only to demo student one) |
| minor@demo.school.local | Student under 14, consent not granted |

Sign in as the teacher, open 「科学实验」 under class tasks, grade the student, and release. Sign in as the parent and open Grades to see 「科学测验」 and the newly released score.

### Full local run

```bash
npm ci
npm test
npm run dev
```

Open http://127.0.0.1:5173 . `npm run dev` sets `DEV_AUTH=1`. The API listens on port 8787. It does not deploy to CloudBase.

Static demo only, without the API:

```bash
npm run build -w @hst/web
npm run preview -w @hst/web
```

Open http://127.0.0.1:4173/home-school-tracker/ .

### Differences from the design

- Collection, function and storage names use the `hst_` prefix because the CloudBase environment is shared.
- Nothing is deployed to Tencent Cloud. The repo has no SecretId, SecretKey or private key.
- CSV is submitted as text, not as the design’s `tmpCloudFileId`. CreateUser is local.
- Task files use an in-memory `ObjectStorage`. Production would swap in CloudBase storage.
- A published task is visible because completion rows are written immediately, not because a notification was sent. The overdue scan does not send mail.
- The static demo runs the same permission code in the browser. It is not the school’s live system.
- Week 4 and later are paused.

### Public repository and data safety

The repository is public. Do not commit secrets, private keys, or real student records. Credentials come from environment variables. `.env.example` lists names only. Demo people use fictional names and `@demo.school.local`. Aside from sign-in, the privacy text and the plan, pages require a sign-in. Students in the static demo are fictional too.
