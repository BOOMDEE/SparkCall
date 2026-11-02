# SparkCall

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)

SparkCall 是一个以隐私为先、可直接在浏览器中使用的互联网语音通话平台。它采用 React、TypeScript 和 WebRTC 构建前端，以 Cloudflare Workers、Durable Objects、D1 和 Realtime TURN 承担服务端与媒体中继；通话音频不由 SparkCall 录制。

> 当前为可运行的早期版本。浏览器和真实网络环境的跨 NAT 通话测试仍需在部署后完成；Cloudflare Realtime Analytics 也需要独立的只读分析令牌才能显示用量。

## 已实现功能

- 用户名/密码注册登录、24 小时临时账号、会话退出，以及临时账号升级为永久账号并保留同一身份。
- 区分大小写且数据库唯一约束保护的自定义 SparkCall 号码；临时账号使用随机号码。
- 浏览器 WebRTC 音频通话、Durable Object WebSocket 信令、呼入邀请、接听/拒接/取消/挂断、重连和超时处理。
- 麦克风静音、设备选择、回声消除、噪声抑制、自动增益和目标码率预设。
- 联系人、收藏、黑名单、呼叫历史与状态筛选。
- 默认私有的通话记录，可自定义 slug、编辑、设为公开/撤销、设置过期时间；匿名公开页 noindex，参与者只有明确同意后才显示。
- TURN 月度用量接口与估算仪表盘；TURN 媒体凭据仅在 Worker 服务端签发，且带短期有效期。
- 浅色/深色模式、响应式工作区、空/错/加载状态与键盘可用的表单交互。

## 技术架构

```text
Browser (React + WebRTC)
  ├── REST + authenticated WebSockets ──> Cloudflare Worker
  │                                         ├── D1: accounts, contacts, call metadata, records
  │                                         ├── Durable Objects: call signaling + presence
  │                                         └── Cloudflare Realtime TURN: short-lived ICE credentials
  └── encrypted peer media / TURN relay (audio is not routed through Durable Objects)
```

架构和安全边界见 [docs/architecture.md](docs/architecture.md)；Cloudflare API 依据见 [docs/cloudflare-references.md](docs/cloudflare-references.md)。

## 本地开发

需要 Node.js 22 或更新版本、npm 和 Python 3（仅迁移/本地工具验证时需要）。

```bash
npm ci
cp .dev.vars.example .dev.vars
# 为本地信令设置随机值；不要把 .dev.vars 提交到 Git
openssl rand -hex 32
```

把生成的随机值填入 `.dev.vars` 的 `SPARKCALL_INTERNAL_TOKEN`。如果使用 Vite 前端代理，把 `ALLOWED_ORIGIN` 设为 `http://localhost:5173`；若直接在 Wrangler 的 `http://localhost:8787` 上运行完整站点，可留空并使用同源默认值。配置 Cloudflare Realtime TURN key 后，浏览器才可在需要中继的网络中呼叫；没有 TURN 时只能依赖直连路径。

```bash
CI=1 npm run db:migrate:local
npm run build
npm run dev:worker
```

Worker 会在 `http://localhost:8787` 提供 API 和静态前端。若要用 Vite HMR，请在另一个终端运行 `npm run dev:web`，并先按上文设置 `ALLOWED_ORIGIN`；Vite 会将 `/api` 与 WebSocket 请求代理到 Wrangler。

## 检查与测试

```bash
npm run check       # 前后端严格 TypeScript 检查
npm run lint        # ESLint
npm test            # Vitest 单元测试
npm run build       # Vite 生产构建
npm run quality     # 上述检查的统一质量门禁
CI=1 npm run db:migrate:local
```

迁移按 `migrations/` 中编号顺序执行。`CI=1` 会让 Wrangler 在非交互环境中自动确认本地迁移。

## Cloudflare 部署

Worker、D1 binding、Durable Objects 和静态资源配置在根目录 `wrangler.jsonc`。D1 数据库 `sparkcall-db` 部署在 APAC。第一次部署前先应用迁移：

```bash
npx wrangler d1 migrations apply sparkcall-db --remote
npx wrangler deploy
```

在 Worker secrets 中配置 `SPARKCALL_INTERNAL_TOKEN`、`TURN_KEY_ID` 与 `TURN_API_TOKEN`。`TURN_ANALYTICS_API_TOKEN`（Account Analytics Read）用于月度用量；若未配置，用量区会明确显示不可用，而通话凭据仍可独立工作。按需要设置 `TURN_MONTHLY_QUOTA_BYTES`、`ADMIN_USER_IDS`、`SESSION_TTL_SECONDS` 和 `TEMP_SESSION_TTL_SECONDS`。不要把任何真实 secret 写入仓库、前端 bundle 或日志。

远程环境和 GitHub Actions 的具体步骤见 [docs/deployment.md](docs/deployment.md)。项目包括 CI、PR 构建预览和部署工作流；生产自动部署需要在 GitHub Actions secrets 中配置 `CLOUDFLARE_ACCOUNT_ID` 与最小权限的 `CLOUDFLARE_API_TOKEN`。部署工作流也提供 Wrangler device authorization 的手动入口。

## 已知限制

- Cloudflare Workers Web Crypto 没有原生 Argon2id 派生接口；当前使用 310,000 轮 PBKDF2-SHA-256，并在数据库中保存版本化哈希，未存储明文密码。
- TURN 用量基于 Cloudflare Realtime 自适应采样分析，是估算值而非实时、权威账单；当前配置配额用于展示，不会自动阻止呼叫。
- 扬声器切换取决于浏览器的 `setSinkId` 支持；媒体成功率仍需在真实设备、浏览器和 NAT 网络中验证。
- R2 上传和头像存储尚未启用；它们不是语音通话或记录功能的前置条件。

## 许可证与作者

本项目按 [Apache License 2.0](LICENSE) 发布。

作者：尹嘉骐。
