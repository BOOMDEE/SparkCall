# SparkCall

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)

> **Version 0.1.0 · Early status / 早期版本**
>
> SparkCall is a browser voice-calling application built with WebRTC and Cloudflare Workers. It is a runnable early release, not a claim of a public production service: rollout and real-world cross-NAT/browser validation are currently paused.
>
> SparkCall 是一个使用 WebRTC 与 Cloudflare Workers 构建的浏览器语音通话应用。当前是可运行的早期版本，但不代表已有公开生产服务；生产发布及真实跨 NAT/跨浏览器验证目前暂停。

## Contents / 目录

- [Project purpose / 项目目的](#project-purpose--项目目的)
- [Implemented features / 已实现功能](#implemented-features--已实现功能)
- [Architecture / 架构](#architecture--架构)
- [Repository layout / 实际目录](#repository-layout--实际目录)
- [Local setup / 本地开发](#local-setup--本地开发)
- [Quality checks and tests / 质量检查与测试](#quality-checks-and-tests--质量检查与测试)
- [CI and deployment / CI 与部署](#ci-and-deployment--ci-与部署)
- [Privacy and security / 隐私与安全](#privacy-and-security--隐私与安全)
- [Known limitations / 真实限制](#known-limitations--真实限制)
- [Contributing / 贡献](#contributing--贡献)
- [License and author / 许可证与作者](#license-and-author--许可证与作者)

## Project purpose / 项目目的

SparkCall explores a privacy-conscious, self-hostable calling workflow with accounts, SparkCall numbers, contacts, call history, browser audio, and optional shareable call records. Worker APIs authorize actions, Durable Objects coordinate signaling and presence, and browsers negotiate WebRTC audio directly or through Cloudflare Realtime TURN when direct connectivity is unavailable. Audio is not recorded by the application.

SparkCall 探索一种注重隐私、可自行部署的通话流程，覆盖账号、SparkCall 号码、联系人、通话历史、浏览器音频和可选的可分享通话记录。Worker API 负责授权，Durable Objects 负责信令与在线呼入，浏览器之间直接协商 WebRTC 音频；无法直连时使用 Cloudflare Realtime TURN。应用不会录制音频。

This is not a promise of product completeness, guaranteed call quality, recording, R2 storage, billing enforcement, or a production SLA. / 这不代表产品完整、通话质量有保证、支持录音或 R2 存储、会自动执行账单配额，或提供生产级 SLA。

## Implemented features / 已实现功能

The following list describes checked-in behavior only. / 以下仅列出当前代码已经实现的行为：

- Username/password registration and login, logout, session lookup, 24-hour temporary guest accounts, and upgrade of a temporary identity to a permanent account while retaining its identity. / 用户名密码注册登录、退出、会话查询、24 小时临时访客账号，以及保留原身份的临时账号升级。
- Case-insensitive usernames and case-sensitive SparkCall numbers with availability checks and reserved names. / 用户名不区分大小写；SparkCall 号码区分大小写，并支持可用性检查与保留名称。
- Browser WebRTC audio calls with incoming invitations, accept, reject, busy, cancel, hang up, connection state, timeout, failure, and short reconnection handling. / 浏览器 WebRTC 音频通话，支持来电邀请、接听、拒接、忙线、取消、挂断、连接状态、超时、失败和短时重连。
- WebSocket signaling for SDP offers/answers and ICE candidates, backed by a signaling Durable Object; a separate presence Durable Object delivers invitations. / 由信令 Durable Object 支持的 WebSocket 信令，传输 SDP offer/answer 与 ICE candidate；独立的 presence Durable Object 传递来电。
- Microphone mute, input-device selection, echo cancellation, noise suppression, automatic gain control, and bitrate preferences. / 麦克风静音、输入设备选择、回声消除、噪声抑制、自动增益控制和码率偏好。
- Contacts with names, notes, favorites, lookup, update, and delete; blocked-number/user management. / 联系人名称、备注、收藏、查询、修改和删除；号码/用户黑名单管理。
- Call history and detail views with status and duration metadata. / 带状态和时长元数据的通话历史及详情。
- Private call records with title, description, notes, tags/metadata, editable slug, explicit public/revoked state, expiration, participant-consent filtering, and temporary-owner recovery capability. / 默认私有的通话记录，支持标题、描述、备注、标签/元数据、可编辑 slug、显式公开/撤销、过期、参与者同意过滤和临时所有者恢复 capability。
- Public record pages at `/callrecords/:slug`; public responses omit internal identifiers and sensitive metadata and send `noindex, nofollow`. / `/callrecords/:slug` 公共记录页；公开响应移除内部标识和敏感元数据，并设置 `noindex, nofollow`。
- Server-issued short-lived Cloudflare Realtime TURN credentials and sampled user/platform usage estimates when analytics configuration is present. / 服务端签发短期 Cloudflare Realtime TURN 凭据；具备分析配置时提供采样的用户/平台用量估算。
- Responsive React UI with light/dark presentation, loading/empty/error states, keyboard-friendly forms, and a 404 route. / 响应式 React 界面，包含浅色/深色呈现、加载/空/错误状态、键盘友好表单和 404 页面。

Not implemented or not enabled: audio recording, R2 avatar/upload storage, payments/3DS, a public production service, and automatic TURN quota blocking. / 尚未实现或启用：音频录制、R2 头像/上传存储、支付/3DS、公开生产服务和自动阻断 TURN 配额超限。

## Dashboard preview / 工作台预览

The dashboard below shows the authenticated workspace after registration, with a synthetic SparkCall number and contact. / 以下截图展示注册后的已登录工作台，包含合成的 SparkCall 号码和联系人。

![Authenticated SparkCall dashboard after registration, with synthetic account and contact data / 注册后工作台截图，包含合成账号和联系人数据](docs/assets/dashboard-preview-zh.png)

Captured locally after registering a synthetic preview account and adding a synthetic contact. The identity, number, and contact are fictional; no real credentials, personal account data, or call records are shown. This screenshot is for interface preview and does not indicate a production deployment.

该截图在本地注册合成预览账号并添加合成联系人后获取。身份、号码和联系人均为虚构；未展示真实凭据、个人账号资料或通话记录。此图仅用于界面预览，不表示已部署生产环境。

## Architecture / 架构

```text
Browser / 浏览器: React 19 + TypeScript + React Router + Tailwind CSS + WebRTC
        │ same-origin REST / authenticated WebSocket
        ▼
Cloudflare Worker (workers/api/src/index.ts)
  ├─ D1 (DB): users, sessions, contacts, blocks, call history, records,
  │           preferences, login-attempt counters, TURN snapshots
  ├─ SparkCallDurableObject: call signaling + WebSocket state
  ├─ SparkCallPresenceObject: presence + incoming invitations
  ├─ Worker Assets: apps/web/dist (SPA fallback; /api/* runs in Worker first)
  └─ Cloudflare Realtime TURN: short-lived ICE credentials / relay fallback

WebRTC audio is not stored in D1 or carried by Durable Objects.
WebRTC 音频不会存入 D1，也不会由 Durable Objects 承载。
```

The Worker also runs an hourly cron for cleanup and best-effort TURN usage snapshots. D1 changes are sequential SQL files under `migrations/`; DO bindings and SQLite-backed storage are declared in `wrangler.jsonc`.

Worker 还通过每小时 cron 清理过期数据并尽力写入 TURN 用量快照。D1 变更位于 `migrations/` 的顺序 SQL 文件中；DO 绑定与 SQLite-backed 存储在 `wrangler.jsonc` 中声明。

See [docs/architecture.md](docs/architecture.md) for the security boundary and [docs/cloudflare-references.md](docs/cloudflare-references.md) for Cloudflare references. / 安全边界见 [docs/architecture.md](docs/architecture.md)，Cloudflare 依据见 [docs/cloudflare-references.md](docs/cloudflare-references.md)。

## Repository layout / 实际目录

```text
apps/web/                 React/Vite frontend and static asset build
  src/App.tsx             SPA routes
  src/pages/              landing, auth, dashboard, dialer, contacts, history,
                          records, blocked, settings, public record pages
  src/contexts/           call-session state and WebRTC lifecycle
  src/lib/                API client, formatting, WebRTC helpers, unit tests
  src/components/         shared UI components
  src/styles/             Tailwind entry styles
workers/api/src/          Worker API, auth, calls, signaling, TURN
  index.ts                fetch/scheduled entry and DO exports
  api.ts                  authenticated REST API and account/record routes
  calls.ts                call creation/cancel, presence, signaling dispatch
  signaling.ts            signaling and presence Durable Objects
  auth.ts                 password/session/token helpers and rate limiting
  database.ts             D1 helpers and validation
  turn.ts                 TURN analytics and snapshots
migrations/               numbered D1 migrations (0001–0003)
scripts/                  isolated local integration runner
docs/                     architecture, deployment, testing, API references
.github/workflows/        test, PR artifact, gated deploy workflows
wrangler.jsonc            Worker, assets, D1, DO, cron, observability config
package.json              root workspaces and scripts
CONTRIBUTING.md           contribution and commit guidance
CODE_OF_CONDUCT.md        community behavior and reporting policy
SECURITY.md               security reporting policy and support status
AGENTS.md                 coding Agent context and engineering rules
LICENSE                   Apache License 2.0
```

Only existing project paths are documented; no placeholder module tree is implied. / 这里只记录实际存在的项目路径，不暗示空目录或未实现模块。

## Local setup / 本地开发

Prerequisites: Node.js 22+, npm, and Python 3 for integration tests. Cloudflare credentials are not needed for unit tests or the local-only D1 path. You can exercise account and record APIs without TURN, but the default browser calling flow requires a configured TURN credential endpoint; it does not silently fall back when that endpoint is unavailable.

前置条件：Node.js 22+、npm，以及集成测试所需的 Python 3。单元测试、本地 D1 及账户/记录 API 无需 TURN；但默认浏览器通话流程需要可用的 TURN 凭据端点，端点不可用时不会悄悄改为无中继的通话。

```bash
npm ci
cp .dev.vars.example .dev.vars
openssl rand -hex 32
# Put the random value in .dev.vars as SPARKCALL_INTERNAL_TOKEN.
# 将随机值填入 .dev.vars 的 SPARKCALL_INTERNAL_TOKEN。
# For Wrangler-only development, set ALLOWED_ORIGIN=http://localhost:8787.
# 仅使用 Wrangler 开发时，将 ALLOWED_ORIGIN 设为 http://localhost:8787。
CI=1 npm run db:migrate:local
npm run build
npm run dev:worker
```

For Vite HMR, run `npm run dev:web` in a second terminal and set `ALLOWED_ORIGIN=http://localhost:5173`. Vite proxies `/api` and WebSocket traffic to Wrangler at `127.0.0.1:8787`. Complete Wrangler-served app: `http://localhost:8787`; Vite: `http://localhost:5173`.

使用 Vite HMR 时在第二个终端运行 `npm run dev:web`，并设置 `ALLOWED_ORIGIN=http://localhost:5173`。Vite 会将 `/api` 与 WebSocket 请求代理到 `127.0.0.1:8787`。完整 Wrangler 应用：`http://localhost:8787`；Vite：`http://localhost:5173`。

`.dev.vars` is Git-ignored. Never put real secrets in source, browser bundles, or logs. Binding names are `DB`, `SIGNALING`, `PRESENCE`, and `ASSETS`; migrations use database name `sparkcall-db`.

`.dev.vars` 已被 Git 忽略。不要把真实 secret 写入源码、浏览器 bundle 或日志。绑定名称为 `DB`、`SIGNALING`、`PRESENCE`、`ASSETS`；迁移使用数据库名 `sparkcall-db`。

Variables in `.dev.vars.example` include `SPARKCALL_INTERNAL_TOKEN`, optional `TURN_KEY_ID`/`TURN_API_TOKEN`, optional `TURN_ANALYTICS_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, `ALLOWED_ORIGIN`, session TTLs, `TURN_CREDENTIAL_TTL_SECONDS`, display-only `TURN_MONTHLY_QUOTA_BYTES`, and optional `ADMIN_USER_IDS`.

`.dev.vars.example` 包含 `SPARKCALL_INTERNAL_TOKEN`、可选的 `TURN_KEY_ID`/`TURN_API_TOKEN`、可选的 `TURN_ANALYTICS_API_TOKEN` 与 `CLOUDFLARE_ACCOUNT_ID`、`ALLOWED_ORIGIN`、会话 TTL、`TURN_CREDENTIAL_TTL_SECONDS`、仅展示用的 `TURN_MONTHLY_QUOTA_BYTES` 和可选的 `ADMIN_USER_IDS`。

## Quality checks and tests / 质量检查与测试

```bash
npm run check              # strict TypeScript checks / 严格类型检查
npm run lint               # ESLint
npm test                   # Vitest unit tests / 单元测试
npm run build              # production frontend build / 生产构建
npm run quality            # check + lint + test + build
CI=1 npm run db:migrate:local
npm run test:integration   # isolated local Wrangler/D1 HTTP regression path
```

The integration command runs a temporary local Wrangler Worker, applies migrations to isolated local D1 state, exercises real HTTP routes and security/ownership/expiry behavior, strips inherited Cloudflare credentials, and cleans up. It never deploys or touches remote D1. Coverage for authentication, signaling, and backend behavior is being expanded; no fixed test/assertion count is promised.

集成命令启动临时本地 Wrangler Worker，将迁移应用到隔离的本地 D1，调用真实 HTTP 路由并验证安全/所有权/过期行为，同时移除继承的 Cloudflare 凭据并清理。它不会部署，也不会触碰远程 D1。认证、信令和后端覆盖仍在扩展；不承诺固定测试/断言数量。

See [docs/testing.md](docs/testing.md) for coverage, isolation and manual verification gaps. / 覆盖范围、隔离机制与人工验证缺口见 [docs/testing.md](docs/testing.md)。

## CI and deployment / CI 与部署

- `.github/workflows/test.yml`: push/PR/manual quality gate plus isolated local D1/HTTP integration tests. / push、PR、手动质量门禁与隔离本地 D1/HTTP 集成测试。
- `.github/workflows/preview.yml`: PR quality gate and upload of `apps/web/dist/` as an artifact; it does not publish a preview site. / PR 质量门禁并上传构建 artifact；不会发布预览站点。
- `.github/workflows/deploy.yml`: gated Wrangler deployment with API-token or manual device authorization. / 受保护的 Wrangler 部署，支持 API token 或人工设备授权。

Production deployment is currently paused. The deployment workflow has no push trigger and runs only after an explicit manual dispatch by an authorized operator with Cloudflare credentials. There is no claim of a live production domain or completed rollout.

生产部署当前暂停。部署工作流没有 push 触发器，仅能由持有 Cloudflare 凭据的授权操作员明确手动 dispatch 后运行。本文不宣称已有在线生产域名或完成发布。

If an authorized maintainer resumes deployment, the intended order is:

```bash
npx wrangler d1 migrations apply sparkcall-db --remote
npx wrangler deploy
```

Use least-privilege `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` GitHub secrets. Configure Worker secrets outside Git. Do not run remote commands merely to test local changes. See [docs/deployment.md](docs/deployment.md) for the target procedure, not proof that it is live.

在 GitHub secrets 中使用最小权限 `CLOUDFLARE_API_TOKEN` 与 `CLOUDFLARE_ACCOUNT_ID`，在 Git 外部配置 Worker secrets。不要为了测试本地改动而运行远程命令。目标流程见 [docs/deployment.md](docs/deployment.md)，不代表已上线。

## Privacy and security / 隐私与安全

- Passwords use versioned PBKDF2-SHA-256 hashes with 310,000 iterations; plaintext passwords are not stored. / 密码使用版本化 PBKDF2-SHA-256 哈希（310,000 轮），不保存明文。
- Sessions use hashed tokens and `HttpOnly; Secure; SameSite=Lax` cookies; state-changing requests use origin/CSRF checks. / 会话使用 token 哈希与安全 cookie；状态变更请求进行 Origin/CSRF 检查。
- API input is bounded and validated; SQL is parameterized; login attempts are atomically counted in D1. / API 限制并校验输入；SQL 参数化；登录尝试在 D1 中原子计数。
- Worker-to-DO calls require `SPARKCALL_INTERNAL_TOKEN`; signaling validates identity, role, message type, size, and rate limits. / Worker 到 DO 要求 `SPARKCALL_INTERNAL_TOKEN`；信令校验身份、角色、消息类型、大小并限流。
- Public records are opt-in, revocable, expirable, consent-filtered, and sent with `noindex, nofollow`. / 公共记录需主动开启，可撤销、可过期、按同意过滤，并设置 `noindex, nofollow`。
- Temporary-owner capability hashes and call metadata snapshots survive temporary-account cleanup. Losing the capability cookie can make the record unrecoverable after the temporary session expires. / 临时所有者 capability 哈希与通话元数据快照可保留到临时账号清理之后；临时会话过期后若丢失该 Cookie，记录可能无法恢复管理。
- Free-form notes and metadata values are not an automatic personal-data scrubber; review all user-authored content before publishing. / 自由备注和元数据值不会自动完成个人信息脱敏；公开前必须审阅自行填写的全部内容。
- TURN secrets stay server-side; browsers receive only short-lived ICE credentials. / TURN secret 仅在服务端；浏览器只接收短期 ICE 凭据。
- API responses set defensive headers including `nosniff`, `no-referrer`, `DENY`, and `no-store`. / API 响应设置 `nosniff`、`no-referrer`、`DENY`、`no-store` 等安全头。

These controls reduce risk but are not a security certification. Before exposing an instance, review configuration, secrets, Cloudflare permissions, browser behavior, and logs. See [SECURITY.md](SECURITY.md) for reporting security issues.

这些措施用于降低风险但不是安全认证。开放实例前请复核配置、secret、Cloudflare 权限、浏览器行为和日志。安全问题报告见 [SECURITY.md](SECURITY.md)。

## Known limitations / 真实限制

- Version 0.1.0 is early status. Real devices, browser combinations, NAT types, mobile networks, TURN fallback, reconnect behavior, and speaker routing still require deployment-level validation. / 0.1.0 仍是早期版本，真实设备、浏览器、NAT、移动网络、TURN fallback、重连和扬声器路由仍需部署后验证。
- Workers Web Crypto has no native Argon2id implementation here; the password scheme is PBKDF2-SHA-256. / 本实现使用的 Workers Web Crypto 没有原生 Argon2id，当前密码方案是 PBKDF2-SHA-256。
- TURN Analytics is sampled/time-windowed; usage is `authoritative: false`, not an exact live bill. `TURN_MONTHLY_QUOTA_BYTES` is display-only and does not block calls. / TURN Analytics 具有采样和时间窗口；用量为 `authoritative: false`，不是实时精确账单；配额仅展示，不会阻断通话。
- Speaker switching depends on browser `setSinkId` support. / 扬声器切换取决于浏览器 `setSinkId` 支持。
- R2, avatars/uploads, payments, and recording are not enabled. / R2、头像/上传、支付和录音尚未启用。
- D1 migrations must remain compatible; rolling code back across incompatible schema changes can break the Worker. / D1 迁移必须保持兼容；跨不兼容 schema 回滚可能导致 Worker 失败。

## Contributing / 贡献

Read [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution workflow and English Conventional Commits. Also read [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md), [SECURITY.md](SECURITY.md), and [AGENTS.md](AGENTS.md) before contributing. Use an accurate Git author identity; contributors are never required to impersonate, invent, or falsify identity. Issue and pull-request templates are provided in `.github/` when present.

贡献流程和英文 Conventional Commits 见 [CONTRIBUTING.md](CONTRIBUTING.md)。贡献前也请阅读 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)、[SECURITY.md](SECURITY.md) 和 [AGENTS.md](AGENTS.md)。请使用真实准确的 Git author identity；贡献者不需要冒充、捏造或伪造身份。`.github/` 中如有 issue/PR 模板，请按模板提交。

## License and author / 许可证与作者

Released under the [Apache License 2.0](LICENSE). / 本项目按 [Apache License 2.0](LICENSE) 发布。

**Author / 作者:** 尹嘉骐
**Code owner / GitHub:** [BOOMDEE](https://github.com/BOOMDEE)
