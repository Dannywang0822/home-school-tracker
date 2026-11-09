# 安全规则与权限设计

> **物理名**：规则 JSON 在 `infra/rules/`，集合、云函数和存储路径都使用 `hst_` 前缀。见 [naming.md](naming.md)。第 1 周的规则测试在本地解释这些 JSON，还没有对真实 CloudBase 执行。

> 目标（来自 `../prompt.md`）：权限按角色和亲子、任教、指导关系校验，上线前做审计并写测试；家长只能看自己的孩子，老师只能看任教班级，导师只能看所带学生；涉及未成年人数据要最少采集、不公开任何页面、关键操作留日志。

## 1. 总体思路：客户端几乎不直连，规则默认全拒绝，业务权限全部在云函数里校验

**CloudBase 本身的事实**（已经对照官方文档核实，见 §8）：
1. 数据库安全规则**只约束客户端**（Web/小程序 SDK 直连）。云函数里用服务端 SDK 访问数据库**不受规则限制**，所以云函数必须自己做权限校验。
2. 规则是**文档级**的，不能控制单个字段（“对文档的属性访问控制目前还不支持”）。比如“家长能读成绩但看不到草稿评语”这类需求，只能靠云函数投影返回。
3. 集合查询时，**查询条件必须是规则的子集**；规则里用了 `doc.x`，查询条件就必须包含 `x`，否则直接拒绝。
4. 可以用 `get('database.集合.文档ID')` 跨文档校验，但有限制：**一个表达式最多 3 个 `get`、最多访问 10 个不同文档、最多嵌套 2 层**；如果 `get` 参数里用了 `doc.x`，查询条件必须以 `==` 或 `in`（数组只能有一个元素）的形式包含 `x`；每次 `get` 都按读操作计费；单条表达式不超过 1024 字符。
5. Web 端身份用 `auth.uid`，小程序端用 `auth.openid`。`auth.loginType` 的取值有 `EMAIL`、`CUSTOM`、`ANONYMOUS` 等。
6. 云函数的调用规则只支持 `true`、`false`、`"auth != null"`、`"auth.loginType != 'ANONYMOUS' && auth != null"`，不能写更细的条件。

**由此得出的设计**：
- **除了 `notifications`，所有集合的规则都是 `{"read": false, "write": false}`**。一对多关系（家长 → 多个孩子 → 多个教学班 → 任务）用 `get()` 表达不了，或者会超出 3 个 `get` 的限制，而且字段级脱敏（草稿成绩、仅老师可见的反思、家长不能看的邮箱）只能在云函数里做。
- 所有读写都通过云函数 API（`api.md`），在云函数里统一使用 `authz` 模块做关系校验。小程序以后也调用同一组函数，不用改后端。
- 客户端唯一的直读需求：`notifications` 的实时未读（`watch()`），规则是 `doc.recipientAuthUid == auth.uid`。
- **关闭匿名登录**；云函数调用规则设为 `"auth.loginType != 'ANONYMOUS' && auth != null"`。只有 `auth-public` 函数（微信 code 换票据、读取政策文本）是 `true`，这个函数内部自己限流。
- **网关（OPA）策略**只放行实际用到的函数路径，HTTP API 不放行数据库和存储资源。

## 2. 数据库安全规则草案（每个集合单独配置）

### 2.1 默认（除 `notifications` 外的全部集合）
```json
{ "read": false, "write": false }
```
适用集合：`users` `student_profiles` `auth_identities` `invite_codes` `consent_policies` `consents` `schools` `academic_years` `terms` `grades` `classes` `subjects` `courses` `teaching_assignments` `enrollments` `guardianships` `mentorships` `tasks` `task_progress` `submissions` `files` `assessment_criteria` `dp_components` `assessments` `term_summaries` `threads` `messages` `thread_reads` `notification_prefs` `outbox` `cas_experiences` `cas_reflections` `cas_evidence` `cas_reviews` `cas_projects` `cas_summaries` `milestone_templates` `milestone_plans` `milestone_items` `rppf_entries` `audit_logs` `import_jobs` `cron_locks` `rate_limits`

