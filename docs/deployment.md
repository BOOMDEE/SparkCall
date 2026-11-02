# 部署 SparkCall

## 目标环境

- Cloudflare Worker 名称：`sparkcall`
- D1 数据库：`sparkcall-db`（APAC）
- 自定义域名：`https://app.example.com`
- Wrangler 配置：仓库根目录 `wrangler.jsonc`

## 一次性准备

1. GitHub Actions API token 仅授予目标 Cloudflare 账号的 **Workers Scripts: Edit** 和 **D1: Edit**，用于本工作流的 Worker 部署与 D1 migrations；不要把 TURN key 管理权限混入日常部署 token。也可从手动工作流选择设备授权。
2. 在 Cloudflare Worker secrets 中设置：
   - `SPARKCALL_INTERNAL_TOKEN`：至少 32 个随机字节；仅用于 Worker 到 Durable Object 的内部身份校验。
   - `TURN_KEY_ID`：Cloudflare Realtime TURN key 的 UID。
   - `TURN_API_TOKEN`：TURN key 创建后返回的一次性 key；仅保存在 Worker secret 中。
   - `TURN_ANALYTICS_API_TOKEN`：可选的 Account Analytics Read token，用于 GraphQL Realtime 用量统计。
3. 设置非敏感 Worker variables：`CLOUDFLARE_ACCOUNT_ID`、`TURN_MONTHLY_QUOTA_BYTES`，可选 `ADMIN_USER_IDS`、`SESSION_TTL_SECONDS` 和 `TEMP_SESSION_TTL_SECONDS`。`ADMIN_USER_IDS` 是逗号分隔的 SparkCall 内部 user ID。
4. 如用 GitHub Actions 自动部署，把 `CLOUDFLARE_ACCOUNT_ID` 和最小权限 `CLOUDFLARE_API_TOKEN` 添加到仓库 Actions secrets；不要把 token 写入 YAML。

TURN analytics token 与 TURN key 是不同凭据。未配置 analytics token 时，通话服务仍可签发 TURN credentials，但月度用量面板显示“未配置”。

## 本地开发和迁移

```bash
npm ci
cp .dev.vars.example .dev.vars
# 设置 SPARKCALL_INTERNAL_TOKEN，并按需配置 TURN 项
CI=1 npm run db:migrate:local
npm run build
npm run dev:worker
```

Vite HMR：另开终端运行 `npm run dev:web`，把 `.dev.vars` 中 `ALLOWED_ORIGIN` 设为 `http://localhost:5173`。完整工作区已由 Wrangler 静态资源配置提供在 `http://localhost:8787`。

## 手动 Cloudflare 部署

确认 `wrangler.jsonc` 中 D1 `database_id` 指向目标数据库后运行：

```bash
npx wrangler d1 migrations apply sparkcall-db --remote
npx wrangler deploy
```

首次部署创建两个 SQLite Durable Object classes、API/静态资源 binding，并应用 Durable Object class exports。自定义域名由 Workers custom domain binding 接入；不要为同一主机另行创建冲突的 A/AAAA 记录。

## GitHub Actions

- `test.yml`：push、PR 和手动运行质量门禁及本地 D1 migration 验证。
- `preview.yml`：对 PR 运行质量门禁并上传前端构建产物，供审阅下载；默认不公开部署未审阅代码。
- `deploy.yml`：手动运行时可选择 `api-token` 或 `device`。配置 GitHub Actions secrets 后，再把仓库 variable `CLOUDFLARE_DEPLOY_ENABLED` 设为 `true`，`Main` 分支 push 才会自动迁移并部署；默认关闭可避免尚未配置 credentials 时出现失败部署。device 模式会在日志中显示 Cloudflare verification URL/code，操作人需打开链接并批准，工作流随后继续运行。

**设备授权适用于人工手动部署；自动 push 部署应配置 API token。** 若使用 API token，保持最小权限并仅作为 GitHub Actions secret。工作流会先跑同一套质量检查，再应用 D1 migrations，最后部署 Worker 与静态资源。

## 发布后验证

1. 打开 `https://app.example.com`，确认首页、登录/注册和 SPA 子路由可加载。
2. 创建两个测试账号，在真实设备上验证自定义号码、联系人、黑名单、接听/拒接/取消及通话结束。
3. 通过不同网络（尤其蜂窝网与 NAT 后网络）验证 TURN fallback；只在 Worker secret 已正确设置后测试。
4. 检查通话记录默认私有、显式公开/撤销、过期和临时账号 capability cookie；不要用真实敏感内容做公开测试。
5. 在 Cloudflare Worker 日志确认无 secret 或 session token 输出。TURN Analytics 数据是估算值，不应视为账单最终值。

## 回滚与数据库

Worker 可回滚到先前版本，但不要回滚到不兼容当前 D1 schema 的旧代码。数据库 migration 是增量变更；发布前备份并采用向后兼容的 schema 变更。Durable Object class lifecycle 使用 declarative `exports`，不要把旧 `migrations` 数组混入当前 Worker 配置。
