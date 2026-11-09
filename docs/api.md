# API 文档（云函数 / HTTP API）

> Web 端和以后的小程序**共用同一组云函数**。新增小程序时只需要写前端，加上调用 `auth.wechat*` 接口，业务后端不用改。
> 所有业务权限都在云函数内部校验（见 `security-rules.md` §3）。

## 1. 调用方式

### 1.1 函数划分（共 11 个，需要确认套餐允许的函数数量，**待核实**）
| 云函数 | 内容 | 调用规则 |
|---|---|---|
| `auth-public` | 微信 code 登录、读取政策文本 | `true`（函数内部限流） |
| `api-core` | me、auth、consent、guardian、notify、prefs、file | 已登录且非匿名 |
| `api-academic` | course、task、progress、submission、assessment、summary、thread、message、dashboard | 同上 |
| `api-ib` | cas、milestone、rppf | 同上 |
| `api-admin` | admin.* | 同上（函数内部要求 `admin` 角色） |
| `ops` | 发件队列领取和回写 | 同上（函数内部要求 `ops_mailer` 角色） |
| `cron-publish` | 每分钟：发布到时的定时任务 | `false`，定时触发 `0 * * * * * *` |
| `cron-reminders` | 每小时：临近截止、逾期提醒，状态纠偏 | `false`，`0 5 * * * * *` |
| `cron-weekly-digest` | 每周日 18:00 生成每周汇总；每天 18:00 生成每日摘要 | `false`，`0 0 18 * * * *`（函数内部判断是否周日） |
| `cron-retention` | 每天 03:00：清理 tmp 文件、归档、到期删除 | `false`，`0 0 3 * * * *` |
| `cron-outbox-maintain` | 每 5 分钟：收回租约过期的领取、标记失败、清理 | `false`，`0 */5 * * * * *` |
> CloudBase 定时触发器使用 **7 段 cron**（秒 分 时 日 月 周 年）。**触发时区要在控制台确认**；如果是 UTC，上表的时间要减 8 小时。所有 cron 任务都要用 `cron_locks` 做幂等。
> 如果套餐对函数数量有限制，可以把 `api-*` 合并成一个 `api` 函数，`action` 路由不变，客户端不受影响。

### 1.2 请求封装（三种调用方式使用同一种格式）
```jsonc
// 请求
{ "action": "task.create", "data": { /* 入参 */ }, "requestId": "uuid-v4", "locale": "zh" }
// 成功
{ "ok": true,  "data": { /* 出参 */ }, "requestId": "..." }
// 失败
{ "ok": false, "error": { "code": "NOT_FOUND", "message": "资源不存在", "details": {} }, "requestId": "..." }
```
- **Web SDK**：`app.callFunction({ name: 'api-academic', data: { action, data, requestId } })`
- **HTTP API**（小程序或第三方）：`POST https://{envId}.api.tcloudbasegateway.com/v1/functions/{函数名}`，请求头 `Authorization: Bearer {access_token}`，`Content-Type: application/json`，请求体就是上面的封装格式。网关策略只放行列出来的函数。
- **小程序**（以后）：可以用 HTTP API，或者在小程序和同一个环境关联后用 `wx.cloud.callFunction`（**能否关联需要核实**，见 §6）。
- 写操作支持幂等：同一个 `requestId` 在 10 分钟内重复提交，直接返回第一次的结果。
- 分页：`{ cursor?: string, limit?: number(≤50) }` → `{ items, nextCursor? }`。
- 时间都用毫秒时间戳；多语言字段是 `{ zh, en? }`。

