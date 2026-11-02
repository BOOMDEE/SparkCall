# SparkCall 架构与安全边界

## 请求与媒体路径

浏览器通过同源 REST API 登录、管理账户和提交呼叫请求；Worker 校验会话、号码、黑名单及通话参与者后才访问 Durable Objects。信令 WebSocket 承载 SDP、ICE candidate 和通话状态，Durable Objects 使用 hibernation 与持久化邀请以支持在线状态和短时重连。WebRTC 媒体直接走 peer-to-peer；网络受限时使用 Cloudflare Realtime TURN。音频不会经过 Durable Objects，也不会由应用录制。

```mermaid
sequenceDiagram
  participant A as 呼叫方浏览器
  participant W as Cloudflare Worker
  participant D as Durable Object
  participant B as 被叫浏览器
  participant T as Cloudflare TURN
  A->>W: 已认证的呼叫请求
  W->>W: 验证号码、封锁关系和忙线状态
  W->>D: 创建来电邀请
  D-->>B: Presence WebSocket 呼入通知
  A->>D: SDP / ICE 信令
  B->>D: SDP / ICE 信令
  A<<->>B: WebRTC 音频（可经 T 中继）
```

## 身份与会话

- 永久账号使用用户名和密码；密码仅以版本化 PBKDF2-SHA-256 哈希存储，使用 HttpOnly、Secure、SameSite cookie 维护会话。
- 临时身份使用随机内部 ID 与随机 SparkCall 号码，默认 24 小时过期。过期清理由 Worker cron 执行。
- 升级操作在事务中把同一用户记录转换为永久账号，因而保留符合条件的联系人和通话记录。
- 号码以 SQLite BINARY collation 区分大小写；用户 ID 与公开号码是独立字段。
- API 校验请求 Origin、强制输入长度/格式限制，并使用参数化 SQL。登录尝试在 D1 中原子计数；KV 非必需，避免缓存不可用时降低限流保护。

## 数据和权限

| 数据 | 存放位置 | 访问边界 |
| --- | --- | --- |
| 用户、会话、号码、联系人、黑名单、通话元数据、偏好 | Cloudflare D1 | 仅通过 Worker 校验会话后读写 |
| 呼叫信令、在线呼入邀请、短时重连状态 | SQLite-backed Durable Objects | Worker 使用内部随机 secret 调用；WebSocket 连接前核验参与者身份 |
| Web 静态资源 | Cloudflare Worker Assets | 公开网页；不含任何 server secret |
| WebRTC 中继媒体 | Cloudflare Realtime TURN | 浏览器只拿到绑定用户 ID 的短期 ICE credentials |

用户偏好 PATCH 在单个浏览器会话内通过队列串行发送；D1 使用原子 JSON 合并并递增 `version`，每次写入返回该次提交后的偏好快照和版本。这样可以避免同一会话的响应乱序覆盖，并减少多个会话并发更新不同字段时的丢失更新。

公共通话记录默认私有。公开由所有者显式开启，可撤销、设定过期时间并更改 slug。公开内容不包含邮箱、内部 ID、会话或凭据；参与者姓名仅在参与者明确授权后展示。公开记录页面设置 `noindex, nofollow`。临时用户通过记录专用的 HttpOnly capability cookie 保留后续管理/撤销能力；该能力不使用可预测记录 ID。

第三份迁移将记录所有者外键改为 `ON DELETE SET NULL`，并保留通话元数据快照，因此临时身份被清理后，独立 capability 仍可管理相应记录。此 Cookie 并不是跨设备恢复账号：丢失后可能无法恢复管理。自由备注与元数据值不具备自动个人信息脱敏能力，公开前必须审阅自行填写的内容。

## TURN 用量

Worker 使用 Cloudflare Realtime 官方 GraphQL Analytics 查询 `egressBytes`，并以 `customIdentifier` 区分用户。定时任务每小时轮转最多 25 个活动用户并将估算快照写入 D1。采样数据可能延迟或不完整，因此接口标记 `authoritative: false`。TURN 费用按 Cloudflare Realtime 的适用计费规则（包括适用的中继 egress）产生；`TURN_MONTHLY_QUOTA_BYTES` 只是展示配额，不是实时流量闸门或硬性消费上限。分析 API token 仅存在于 Worker secret，不会返回浏览器。

## 计划取舍与限制

- Workers Web Crypto 不提供原生 Argon2id 派生函数；本实现使用 310,000 轮 PBKDF2-SHA-256，并保存版本标记，便于以后更换哈希方案。
- D1 原子计数是强制登录限流；KV 绑定未启用，因为当前没有非关键缓存需要它。
- R2 用于头像或用户上传是可选能力，当前未启用。
- 自动化检查包含类型检查、lint、前端与后端单元测试、生产构建及隔离的本地 Worker/D1 HTTP 集成测试；详见 [testing.md](testing.md)。真实浏览器跨 NAT 音频、并发/多设备行为、不同浏览器扬声器切换及远端 Durable Object 生命周期仍需另外验收。
- 支付和 3DS 不属于本项目范围。生产部署目前暂停，不能把本地通过表述为已上线。
