# Testing SparkCall / 测试说明

## Quick checks / 快速检查

From the repository root / 在仓库根目录运行：

```sh
npm ci
npm run quality
npm run test:integration
```

`quality` runs strict frontend/Worker TypeScript checking, ESLint, Vitest and the Vite production build. `test:integration` requires that build plus Python 3. CI runs both commands on `Main` pushes and pull requests.

`quality` 执行前端与 Worker 的严格 TypeScript 检查、ESLint、Vitest 和 Vite 生产构建。`test:integration` 需要前端已构建，并要求 Python 3。`Main` 的推送和拉取请求都会在 CI 中执行这两项检查。

## What is covered / 覆盖范围

| Layer / 层级 | Checks / 检查 |
| --- | --- |
| Browser helpers / 浏览器工具 | API response unwrapping, structured errors, credential mode, duration/traffic/date formatting / 响应解包、结构化错误、请求凭据模式及格式化 |
| Authentication / 认证 | PBKDF2 hash round trips and malformed hashes, token hashing, cookies, session/revocation SQL, limiter behavior / 密码哈希、畸形输入、令牌、Cookie、会话撤销和限流 |
| Validation / 校验 | Username/number/slug boundaries, JSON size and parsing, parameter binding, case-sensitive number lookup / 账户、号码、slug、JSON 大小及参数化查询 |
| Call entry / 呼叫入口 | Cross-site call creation rejection and date-normalized active-call query / 跨站创建拒绝及活动呼叫时间比较 |
| Real local HTTP + D1 / 真实本地 HTTP 与 D1 | Guest creation and identity-preserving upgrade, custom number case sensitivity/cooldown, contact ownership, blocklist enforcement, concurrent preference patches from independent sessions with monotonic versions, private/public/revoked/expired records, public-field filtering, login/logout / 临时身份升级、号码、联系人权限、黑名单、独立会话并发偏好更新与单调版本、记录隐私与过期、登录退出 |
| Record lifecycle / 记录生命周期 | Capability access after logout and temporary-user deletion, with retained call metadata / 退出及临时账号删除后，独立能力凭据仍可管理记录且保留通话元数据 |

## Isolation / 隔离机制

`scripts/test-integration.py` generates a temporary configuration and D1 state directory under ignored `.wrangler/`, starts Wrangler on a loopback port and makes actual HTTP requests. All migration and SQL commands explicitly use `--local`; inherited `CLOUDFLARE_*` credentials are removed. The test uses generated local-only internal authentication and never needs a Cloudflare login, remote API token, TURN key or production database. The process group is stopped and the temporary state is removed on exit.

集成测试在被 Git 忽略的 `.wrangler/` 下生成临时配置与独立 D1，启动回环地址上的 Wrangler，再发送真实 HTTP 请求。迁移与 SQL 命令均显式使用 `--local`，并移除继承的 `CLOUDFLARE_*` 凭据。测试仅使用临时生成的本地内部密钥，无需 Cloudflare 登录、远端令牌、TURN 密钥或生产数据库。结束时会关闭进程组并删除临时状态。

## Still requires manual verification / 仍需人工验证

These checks do **not** prove real audio connectivity or production readiness. Before releasing, use at least two independently authenticated browsers/devices to verify microphone permissions, incoming-call accept/reject, mute/hang-up, device switching, reconnects, concurrent/multi-device call arbitration, and audio quality. Test both direct peer connections and relayed TURN paths across real networks, with actual Cloudflare credentials in an authorized environment. Verify remote migration, Durable Object hibernation/alarms and analytics behavior separately. Test accessibility and responsive layouts in supported browsers.

这些检查**不能**证明真实音频连通或生产可用。发布前需以至少两个独立登录的浏览器/设备，验证麦克风权限、来电接听/拒绝、静音/挂断、设备切换、重连、多设备/并发通话仲裁及音质；还需在真实网络下分别验证直连和 TURN 中继，并另行核验远端迁移、Durable Object 休眠/闹钟与使用量分析。浏览器兼容性、无障碍和响应式布局也需人工检查。

Production deployment is currently paused. No local test result should be reported as a live deployment or a completed cross-network audio acceptance test.

目前生产部署已暂停。不得将本地测试结果表述为已上线，或已完成跨网络音频验收。

## Release preflight / 发布前预检

The manual deployment workflow performs a names-only preflight before remote D1 migration or Worker deployment. It checks that `INTERNAL_SIGNALING_TOKEN`, `TURN_KEY_ID`, `TURN_API_TOKEN`, and `SPARKCALL_WEBHOOK_ENCRYPTION_KEY` are configured as required secret names; it never prints, retrieves, or transmits secret values. This check is a release gate, not a local test and not proof that the corresponding Cloudflare Worker secrets are valid.

手动部署工作流会在远程 D1 迁移或 Worker 部署前执行仅检查名称的预检。它确认 `INTERNAL_SIGNALING_TOKEN`、`TURN_KEY_ID`、`TURN_API_TOKEN` 和 `SPARKCALL_WEBHOOK_ENCRYPTION_KEY` 这四个必需 secret 名称已配置；不会打印、读取或传输 secret 值。该检查是发布门禁，不是本地测试，也不能证明对应的 Cloudflare Worker secret 有效。