### 1.3 错误码
| code | HTTP 语义 | 说明 |
|---|---|---|
| `INVALID_ARGUMENT` | 400 | 参数校验失败（zod），`details.fields` 说明哪些字段有问题 |
| `UNAUTHENTICATED` | 401 | 没有登录，或者登录身份没有对应到任何用户 |
| `ACCOUNT_DISABLED` | 403 | 账号被封禁或已归档 |
| `PASSWORD_CHANGE_REQUIRED` | 403 | 首次登录需要先修改密码 |
| `CONSENT_REQUIRED` | 403 | 还没完成知情同意；`details.studentIds` 列出需要同意的孩子 |
| `PERMISSION_DENIED` | 403 | 角色不允许，或者是自己的资源但当前状态不允许这个操作 |
| `NOT_FOUND` | 404 | 资源不存在，**或者没有权限访问**（两者故意不区分） |
| `ALREADY_EXISTS` | 409 | 唯一键冲突 |
| `CONFLICT` | 409 | 乐观锁版本冲突，需要刷新后重试 |
| `FAILED_PRECONDITION` | 412 | 状态不允许，例如任务还没发布、RPPF 已经签字锁定 |
| `DEADLINE_PASSED` | 412 | 截止后不允许提交（`allowLate=false`） |
| `INVITE_INVALID` / `INVITE_EXPIRED` | 400 | 邀请码无效或已过期（对外统一提示“邀请码无效或已过期”） |
| `FILE_TOO_LARGE` / `FILE_TYPE_NOT_ALLOWED` | 400 | 文件太大，或者文件类型不在白名单里 |
| `IMPORT_VALIDATION_FAILED` | 422 | CSV 有错误行 |
| `RATE_LIMITED` | 429 | 触发限流，`details.retryAfterSec` 是建议的重试间隔 |
| `NOT_IMPLEMENTED` | 501 | 预留接口（例如 `wechat_subscribe` 渠道） |
| `INTERNAL` | 500 | 服务端错误，用 `requestId` 排查 |

角色缩写和 `data-model.md` 一致：**S** 学生 **P** 家长 **T** 老师 **HR** 班主任 **SV** 导师 **CC** CAS 协调员 **EC** EE/PP 协调员 **A** 管理员 **OPS** 运营 bot。“关系”指 `security-rules.md` §3.2 里的关系判定。

## 2. 认证、身份、同意（`auth-public` / `api-core`）

| action | 角色 | 入参 | 出参 | 错误码 |
|---|---|---|---|---|
| `auth.resolve` | 所有已登录用户 | — | `{ user: { id, displayName, roles, locale, status, mustChangePassword }, children?: [{studentId, displayName, programme, className}], pendingConsents: studentId[] }` | `UNAUTHENTICATED` `ACCOUNT_DISABLED` |
| `me.get` | 同上 | — | 同上，另加 `school: { name, timezone, currentYear, currentTerm }` | 同上 |
| `me.update` | 同上 | `{ locale?, displayName? }` | `{ user }` | `INVALID_ARGUMENT` |
| `auth.passwordChanged` | 同上 | — （前端已经用 SDK 改好密码后调用） | `{ ok }`，清除 `mustChangePassword` | — |
| `consent.policy` | 所有用户（`auth-public`） | `{ kind: "privacy"\|"guardian_minor", locale }` | `{ version, content, effectiveAt }` | — |
| `consent.status` | P、S | — | `{ items: [{ studentId, required: bool, grantedVersion?, scopes }] }` | — |
| `consent.grant` | P（为自己的孩子）、S（14 岁及以上本人） | `{ studentId, policyVersion, scopes: string[] }`，`scopes` 必须包含 `basic_processing` | `{ consentId }`；学生状态由 `pending_consent` 变为 `active` | `NOT_FOUND` `INVALID_ARGUMENT` `FAILED_PRECONDITION`（版本不是当前生效版本） |
| `consent.revoke` | 同上 | `{ studentId, scopes?: string[] }`（不传表示全部撤回） | `{ ok }`；如果撤回了 `basic_processing`，学生账号变为 `suspended` | `NOT_FOUND` |
| `guardian.redeemInvite` | P | `{ code: string(8) }` | `{ studentId, displayName（脱敏）, className }`，需要家长再调用 `guardian.confirmInvite` 确认 | `INVITE_INVALID` `INVITE_EXPIRED` `RATE_LIMITED` |
| `guardian.confirmInvite` | P | `{ code, relation }` | `{ guardianshipId }` | 同上 `ALREADY_EXISTS` |
| `guardian.listMine` | P | — | `{ items: [{ studentId, displayName, programme, className, relation }] }` | — |

