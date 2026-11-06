# 部署 SparkCall

## 目标环境

- Cloudflare Worker 名称：`sparkcall`
- D1 数据库名称：`sparkcall-db`；数据库 UUID 不写入仓库
- 自定义域名：由 `SPARKCALL_HOSTNAME` 提供，必须属于当前 Cloudflare 账号中的活动 Zone
- Wrangler 配置：仓库根目录 `wrangler.jsonc`，其中 D1 UUID 和域名是安全占位值

仓库已有预发布公开预览，且没有生产 SLA 或真实跨网络音频验收承诺。以下步骤描述后续手动部署流程；自动部署保持关闭，每次发布仍需项目所有者明确批准。

## 一次性准备

1. GitHub Actions API token 仅授予目标 Cloudflare 账号的 **Workers Scripts: Edit** 和 **D1: Edit**，用于本工作流的 Worker 部署与 D1 migrations；不要把 TURN key 管理权限混入日常部署 token。也可从手动工作流选择设备授权。
2. 在 Cloudflare Worker secrets 中设置：
   - `INTERNAL_SIGNALING_TOKEN`：至少 32 个随机字节；仅用于 Worker 到 Durable Object 的内部身份校验。
   - `TURN_KEY_ID`：Cloudflare Realtime TURN key 的 UID。
   - `TURN_API_TOKEN`：TURN key 创建后返回的一次性 key；仅保存在 Worker secret 中。
   - `SPARKCALL_WEBHOOK_ENCRYPTION_KEY`：用于加密 incoming-call webhook URL 的 32-byte 随机密钥，以 Base64 文本保存（可用 `openssl rand -base64 32` 生成）。
   - `TURN_ANALYTICS_API_TOKEN`：管理员 Cloudflare 用量与 TURN 限额检查所需的 Cloudflare API token；仅授予目标账号 **Account Analytics Read**，Analytics 查询按 `TURN_KEY_ID` 过滤，不要扩大权限。
3. 设置非敏感 Worker variables：`CLOUDFLARE_ACCOUNT_ID`、`ADMIN_USER_IDS`、`TURN_MONTHLY_QUOTA_BYTES` 和 `TURN_PLATFORM_MONTHLY_LIMIT_BYTES`，以及可选的 `SESSION_TTL_SECONDS` 和 `TEMP_SESSION_TTL_SECONDS`。本部署的 `TURN_PLATFORM_MONTHLY_LIMIT_BYTES` 为 `800000000000`（800 十进制 GB/UTC 自然月）。`ADMIN_USER_IDS` 是逗号分隔的 SparkCall 内部 user ID；未配置或未匹配时，所有管理员接口 fail-closed。
4. 在 GitHub Actions repository variables 中设置非敏感的 `D1_DATABASE_ID`、`SPARKCALL_HOSTNAME` 与 `ADMIN_USER_IDS`。正常发布要求 `ADMIN_USER_IDS`；仅一次性注册 bootstrap 可暂时留空。手动部署工作流会在临时 runner 中替换安全占位值；这些值不应写进 Git。
5. `deploy.yml` 从 `CLOUDFLARE_ACCOUNT_ID` Actions secret 及 `ADMIN_USER_IDS` repository variable 注入非秘密 Worker variables；同一 account ID 也用于部署定位。仅当项目所有者批准并手动 dispatch `api-token` 模式时，才配置最小权限 `CLOUDFLARE_API_TOKEN` Actions secret；不要把 token 写入 YAML。

TURN Analytics token 与 TURN key 是不同凭据。未配置 Analytics token 或 TURN key ID 时，通话服务仍可签发 TURN credentials，但项目级用量不可用；若配置了 TURN 执行限额，缺少可用采样时会 fail-open，仍允许新凭据并可能超额。平台总限额只过滤当前配置的 `TURN_KEY_ID`，不计同账号其他 TURN key；若其他应用共用此 key，其流量会一并计入。正常发布预检要求 Analytics Worker Secret 已存在；下面记录的一次性注册 bootstrap 是唯一例外。

## 一次性注册 bootstrap

`deploy.yml` 的 `bootstrap_registration` 默认关闭。只有为修复注册而进行的一次手动发布才可打开，并且必须同时选择 `auth_method=device`；工作流会拒绝 API-token 模式，也要求 repository variable `ADMIN_USER_IDS` 为空。它仅跳过 `TURN_ANALYTICS_API_TOKEN` 名称预检，其余必需 Worker secrets、测试、D1 migrations 和人工 Cloudflare device authorization 仍照常执行。它不会创建或扩大任何 Cloudflare API token 权限。

部署时 Worker 的管理员 allowlist 为空，因此所有管理员 API 继续 fail-closed；Cloudflare 账号级用量不可用，且任何已启用的 TURN 执行限额在采样不可用时 fail-open。公开账号级用量仍默认关闭。注册成功后，先把新账号的内部 user ID 写入 `ADMIN_USER_IDS`，再通过安全方式配置一个已有且仅有 **Account Analytics Read** 权限的 `TURN_ANALYTICS_API_TOKEN`；随后执行正常发布。bootstrap 完成后应移除该临时发布例外，不能把它当作常规部署模式。

## 首次部署 bootstrap

`deploy.yml` 是更新工作流，不负责首次创建 Worker。首次运行前，先在 Cloudflare 中创建名为 `sparkcall` 的 Worker，并确保它没有 `workers.dev` 地址、route 或自定义域名绑定；然后直接在此未公开 Worker 上配置上节所列必需 secrets。工作流会在远端迁移前检查 Worker 和 secret 名称；检查通过后才应用 D1 migrations 并部署代码，届时才绑定 `SPARKCALL_HOSTNAME`。如果 Worker 或任何必需 secret 缺失，流程会在数据库和 Worker 写入前停止。