> 即使是 `subjects`、`assessment_criteria` 这类不含个人信息的字典表，也走 API 读取（缓存在前端），保证“没有任何公开数据面”，审计时也更简单。

### 2.2 `notifications`
```json
{
  "read": "auth != null && auth.loginType != 'ANONYMOUS' && doc.recipientAuthUid == auth.uid",
  "write": false
}
```
- 客户端查询必须写成 `db.collection('notifications').where({ recipientAuthUid: <当前 uid> }).orderBy('createdAt','desc').limit(50).watch(...)`，查询条件要包含 `recipientAuthUid`，否则会被拒绝。
- 通知正文只放最少的内容（不放分数和评语，见 `data-model.md` §6.1），万一配置出错，泄露面也最小。
- 小程序端没有 `auth.uid`，所以小程序通过 `notify.list` API 读取通知，不直读这个集合。

### 2.3 备选方案（不启用，留作参考）：用 `get()` 让家长直读 `task_progress`
如果以后为了性能要让客户端直读，可以这样写，但**第一期不采用**：
```json
{
  "read": "get(`database.guardian_index.${auth.uid}`).studentIds[doc.studentId] == true",
  "write": false
}
```
- 需要额外维护 `guardian_index`（`_id = authUid`，`studentIds` 是一个 map），并且查询条件必须包含 `studentId ==`。
- 不采用的原因：成绩草稿、仅老师可见的反思这类数据需要字段级控制，规则做不到；而且两套权限路径会让测试和审计翻倍。

## 3. 云函数权限模型（`packages/core/authz`）

### 3.1 请求上下文
```ts
type Caller = {
  userId: string;            // users._id
  roles: Role[];
  schoolId: string;
  client: 'web' | 'mp';
  consentOk: boolean;        // 家长：所有孩子都已同意；学生：本人或监护人已同意
};
// 解析顺序：getUserInfo() → uid 或 openId/customUserId → auth_identities → users
// 找不到对应用户 / 账号被封禁 → UNAUTHENTICATED / ACCOUNT_DISABLED
// 学生未完成同意 → 只放行 me.get、consent.*、auth.*
```

### 3.2 关系判定函数（只返回布尔值，结果在单次请求内缓存）
| 函数 | 成立条件 |
|---|---|
| `isGuardianOf(c, studentId)` | `guardianships` 里有 `{parentId: c.userId, studentId, status:'active'}` |
| `isSelf(c, studentId)` | `student_profiles[studentId].userId == c.userId` |
| `teachesCourse(c, courseId)` | `teaching_assignments` 里有 `{teacherId: c.userId, courseId}`，并且没有结束 |
| `teachesStudent(c, studentId)` | 有某个 `courseId`，同时满足 `teachesCourse` 和该学生在这个教学班的 active 选课记录 |
| `isHomeroomOf(c, studentId)` | 该学生行政班的 `homeroomTeacherIds` 包含 `c.userId` |
| `mentors(c, studentId, type?)` | `mentorships` 里有 `{mentorId: c.userId, studentId, status:'active', type}` |
| `isCasCoordinator(c)` / `isEeCoordinator(c)` / `isAdmin(c)` | 角色判断（CC 的范围受 `settings.casCoordinatorScope` 控制） |