### 2.1 微信 openid 绑定（预留接口，第一期就实现后端并写好测试，但不做小程序界面）
| action | 函数 | 角色 | 入参 | 出参 | 错误码 |
|---|---|---|---|---|---|
| `auth.wechatBindCode` | `api-core` | 已登录的 Web 用户 | — | `{ code: "6位", expiresAt }`（5 分钟有效，存哈希） | `RATE_LIMITED` |
| `auth.wechatLogin` | `auth-public` | 未登录 | `{ appId, jsCode }` | 已经绑定：`{ status: "bound", ticket }`（自定义登录 Ticket，`customUserId = users._id`）；还没绑定：`{ status: "unbound", bindSession: string(5分钟) }` | `INVALID_ARGUMENT` `RATE_LIMITED` `ACCOUNT_DISABLED` |
| `auth.wechatBind` | `auth-public` | 未登录（凭 `bindSession` 调用） | `{ bindSession, code }` | `{ ticket }`；写入 `auth_identities(provider=wechat_mp_openid)` 和审计日志 | `INVITE_INVALID` `INVITE_EXPIRED` `ALREADY_EXISTS`（这个 openid 已经绑定了其他账号） |
| `auth.wechatUnbind` | `api-core` | 本人、A | `{ userId? }`（只有 A 可以传） | `{ ok }` | `NOT_FOUND` |
| `auth.identities` | `api-core` | 本人 | — | `{ items: [{ provider, boundAt }] }`（不返回 openid 明文） | — |

实现要点：
- `auth.wechatLogin` 在服务端调用微信 `jscode2session`（需要小程序的 AppID 和 AppSecret，放在环境变量里），用 `openid` 查询 `auth_identities`；然后调用 `app.auth().createTicket(customUserId)` 签发 Ticket（需要自定义登录私钥）；小程序端调用 `signInWithCustomTicket` 完成登录。
- 云函数解析调用者身份的顺序：`getUserInfo().customUserId` → 直接对应 `users._id`（同时检查 `auth_identities` 里有 `custom` 类型的有效记录）；否则用 `uid` → `auth_identities(provider=cloudbase_uid)`；如果小程序和环境直接关联，再用 `openId` → `wechat_mp_openid`。
- 绑定和解绑都写审计日志；一个 openid 只能绑定一个用户（唯一索引）。

## 3. 组织与教学班（`api-academic`）
| action | 角色 | 入参 | 出参 | 错误码 |
|---|---|---|---|---|
| `course.listMine` | T、S、P（孩子的）、HR | `{ yearId?, studentId?(P 必填) }` | `{ items: [{ courseId, name, subject, programme, gradeLevel, role? }] }` | `NOT_FOUND` |
| `course.roster` | T（任教）、HR、A | `{ courseId }` | `{ items: [{ studentId, displayName, studentNo }] }` | `NOT_FOUND` `PERMISSION_DENIED`（P、S 调用时） |
| `student.profile` | 满足关系的用户（见矩阵） | `{ studentId }` | `{ studentId, displayName, programme, className, studentNo?(仅教职工) }` | `NOT_FOUND` |
| `student.contacts` | HR、A | `{ studentId }` | `{ guardians: [{ displayName, relation, receivesEmail }] }`（A 额外返回 email 和 phone） | `NOT_FOUND` |
| `catalog.get` | 所有已登录用户 | — | `{ subjects, criteria, dpComponents, terms, grades }`（字典数据，前端缓存） | — |