## 本地开发和迁移

```bash
npm ci
cp .dev.vars.example .dev.vars
# 设置 INTERNAL_SIGNALING_TOKEN、SPARKCALL_WEBHOOK_ENCRYPTION_KEY，并按需配置 TURN 项
CI=1 npm run db:migrate:local
npm run build
npm run dev:worker
```

Vite HMR：另开终端运行 `npm run dev:web`，把 `.dev.vars` 中 `ALLOWED_ORIGIN` 设为 `http://localhost:5173`。完整工作区已由 Wrangler 静态资源配置提供在 `http://localhost:8787`。

## 手动 Cloudflare 部署

使用 GitHub Actions 时，先配置 `D1_DATABASE_ID` 与 `SPARKCALL_HOSTNAME` repository variables；工作流会在一次性 runner 中注入它们。直接使用 Wrangler 时，可在本地临时替换 `wrangler.jsonc` 中的安全占位值后运行；不要提交包含真实账户标识或部署域名的配置：

```bash
npx wrangler d1 migrations apply sparkcall-db --remote
npx wrangler deploy
```

首次部署创建两个 SQLite Durable Object classes、API/静态资源 binding，并应用 Durable Object class exports。自定义域名必须属于该 Cloudflare 账号内的活动 Zone；若域名由其他提供方管理且未接入此账号，Cloudflare 无法将其绑定为 Worker Custom Domain。不要为同一主机另行创建冲突的 A/AAAA 记录。

## GitHub Actions

- `test.yml`：push、PR 和手动运行质量门禁，以及隔离本地 D1/HTTP/WebSocket 集成测试。
- `preview.yml`：对 PR 运行质量门禁并上传前端构建产物，供审阅下载；默认不公开部署未审阅代码。
- `deploy.yml`：仅支持明确的手动 workflow dispatch，可选择 `api-token` 或 `device`；没有 push 触发器，也不会因设置仓库变量而自动部署。`bootstrap_registration` 默认关闭，只有一次性注册修复可打开，且强制 device 模式。device 模式会在日志中显示 Cloudflare verification URL/code，操作人需打开链接并批准，工作流随后继续运行。

**公开预览不等于生产验收。** 只有项目所有者明确批准后，授权操作员才应手动启动工作流。若使用 API token，保持最小权限并仅作为 GitHub Actions secret；部署工作流会先运行质量检查和 `npm run test:integration`，全部成功后才允许认证、应用远端 D1 migrations 并部署 Worker 与静态资源。

在远端迁移或部署前，工作流会只读列出目标 Worker 上的 secret 名称，并确认 `INTERNAL_SIGNALING_TOKEN`、`TURN_KEY_ID`、`TURN_API_TOKEN` 和 `SPARKCALL_WEBHOOK_ENCRYPTION_KEY` 已配置；正常发布还要求 `TURN_ANALYTICS_API_TOKEN`。仅当一次性注册 bootstrap 被显式选中时，才允许暂缺 Analytics secret。预检不会读取、打印或传输 secret 值；缺失其他必需名称即停止。该预检不替代对 Worker 运行行为的实际验证。

所有第三方 Actions 都固定到已核对的官方完整提交 SHA，而非可变的 `@v4` 标签：[checkout](https://github.com/actions/checkout/commit/11d5960a326750d5838078e36cf38b85af677262)、[setup-node](https://github.com/actions/setup-node/commit/49933ea5288caeca8642d1e84afbd3f7d6820020)、[upload-artifact](https://github.com/actions/upload-artifact/commit/ea165f8d65b6e75b540449e92b4886f43607fa02)。升级时应核对官方来源并审阅差异后更新 SHA。

## 发布后验证

1. 打开 `https://<SPARKCALL_HOSTNAME>`，确认首页、登录/注册和 SPA 子路由可加载。
2. 创建两个测试账号，在真实设备上验证自定义号码、联系人、黑名单、接听/拒接/取消及通话结束。
3. 通过不同网络（尤其蜂窝网与 NAT 后网络）验证 TURN fallback；只在 Worker secret 已正确设置后测试。
4. 检查通话记录默认私有、显式公开/撤销、过期和临时账号 capability cookie；不要用真实敏感内容做公开测试。
5. 在 Cloudflare Worker 日志确认无 secret 或 session token 输出。TURN Analytics 数据是估算值，不应视为账单最终值；TURN 费用按 Cloudflare Realtime 的实际计费规则（包括中继 egress 等适用项目）产生。`TURN_MONTHLY_QUOTA_BYTES` 仅用于界面展示；`TURN_PLATFORM_MONTHLY_LIMIT_BYTES` 按当前 TURN key 的 egress 样本阻止后续新 TURN 凭据分配，但会因 Analytics 延迟而超额，Analytics 不可用时 fail-open，且不会中断现有通话；成功 P2P 直连不计入。

## 回滚与数据库

Worker 可回滚到先前版本，但不要回滚到不兼容当前 D1 schema 的旧代码。安全回滚顺序是先暂停后续发布、确认目标 Worker 版本与现有 schema 兼容，再回滚 Worker；不要反向删除已应用的 D1 migration。数据库 migration 是增量变更；发布前备份并采用向后兼容的 schema 变更。Durable Object class lifecycle 使用 declarative `exports`，不要把旧 `migrations` 数组混入当前 Worker 配置。
