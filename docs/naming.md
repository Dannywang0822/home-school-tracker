# 物理命名（hst_ 前缀）

设计文档里的集合名、云函数名和存储目录是**逻辑名**。本仓库部署到与其他应用共用的 CloudBase 环境 `english-little-steps-d0a2b84764b`（上海），所以物理名一律加 `hst_` 前缀。代码、安全规则 JSON、索引和 `cloudbaserc.json` 以物理名为准。

| 逻辑名 | 物理名 |
|---|---|
| 集合 `users` | `hst_users` |
| 云函数 `api-core` | `hst_api_core`（连字符改成下划线） |
| 云函数 `cron-publish` | `hst_cron_publish` |
| 存储 `tmp/` | `hst_tmp/` |
| 存储 `vault/` | `hst_vault/` |

实现时多出来的集合：`hst_idempotency`，用来保存 10 分钟内的写请求结果。客户端同样不能读写。

`cloudbaserc.json` 里的 `envId` 是占位符。部署脚本从环境变量 `TCB_ENV_ID` 读取，避免在没有确认的情况下对共享环境执行部署。