## 4. 任务、完成状态、提交
| action | 角色 | 入参 | 出参 | 错误码 |
|---|---|---|---|---|
| `task.create` | T（任教该 courseId） | `{ courseId, type, title, description?, dueAt, publishAt?, requiresSubmission, allowLate, assessment?: { scheme: "MYP", criteria: ("A"\|"B"\|"C"\|"D")[] } \| { scheme: "DP", componentCode?: "IA", iaPlanStepKey? }, attachmentIds?, assigneeStudentIds?, publish: bool }` | `{ taskId, status }`；发布时同步创建 `task_progress` 并触发 `task_new` 通知 | `NOT_FOUND` `INVALID_ARGUMENT`（Criteria 必须属于该学科组；`dueAt` 必须晚于发布时间） |
| `task.update` | 同上 | `{ taskId, ...可修改字段, version }` | `{ task }`；修改截止时间时重新计算 `isOverdue`，并通知学生和家长 | `NOT_FOUND` `CONFLICT` `FAILED_PRECONDITION`（已经有成绩发布后，不能删除关联的 Criteria） |
| `task.publish` / `task.close` / `task.archive` | 同上 | `{ taskId }` | `{ status }` | 同上 |
| `task.listForCourse` | T、HR | `{ courseId, status?, from?, to?, cursor? }` | `{ items: [Task + stats] }` | `NOT_FOUND` |
| `task.listMine` | S | `{ range: "week"\|"all"\|"overdue"\|"graded", subjectId?, cursor? }` | `{ items: [{ task, progress: { displayStatus, isLate, submittedAt } }] }` | — |
| `task.listForChild` | P | `{ studentId, range, subjectId?, cursor? }` | 同上 | `NOT_FOUND` |
| `task.get` | T（任教）、S（被布置了这个任务）、P（孩子被布置了这个任务） | `{ taskId, studentId?(P、T 查看某个学生时填) }` | `{ task, attachments: [{fileId, name, size}], progress?, assessment?(只有 released 的，T 可以看草稿), threadId }` | `NOT_FOUND` |
| `progress.listForTask` | T | `{ taskId, displayStatus?, cursor? }` | `{ items: [{ studentId, displayName, displayStatus, isLate, submittedAt, assessmentStatus }] }` | `NOT_FOUND` |
| `progress.listByStudent` | S（本人）、P、T（只返回自己任教的教学班）、HR | `{ studentId, termId?, cursor? }` | `{ items, completionRate: { assigned, done, rate } }` | `NOT_FOUND` |
| `progress.start` | S | `{ taskId }` | `{ displayStatus: "in_progress" }` | `NOT_FOUND` `FAILED_PRECONDITION` |
| `progress.markDone` | S | `{ taskId }`（只适用于 `requiresSubmission=false` 的任务） | `{ displayStatus: "submitted" }` | 同上 `DEADLINE_PASSED` |
| `submission.create` | S | `{ taskId, text?, fileIds?: string[], links?: string[] }` | `{ submissionId, version, isLate }`；通知任课老师（进入每日摘要） | `NOT_FOUND` `DEADLINE_PASSED` `FAILED_PRECONDITION`（已经批改，并且老师没有退回） |
| `submission.list` | S、P、T | `{ taskId, studentId }` | `{ items: [{ version, text, files, submittedAt, isLate }] }` | `NOT_FOUND` |
| `submission.return` | T | `{ taskId, studentId, reason }` | `{ ok }`；状态退回到 `submitted` 之前，通知学生和家长 | `NOT_FOUND` |
| `reminder.nudge` | T | `{ taskId, studentIds: string[] }` | `{ queued: number }`（每个任务每个学生每天最多提醒 1 次） | `NOT_FOUND` `RATE_LIMITED` |

## 5. 评估与成绩
| action | 角色 | 入参 | 出参 | 错误码 |
|---|---|---|---|---|
| `assessment.save` | T（任教） | `{ taskId, studentId, myp?: { A?: {level: 0..8, comment?}, ... }, dp?: { score: 1..7, rawMark?, comment? }, overallComment?, version? }` | `{ assessmentId, status: "draft", version }` | `NOT_FOUND` `INVALID_ARGUMENT` `CONFLICT` |
| `assessment.release` | T | `{ taskId, studentIds: string[] }` 或 `{ taskId, all: true }` | `{ released: number }`；把 `task_progress` 改为 `graded`、重新计算 `term_summaries`、写入对话串、发出 `grade_released` 通知、写审计日志 | `NOT_FOUND` `FAILED_PRECONDITION`（还有草稿没打完分） |
| `assessment.update` | T | 同 `save`，用于已发布的成绩 | `{ version }`；写审计日志 `update_after_release`，并重新通知 | 同上 |
| `assessment.listByStudent` | S、P、T（任教的学科）、HR | `{ studentId, termId?, subjectId? }` | `{ items: [{ taskId, taskTitle, subject, myp?, dp?, overallComment, releasedAt }] }`（只返回 released；T 在自己的学科可以加 `includeDraft`） | `NOT_FOUND` |
| `summary.get` | 同上 | `{ studentId, yearId? }` | `{ terms: [{ termId, subjects: [{ subjectId, myp?: { A..D bestFit, total, grade }, dp?: { predicted } }] }], growth: { [subjectId]: { A: [{ termId, level }] ... } } }` | `NOT_FOUND` |
| `summary.override` | T | `{ studentId, subjectId, termId, grade, comment }` | `{ ok }`；写审计日志 | `NOT_FOUND` |
| `criteria.distribution` | T、HR | `{ courseId, termId?, taskId? }` | `{ A: { "0":n, ..., "8":n }, B: ..., C:..., D:... }` 或 DP `{ "1":n..."7":n }` | `NOT_FOUND` |