### 3.3 学生数据访问矩阵（`canAccessStudent(c, studentId, resource, op)`）
| 资源 | S 本人 | P（自己的孩子） | T（任教） | 班主任 | SV（所带学生） | CC | EC | A |
|---|---|---|---|---|---|---|---|---|
| 任务、完成状态 | 读写 | 读 | 读写（仅本教学班的任务） | 读 | — | — | — | 读 |
| 提交与附件 | 读写 | 读 | 读 | — | — | — | — | 读（写审计日志） |
| 成绩（`released`） | 读 | 读 | 读写（含草稿） | 读 | — | — | — | 读 |
| 对话串 | 读写 | 读写（`visibility=all`） | 读写（`staffUserIds` 里有自己） | 读 | 读写（自己负责的 context） | 读写（CAS context） | — | 读（写审计日志） |
| CAS | 读写 | 读 | — | — | 读写审核（`CAS_ADVISOR`） | 读写审核 | — | 读 |
| 里程碑、RPPF | 读写 | 读（`visibleToGuardian`） | 读（IA：任课老师） | — | 读写审核（对应类型） | 读（CAS 访谈） | 读写 | 读 |
| 档案字段（学号、班级） | 读 | 读 | 读（只返回名字和学号） | 读 | 读（只返回名字） | 读 | 读 | 读写 |
| 家长联系方式 | — | 读自己的 | **不返回** | 读（姓名，以及是否接收邮件） | **不返回** | — | — | 读写 |

### 3.4 统一的拒绝策略
- 涉及他人资源时，**一律返回 `NOT_FOUND`**（不返回 `PERMISSION_DENIED`），避免别人通过错误码判断某个 ID 是否存在。只有“自己的资源，但操作不允许”（例如学生修改已批改的提交）才返回 `PERMISSION_DENIED`。
- 每次拒绝都写 `audit_logs`（`action = authz.denied`，`result = denied`）。同一用户 10 分钟内被拒绝超过 20 次时，通知管理员。
- 列表接口**只能从关系出发查询**（例如先查 `guardianships` 得到 studentIds，再用 `studentId in [...]` 查询），**不允许**接收客户端传来的任意 `studentId` 去拼查询条件后再过滤。
- 返回结果统一经过 `project(resource, role)` 白名单投影，新加的字段默认不返回。

### 3.5 代码约定（交给编码助手时必须遵守）
1. 每个 action 在注册表里声明 `{ name, roles, input: zodSchema, scope: (c, input) => Promise<boolean>, audit?: ActionName }`，**没有声明 `scope` 的 action 无法注册**（启动时检查）。
2. 云函数只能通过 `repo.*` 访问数据库，`repo` 的所有查询函数都要求传入经过授权的 `studentIds` 或 `courseIds`。
3. 禁止在云函数里使用客户端传来的 `userId` 作为“当前用户”。

## 4. 云函数调用规则与网关策略
```json
{
  "*":            { "invoke": "auth.loginType != 'ANONYMOUS' && auth != null" },
  "auth-public":  { "invoke": true },
  "cron-publish": { "invoke": false },
  "cron-reminders": { "invoke": false },
  "cron-weekly-digest": { "invoke": false },
  "cron-retention": { "invoke": false },
  "cron-outbox-maintain": { "invoke": false }
}
```
- 定时触发器不受这份规则约束（已核实），所以 `cron-*` 设为 `false` 可以防止客户端调用。
- 网关策略：只放行 `functions:/api-*`、`functions:/auth-public`、`functions:/ops`，其余全部拒绝。`ops` 函数在函数内部再校验调用者是否有 `ops_mailer` 角色。

## 5. 云存储规则
目录约定：
- `tmp/{yyyymmdd}/{random}`：客户端上传的临时文件
- `vault/{schoolId}/{refType}/{refId}/{fileId}`：云函数校验后复制过来的正式文件

