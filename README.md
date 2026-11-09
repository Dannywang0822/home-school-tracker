# 家校联络平台

IB 国际学校（MYP / DP）家校联络平台。后端是腾讯云 CloudBase。当前包含统一 API、权限、通知队列，以及组织、CSV 导入、邀请码和知情同意。

设计文档在 [`docs/`](docs/README.md)。共享环境里的物理名称见 [`docs/naming.md`](docs/naming.md)。

## 本地运行

```bash
npm ci
npm test
npm run dev
```

浏览器打开 http://127.0.0.1:5173 。本地接口只在 `DEV_AUTH=1` 时启动（`npm run dev` 会带上），不会部署到 CloudBase。

演示账号都是虚构的，邮箱以 `@demo.school.local` 结尾，密码是 `DemoOnly-2026!`。例如家长 `p1@demo.school.local`，管理员 `a1@demo.school.local`。管理员登录后进入「管理」。邮箱验证码不会真的发信，验证码打印在 API 进程的日志里。

## 检查

```bash
npm run lint
npm run typecheck
npm test
npm run build:functions
node scripts/deploy.mjs
```

`node scripts/deploy.mjs` 默认只打印计划。没有 `TCB_ENV_ID`、`TENCENTCLOUD_SECRETID`、`TENCENTCLOUD_SECRETKEY` 时不会部署。环境变量名见 [`.env.example`](.env.example)。

## 还没有做的事

任务发布、批改、CAS 和 EE 还没做。用户导入不会调用腾讯云 CreateUser，等 CAM 密钥到位后再接。云函数在设置 `HST_DATA_BACKEND=cloudbase` 之前会拒绝访问。