## 6. 反馈对话串
| action | 角色 | 入参 | 出参 | 错误码 |
|---|---|---|---|---|
| `thread.listMine` | 所有角色（按关系过滤） | `{ studentId?, unreadOnly?, cursor? }` | `{ items: [{ threadId, contextType, contextTitle, studentId, studentName, lastMessageAt, lastMessagePreview, unreadCount }] }` | `NOT_FOUND` |
| `thread.getOrCreate` | 和学生有关系的用户 | `{ contextType, contextId, studentId }` | `{ threadId }` | `NOT_FOUND` |
| `message.list` | 同上 | `{ threadId, cursor? }` | `{ items: [{ messageId, author: {displayName, role}, kind, body, attachments, createdAt }] }`（家长看不到 `staff_student` 的消息） | `NOT_FOUND` |
| `message.post` | 同上 | `{ threadId, body, kind?, visibility?, attachmentIds? }`；`kind` 由服务端根据角色决定 | `{ messageId }`；给其他参与者加未读数并发通知（`comment_new` 或 `feedback_new`） | `NOT_FOUND` `INVALID_ARGUMENT` `RATE_LIMITED`（每人每分钟最多 10 条） |
| `message.edit` / `message.delete` | 作者本人（15 分钟内） | `{ messageId, body? }` | `{ ok }` | `PERMISSION_DENIED` |
| `thread.markRead` | 参与者 | `{ threadId }` | `{ ok }` | `NOT_FOUND` |

## 7. 看板
| action | 角色 | 入参 | 出参 |
|---|---|---|---|
| `dashboard.teacher` | T | `{ courseId, termId? }` | `{ completion: { assigned, submitted, graded, overdue, rate }, overdueList: [{ studentId, displayName, taskId, taskTitle, dueAt }], criteriaDistribution, toGrade: number, unreadThreads: number }` |
| `dashboard.parent` | P | `{ studentId? }`（不传时默认第一个孩子） | `{ child, weekTasks: [...], overdueCount, recentComments: [{ taskTitle, subject, excerpt, at }](最近 5 条), ib: { programme, myp?: { subjects: [{ subject, latest: {A..D} }] }, dp?: { subjects: [{ subject, latestScore, ia: { stage, dueAt } }], cas: { outcomes, interviewsDone, project }, ee: { progress, nextDue } } } }` |
| `dashboard.student` | S | — | 同家长看板，另加 `todo`（今天要做的事） |
| `dashboard.cas` | CC | `{ yearId? }` | `{ pendingReviews, outcomesHeatmap: [{ studentId, displayName, LO1..LO7 }], inactiveStudents, projects }` |
| `dashboard.mentor` | SV、EC | `{ programType? }` | `{ plans: [{ planId, student, programType, progress, overdue, nextDue }] }` |
错误码：`NOT_FOUND`、`PERMISSION_DENIED`。

## 8. CAS（`api-ib`）
| action | 角色 | 入参 | 出参 | 错误码 |
|---|---|---|---|---|
| `cas.list` | S、P、CC、SV(`CAS_ADVISOR`) | `{ studentId, status?, cursor? }` | `{ items: [Experience] }` | `NOT_FOUND` |
| `cas.get` | 同上 | `{ experienceId }` | `{ experience, reflections, evidence, reviews, threadId }` | `NOT_FOUND` |
| `cas.create` / `cas.update` | S（DP 学生） | `{ title, description, strands, kind, startDate, endDate?, plannedOutcomes, externalSupervisor?, casProjectId? }`；`update` 需要再加 `experienceId` 和 `version` | `{ experienceId }` | `INVALID_ARGUMENT` `FAILED_PRECONDITION`（已经 approved 的经历只能补充反思和证据） |
| `cas.addReflection` | S | `{ experienceId, body?, format, fileId?, url?, outcomes, stage? }` | `{ reflectionId }` | `NOT_FOUND` |
| `cas.addEvidence` | S | `{ experienceId, fileId?, url?, caption }` | `{ evidenceId }` | `NOT_FOUND` `CONSENT_REQUIRED`（没有勾选 `evidence_upload`） |
| `cas.submit` | S | `{ experienceId }` | `{ status: "submitted" }`，通知 CC | `FAILED_PRECONDITION` |
| `cas.review` | CC、SV(`CAS_ADVISOR`) | `{ experienceId, decision: "approve"\|"request_changes"\|"complete", outcomesConfirmed?: LO[], comment }` | `{ status }`；重新计算 `cas_summaries`、通知学生和家长、写审计日志 | `NOT_FOUND` `FAILED_PRECONDITION` |
| `cas.summary` | S、P、CC、SV | `{ studentId }` | `cas_summaries` 文档 | `NOT_FOUND` |
| `casProject.create` / `update` / `get` | 成员学生；CC 可读 | `{ title, memberStudentIds, strands, startDate, endDate?, stage }` | `{ projectId }`；家长读取时，其他成员只返回显示名 | `NOT_FOUND` `INVALID_ARGUMENT`（成员必须是同校 DP 学生） |