```json
{
  "read": false,
  "write": "auth != null && auth.loginType != 'ANONYMOUS' && /^tmp\\//.test(resource.path)"
}
```
- 客户端**只能往 `tmp/` 写**，不能读任何文件。上传后调用 `file.commit`：云函数校验大小、MIME 类型和用途关系，把文件复制到 `vault/`（服务端上传，客户端规则不允许访问），写入 `files` 记录，然后删除 tmp 文件。`cron-retention` 每天清理超过 24 小时的 tmp 文件。
- 下载：`file.getUrl` 校验权限后，用服务端 `getTempFileURL` 签发 **600 秒**有效的链接。教职工下载学生文件时写审计日志。
- ⚠️ 待验证：“`write` 规则包含删除，以及规则里能否用 `resource.path` 正则判断还没上传的新文件”这一点，要在 dev 环境实测（见 §7 的 ST-03 / ST-04）。如果实测不通过，备选方案是云函数接收 base64 分片上传（≤ 6MB），或者改成在 `write` 规则里用 `resource.openid == auth.uid` 的模板。

## 6. 其他安全措施
- 关闭匿名登录；密码强度：8–32 位，至少包含三类字符（和 CreateUser 的要求一致）；登录失败限流使用 CloudBase 自带能力，另外在云函数里对邀请码兑换和验证码发送做限流。
- 所有密钥（CreateUser 用的 SecretId/SecretKey、自定义登录私钥、邀请码 pepper）放在云函数环境变量中；**不进仓库，不进前端**。
- 邮件和通知正文最少化；邮件里的链接不带任何令牌，必须登录后才能看到内容。
- 日志（`console`）里不打印学生姓名、评语和邮箱，只打印 ID。
- 数据导出（家长或学生申请）由管理员审批后生成 ZIP，链接 10 分钟内有效，写审计日志。

## 7. 规则与权限测试用例清单

### 7.1 测试方式
- **规则测试（DB/Storage）**：`tests/rules/*.spec.ts`。在 dev 环境用 `@cloudbase/js-sdk` 以真实测试账号登录（每个角色一个账号）后直连数据库，断言结果是 `DATABASE_PERMISSION_DENIED`（或者查到 0 条）。
- **API 权限测试**：`tests/authz/*.spec.ts`
  1. 单元测试：`authz` 关系函数加上内存版 `repo`；
  2. 集成测试：在 dev 环境调用真实云函数。
- **全接口矩阵测试（自动生成）**：遍历 action 注册表，对每个接受 `studentId`、`taskId`、`threadId`、`fileId`、`planId`、`experienceId`、`assessmentId`、`progressId`、`courseId` 的 action，用“外人”身份传入属于其他学生的 ID，断言返回 `NOT_FOUND` 或 `PERMISSION_DENIED`，并且返回体里**不包含**这个学生的任何字段值（用一个随机“金丝雀字符串”嵌入目标学生的数据，然后在响应里搜索这个字符串）。
- CI：每次 PR 都跑单元测试和矩阵测试（用 mock），合并到主分支后在 dev 环境跑集成测试；**上线前要求全部通过，并输出报告 `reports/security-audit.md`**。

### 7.2 测试夹具
- 学校 SCH1：MYP4-A 班（学生 S1、S2），DP1-A 班（学生 S3、S4）。
- 家长 P1 → S1；家长 P2 → S2；家长 P3 → S3、S4（多孩子）；家长 P4 的绑定关系已经撤销（曾经绑定 S1）；P5 已注册但没有绑定任何孩子。
- 老师 T1 教 MYP4-A 的科学；T2 教 DP1-A 的物理；T3 没有任教关系。
- SV1 是 S3 的 EE 导师；CC1 是 CAS 协调员；A1 是管理员；OPS1 是运营 bot 账号。
- 每个学生的任务、提交、成绩（草稿和已发布各有）、对话串（含 `staff_student` 消息）、CAS、里程碑、文件都放了“金丝雀字符串”。