## 9. 里程碑组件（EE / PP / CP / DP_IA / CAS 共用）
| action | 角色 | 入参 | 出参 | 错误码 |
|---|---|---|---|---|
| `milestone.template.upsert` | EC、A | `{ programType, yearId, name, steps: [...] }` | `{ templateId }` | `INVALID_ARGUMENT` |
| `milestone.createPlans` | EC（EE/PP/CP）、T（DP_IA，只限自己任教的学生）、CC（CAS 访谈） | `{ templateId, students: [{ studentIds: string[], supervisorId? }] }` | `{ planIds }`；同时生成 `milestone_items` 并写入 `mentorships` | `NOT_FOUND` `INVALID_ARGUMENT` |
| `milestone.assignSupervisor` | EC、A | `{ planId, supervisorId }` | `{ ok }`；写审计日志，通知学生、家长和导师 | `NOT_FOUND` |
| `milestone.listMine` | S、SV、EC | `{ programType? }` | `{ items: [Plan + progress] }` | — |
| `milestone.listForChild` | P | `{ studentId }` | 同上（只返回 `visibleToGuardian` 的步骤） | `NOT_FOUND` |
| `milestone.getPlan` | 有关系的用户 | `{ planId }` | `{ plan, items, rppf?, threadId }` | `NOT_FOUND` |
| `milestone.updateTitle` | S | `{ planId, title }` | `{ ok }` | `NOT_FOUND` |
| `milestone.submitItem` | S | `{ itemId, fileIds?, studentNote? }` | `{ status: "submitted" }`，通知导师 | `NOT_FOUND` `FAILED_PRECONDITION` |
| `milestone.reviewItem` | SV（对应类型）、EC | `{ itemId, comment, decision: "reviewed"\|"revise" }` | `{ status }`；通知学生和家长 | `NOT_FOUND` |
| `milestone.setDue` | EC、A（单个或批量） | `{ itemIds, dueAt }` | `{ updated }`；通知学生 | `NOT_FOUND` |
| `rppf.save` | S | `{ planId, session: 1\|2\|3, studentReflection }` | `{ wordCount, totalWords }` | `NOT_FOUND` `INVALID_ARGUMENT`（三次合计超过 500 词） `FAILED_PRECONDITION`（导师已签字） |
| `rppf.sign` | SV(`EE_SUPERVISOR`) | `{ planId, session, supervisorComment, sessionDate }` | `{ signedAt }`；写审计日志 | `NOT_FOUND` |

## 10. 通知、偏好、文件（`api-core`）
| action | 角色 | 入参 | 出参 | 错误码 |
|---|---|---|---|---|
| `notify.list` | 本人 | `{ studentId?, unreadOnly?, cursor? }` | `{ items: [Notification], unreadCount }` | — |
| `notify.markRead` | 本人 | `{ ids?: string[], all?: true }` | `{ updated }` | — |
| `prefs.get` / `prefs.update` | 本人 | `update`：`{ locale?, channels?: { email?: { enabled, mode, types } }, quietHours? }` | `{ prefs }` | `INVALID_ARGUMENT` |
| `file.commit` | 所有已登录用户 | `{ tmpCloudFileId, name, mime, size, refType, refId }`（用于提交、CAS、里程碑、消息、任务附件） | `{ fileId }`；校验 MIME、大小、`refId` 关系后复制到 `vault/` | `FILE_TOO_LARGE` `FILE_TYPE_NOT_ALLOWED` `NOT_FOUND` |
| `file.getUrl` | 满足关系的用户 | `{ fileId }` | `{ url, expiresAt }`（600 秒） | `NOT_FOUND` |
| `file.delete` | 上传人（引用对象还没提交或锁定时） | `{ fileId }` | `{ ok }` | `PERMISSION_DENIED` |

### 10.1 通知渠道适配器接口（`packages/core/notify`）
```ts
type NotifyEvent = {
  type: 'task_new'|'task_due_soon'|'task_overdue'|'grade_released'|'comment_new'|'feedback_new'
      | 'milestone_due_soon'|'milestone_overdue'|'cas_reviewed'|'cas_due'|'system';
  studentId?: string;
  refType: string; refId: string;
  recipients: { userId: string; reason: 'student'|'guardian'|'teacher'|'supervisor'|'coordinator' }[];
  vars: Record<string, string>;        // 模板变量，只放标题、学科、截止时间这类最少的内容
  importance: 'high'|'normal';         // high 发即时邮件；normal 进入摘要
  dedupeKey: string;
};

interface ChannelAdapter {
  readonly channel: 'email' | 'wechat_subscribe';
  /** 根据偏好和账号情况判断这个渠道对这个收件人是否可用 */
  isEnabledFor(user: UserLite, prefs: NotificationPrefs, ev: NotifyEvent): boolean;
  /** 渲染内容（按收件人语言） */
  render(ev: NotifyEvent, user: UserLite, locale: 'zh'|'en'): Promise<RenderedMessage>;
  /** 投递：可以直接发送，也可以写入发件队列；必须幂等（按 dedupeKey） */
  deliver(msg: RenderedMessage, ctx: DeliverCtx): Promise<{ status: 'queued'|'sent'|'skipped'|'not_implemented'; outboxId?: string; reason?: string }>;
}

// 第一期的实现
class EmailOutboxAdapter implements ChannelAdapter {   // transport = 'ops_bot_queue'
  // deliver(): 写入 outbox(status=pending, from='dannysuperbot@mail.grokbot.com')；免打扰时段内的邮件推迟 scheduledAt
}
class WechatSubscribeAdapter implements ChannelAdapter { // 空实现
  isEnabledFor() { return false; }
  async deliver() { return { status: 'not_implemented' }; }
}
// 以后如果有了 SMTP 或 API 凭据：新增 EmailSmtpAdapter，用配置 NOTIFY_EMAIL_TRANSPORT=smtp|ops_bot_queue 切换，调用方不用改
```
`notify.emit(ev)` 的流程：按 `dedupeKey` 去重 → 给每个收件人写 `notifications` → 读取偏好 → `importance=high` 并且 `mode=immediate` 时调用适配器的 `deliver`，否则标记 `digest.pending`。

## 11. 运营 bot 代发接口（`ops`，只有 `ops_mailer` 角色可以调用）
运营 bot 用专门的 CloudBase 账号（邮箱 + 密码登录，只有 `ops_mailer` 一个角色）获取 access_token，然后通过 HTTP API 调用。
| action | 入参 | 出参 | 错误码 |
|---|---|---|---|
| `ops.claimOutbox` | `{ limit?: number(≤20), leaseSec?: number(默认 600), workerId: string }` | `{ items: [{ outboxId, claimToken, from, to, subject, text, html, kind, createdAt }] }`：按 `priority`、`scheduledAt` 排序；用乐观锁把记录改为 `claimed` | `PERMISSION_DENIED` |
| `ops.ackOutbox` | `{ outboxId, claimToken, result: "sent"\|"failed", providerMessageId?, error?, retryable?: bool }` | `{ status }`：`failed` 并且 `retryable` 时，按指数退避重新排队（最多 5 次） | `CONFLICT`（租约已经过期，被重新领取） `NOT_FOUND` |
| `ops.stats` | — | `{ pending, claimed, failed24h, oldestPendingAgeSec }` | — |
> 运营 bot 的工作循环：每 ≤ 5 分钟调用一次 `claimOutbox` → 逐封用 `dannysuperbot@mail.grokbot.com` 发送 → 调用 `ackOutbox`。`cron-outbox-maintain` 负责收回租约过期的领取。如果 `oldestPendingAgeSec > 900`，就在管理员页面告警。