### 7.3 证明“家长读不到别人孩子的任何数据”（P1 vs S2，必须全部通过）
| ID | 场景 | 期望 |
|---|---|---|
| PX-01 | P1 直连数据库，`where({})` 查询 `task_progress`、`assessments`、`messages`、`cas_experiences`、`milestone_items`、`files`、`student_profiles`、`guardianships`、`users` 等**全部集合** | 每个集合都是 `DATABASE_PERMISSION_DENIED` |
| PX-02 | P1 直连数据库，`doc(S2 的 progressId).get()` | 拒绝 |
| PX-03 | P1 `watch` `notifications`，条件是 `recipientAuthUid == P2 的 uid` | 拒绝 |
| PX-04 | P1 `watch` `notifications` 不带条件 | 拒绝（查询条件不是规则的子集） |
| PX-05 | P1 调用 `task.get`，传 S2 的 `studentId` 和 S1、S2 共有的 `taskId` | `NOT_FOUND`；不返回 S2 的状态 |
| PX-06 | P1 调用 `progress.listByStudent`、`assessment.listByStudent`、`summary.get`、`dashboard.parent`，参数是 `studentId = S2` | 全部 `NOT_FOUND` |
| PX-07 | P1 调用 `thread.get` / `message.list` / `message.post`，传 S2 的 threadId | `NOT_FOUND`；不写入任何消息 |
| PX-08 | P1 调用 `file.getUrl`，传 S2 提交的 fileId | `NOT_FOUND`，不签发链接 |
| PX-09 | P1 直接用 S2 文件的 `cloud://` ID 调用客户端 `getTempFileURL` / `downloadFile` | 存储规则拒绝 |
| PX-10 | P1 调用 `cas.list` / `milestone.getPlan` / `rppf.get`，参数是 S2 的 ID | `NOT_FOUND` |
| PX-11 | P1 调用 `course.roster`（家长不应有这个接口的权限） | `PERMISSION_DENIED` |
| PX-12 | P1 调用 `dashboard.parent`（不传参数） | 只返回 S1；响应里搜索不到 S2 的金丝雀字符串 |
| PX-13 | P1 调用 `notify.list` | 只有自己的通知 |
| PX-14 | P1 用猜测或暴力方式兑换邀请码（第 6 次） | `RATE_LIMITED`；审计日志里有 denied 记录 |
| PX-15 | P1 兑换 S2 的**已使用**或**已过期**的邀请码 | `INVITE_INVALID`；不创建绑定关系 |
| PX-16 | P4（绑定已撤销）访问 S1 的任意数据 | `NOT_FOUND` |
| PX-17 | P5（没有孩子）访问家长首页 | 引导去绑定，没有数据 |
| PX-18 | P3（多孩子）切换孩子 | 只能看到 S3、S4，混合查询不会带出 S1 或 S2 |
| PX-19 | P1 通过 CAS 项目接口看到 S2（同一项目的成员） | 只有 S2 的显示名，没有 S2 的经历、反思或证据 |
| PX-20 | 给 S1 发的邮件 | `outbox.to` 只有 S1 的 active 家长和 S1 本人；不包含 P2 |
| PX-21 | 别人篡改请求体里的 `callerUserId` 或 `parentId` 字段 | 被忽略；身份只从运行时上下文解析 |
| PX-22 | P1 调用 `assessment.listByStudent(S1)` | 只返回 `released` 的成绩；`staff_student` 的消息不返回 |

### 7.4 老师、导师、学生的隔离
| ID | 场景 | 期望 |
|---|---|---|
| TX-01 | T3（无任教关系）调用 `task.create`，传入 MYP4-A 科学课的 courseId | `NOT_FOUND` |
| TX-02 | T1 读取 DP1-A 学生 S3 的成绩、对话串、文件 | `NOT_FOUND` |
| TX-03 | T1 给 S1 打的 Criteria 不在任务关联的范围内（例如任务只关联了 A，却提交了 D） | `INVALID_ARGUMENT` |
| TX-04 | T1 打分超出范围（MYP 打 9 分，DP 打 8 分） | `INVALID_ARGUMENT` |
| TX-05 | T1 的任教关系结束后再访问 | `NOT_FOUND` |
| TX-06 | T1 调用 `student.contacts` 获取家长手机号或邮箱 | 字段不返回 |
| MX-01 | SV1 读取 S4 的 EE（不是自己所带的学生） | `NOT_FOUND` |
| MX-02 | SV1 读取 S3 的任务成绩（导师关系不包括成绩） | `NOT_FOUND` |
| MX-03 | CC1 审核 MYP 学生（没有 CAS） | `FAILED_PRECONDITION` |
| SX-01 | S1 读取 S2 的任何数据 | `NOT_FOUND` |
| SX-02 | S1 修改自己已批改的提交，或者修改 `assessments` | `PERMISSION_DENIED` |
| SX-03 | S1（未满 14 岁，监护人没有同意）调用任意业务 API | `CONSENT_REQUIRED` |
| SX-04 | S3 修改 CAS 经历的 `achievedOutcomes` 字段 | 被忽略；只有审核人可以写 |
| SX-05 | S3 在导师签字后修改 RPPF | `FAILED_PRECONDITION` |

### 7.5 系统与基础设施
| ID | 场景 | 期望 |
|---|---|---|
| ST-01 | 匿名登录 | 控制台已关闭；SDK 调用失败 |
| ST-02 | 未登录直接调用 `api-*` 云函数 / HTTP API | 被拒绝（调用规则 + 网关策略） |
| ST-03 | 已登录客户端上传到 `vault/...` | 存储规则拒绝 |
| ST-04 | 已登录客户端读取 `tmp/` 里自己刚上传的文件、删除别人的 tmp 文件 | 拒绝（需实测确认） |
| ST-05 | 客户端调用 `cron-*` 函数 | 被拒绝 |
| ST-06 | 非 `ops_mailer` 角色调用 `ops.claimOutbox` | `PERMISSION_DENIED` |
| ST-07 | OPS1 调用业务 API（例如 `task.get`） | `PERMISSION_DENIED`（OPS 账号只有发件权限） |
| ST-08 | 两个 OPS 实例同时领取发件队列 | 同一封邮件只会被一个实例领到（乐观锁） |
| ST-09 | `audit_logs` 的更新或删除接口 | 不存在；客户端规则拒绝 |
| ST-10 | 在审计日志、云函数日志里搜索金丝雀评语 | 搜索不到 |
| ST-11 | 修改安全规则后的回归测试 | 规则 JSON 纳入仓库（`infra/rules/*.json`），CI 对比 diff 并重新跑 PX 和 ST 用例 |

## 8. 本文依据的 CloudBase 能力（官方文档核实情况）
| 能力 | 结论 | 来源 |
|---|---|---|
| 规则变量 `auth.uid`、`auth.openid`、`auth.loginType`、`doc`、`request.data`、`now` | ✅ 已核实 | docs.cloudbase.net/rule/learn-rules；cloud.tencent.com/document/product/876/41802 |
| `get('database.集合.文档ID')` 及限制（3 个、10 个文档、嵌套 2 层、`doc` 字段必须出现在查询条件中） | ✅ 已核实 | docs.cloudbase.net/rule/reference/function |
| 规则只约束客户端，不能控制单个字段，查询条件必须是规则的子集 | ✅ 已核实 | 876/41802；docs.cloudbase.net/database/security-rules |
| 云函数调用规则只支持 `auth != null` 类表达式；定时触发器不受这些规则约束 | ✅ 已核实 | docs.cloudbase.net/cloud-function/security-rules |
| 存储规则变量 `resource.openid`、`resource.path` 以及正则 `.test()` | ✅ 已核实语法；⚠️ 对“还没上传的新文件”能否用 `resource.path` 判断需要实测 | docs.cloudbase.net/rule/learn-rules；/en/storage/security-rules |
| 数据库实时推送 `watch()` 受安全规则约束 | ✅ 已核实 | docs.cloudbase.net/database/realtime |