## 12. 管理员（`api-admin`）
| action | 入参 | 出参 | 错误码 |
|---|---|---|---|
| `admin.year.upsert` / `admin.term.upsert` / `admin.grade.upsert` / `admin.class.upsert` / `admin.subject.upsert` / `admin.course.upsert` | 对应集合的字段 | `{ id }` | `INVALID_ARGUMENT` `ALREADY_EXISTS` |
| `admin.criteria.upsert` / `admin.boundaries.update` / `admin.dpComponent.upsert` | | `{ ok }` | |
| `admin.import.validate` | `{ type, tmpCloudFileId }`（UTF-8 CSV，第一行是表头） | `{ jobId, total, errors: [{ row, code, message }] }` | `IMPORT_VALIDATION_FAILED` |
| `admin.import.run` | `{ jobId }` | `{ jobId, status: "running" }`（异步执行，CreateUser 限频 20 次/秒，分批处理） | `FAILED_PRECONDITION` |
| `admin.import.status` | `{ jobId }` | `{ status, ok, failed, errors, credentialsFileUrl?(只能下载一次，10 分钟有效) }` | `NOT_FOUND` |
| `admin.user.list` / `admin.user.get` / `admin.user.update` | `{ query?, role?, status? }` / `{ userId, roles?, status?, displayName? }` | | |
| `admin.user.resetPassword` | `{ userId }` | `{ tempPassword }`（只显示一次），设置 `mustChangePassword` | |
| `admin.relation.upsert` / `admin.relation.revoke` | `{ kind: "guardianship"\|"teaching"\|"enrollment"\|"mentorship", ... }` | `{ id }`；写审计日志 | |
| `admin.invite.create` / `admin.invite.revoke` | `{ studentId, relation?, expiresInDays? }` / `{ inviteId }` | `{ code（明文只显示这一次）, expiresAt }` | |
| `admin.consent.report` | `{ classId? }` | `{ items: [{ studentId, displayName, status, grantedVersion? }] }` | |
| `admin.audit.query` | `{ actorUserId?, studentId?, action?, from, to, cursor? }` | `{ items }` | |
| `admin.retention.preview` / `admin.retention.archive` | `{ graduationYear }` | `{ affected }` | |
| `admin.export.student` | `{ studentId }` | `{ url, expiresAt }`；写审计日志 | |
| `admin.outbox.list` / `admin.outbox.retry` / `admin.outbox.cancel` | | | |
CSV 表头（导入模板放在 `templates/*.csv`）：
- `users.csv`：`role,email,phone,display_name_zh,display_name_en,student_no,programme,grade_level,homeroom_class,age_band,graduation_year`
- `guardianships.csv`：`parent_email_or_phone,student_no,relation,is_primary`
- `courses.csv`：`year,subject_code,course_name_zh,course_name_en,grade_level,homeroom_class`
- `teaching.csv`：`teacher_email,course_name_zh,role`
- `enrollments.csv`：`student_no,course_name_zh`
- `mentorships.csv`：`mentor_email,student_no,type`

## 13. 定时任务（只能由触发器调用，不对外提供）
| 函数 | 作用 |
|---|---|
| `cron-publish` | `tasks.status=scheduled && publishAt<=now` → 发布，流程和 `task.publish` 相同 |
| `cron-reminders` | 截止前 24 小时：`task_due_soon`（发给学生，家长按偏好决定）；截止已过：设置 `isOverdue`，发出 `task_overdue`（学生和家长，重要事件）；里程碑在截止前 7 天和 1 天发提醒，逾期时发给学生和家长；纠正 `tasks.stats` |
| `cron-weekly-digest` | 每天给 `mode=daily` 的用户生成每日摘要；周日给 `mode ∈ {weekly, immediate}` 的用户生成每周汇总 |
| `cron-retention` | 清理 tmp 文件；毕业生归档（`status=archived`，设置 `purgeAfter=归档时间+365天`）；到期删除数据，并调用 DeleteUsers 删除认证账号；写审计日志 |
| `cron-outbox-maintain` | 收回租约过期的领取；超过重试次数的标记为 `failed`；删除超过 90 天的 `sent` 记录 |

## 14. 仍需核实的 CloudBase 能力（会影响本 API 的实现）
| 项 | 状态 |
|---|---|
| 服务端用 `@cloudbase/manager-node`（v5+）的 `app.user.createUser` 或云 API `CreateUser` 批量建号（邮箱 + 密码），建出的账号能否直接用 `auth.signIn({ username: email, password })` 登录 | ⚠️ 两个接口都有文档，但“CreateUser 设置的 Email 字段能否作为 signIn 的 username”需要在 dev 环境实测；如果不行，就把 `Name` 设成邮箱的规范化形式，或者改用自定义登录 |
| 套餐允许的云函数数量、云函数超时时间（导入任务可能需要很久） | ⚠️ 需要按 Danny 的套餐确认；导入任务要分批，并且可以续跑 |
| 定时触发器的时区 | ⚠️ 需要在控制台确认 |
| 未认证的小程序能否使用 `jscode2session`、订阅消息，以及小程序能否关联这个 CloudBase 环境 | ⚠️ 第一期不依赖这些能力，接入小程序前再核实 |
