# Contributing to SparkCall

Thank you for contributing to SparkCall. This document keeps contributions reviewable, reproducible, and aligned with the current early-stage implementation.

感谢参与 SparkCall。本文件旨在让贡献可审阅、可复现，并与当前早期实现保持一致。

## Before you start / 开始之前

Read the repository guidance in [README.md](README.md), [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md), [SECURITY.md](SECURITY.md), and [AGENTS.md](AGENTS.md). Check existing issues and pull requests before starting substantial work. Keep changes focused and do not move or rewrite unrelated source files.

请先阅读 [README.md](README.md)、[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)、[SECURITY.md](SECURITY.md) 和 [AGENTS.md](AGENTS.md)。进行较大改动前先检查已有 issue 和 PR。保持改动聚焦，不要移动或重写无关源码文件。

Do not include credentials, tokens, personal data, production URLs that are not already documented, or generated build output in a change. Do not run remote migrations or deployment commands as part of ordinary local validation.

不要提交凭据、token、个人数据、未被记录的生产 URL 或构建产物。普通本地验证不要运行远程迁移或部署命令。

## Development and validation / 开发与验证

```bash
npm ci
npm run check
npm run lint
npm test
npm run build
npm run quality
CI=1 npm run db:migrate:local
npm run test:integration
```

Run the checks relevant to your change. The integration command is local-only and isolated; it must not contact Cloudflare or a remote D1 database. Do not describe a fixed test/assertion count in documentation because coverage is evolving.

运行与你的改动相关的检查。集成命令仅使用隔离的本地环境，不得联系 Cloudflare 或远程 D1。由于覆盖范围持续变化，文档不要写固定测试/断言数量。

For UI changes, test the affected route and state transitions in a real browser where possible. For API, authentication, signaling, migration, or privacy changes, include the relevant regression test and explain security implications in the PR.

UI 改动尽可能在真实浏览器中测试受影响的路由和状态变化。API、认证、信令、迁移或隐私改动应补充相关回归测试，并在 PR 中说明安全影响。

## Commit messages / 提交信息

Use **English Conventional Commits**:

```text
feat: add contact search
fix: reject expired record capability
test: cover temporary-user cleanup
docs: clarify local D1 setup
refactor: split signaling validation
```

The permitted conventional types include `feat`, `fix`, `test`, `docs`, `refactor`, `perf`, `build`, `ci`, and `chore`. Use an optional scope when useful, for example `fix(auth): reject expired sessions`. Keep the subject imperative, concise, and free of a trailing period. Put breaking changes in the footer with `BREAKING CHANGE:`.

允许的类型包括 `feat`、`fix`、`test`、`docs`、`refactor`、`perf`、`build`、`ci` 和 `chore`。必要时可使用 scope，例如 `fix(auth): reject expired sessions`。subject 应简洁、使用祈使表达且不以句号结尾；破坏性变更在 footer 使用 `BREAKING CHANGE:` 说明。

## Pull requests / 拉取请求

A PR should explain what changed, why, affected routes or bindings, migration impact, test commands run, and any remaining limitation. Keep one coherent change per PR where possible. Link an issue when one exists. Include screenshots or short recordings for meaningful UI changes, while removing personal or sensitive data.

PR 应说明改了什么、为什么改、影响哪些路由或绑定、迁移影响、运行了哪些测试命令，以及仍有哪些限制。尽可能让每个 PR 只包含一个连贯改动。有对应 issue 时请关联。明显的 UI 改动请附截图或短录屏，并移除个人或敏感数据。

Reviewers may request narrower scope, additional tests, or documentation updates. A passing local check does not establish production readiness; deployment remains paused by default.

审阅者可能要求收窄范围、补充测试或更新文档。本地检查通过不等于可生产使用；部署默认仍处于暂停状态。

## Identity and authorship / 身份与署名

Contributors must not impersonate, invent, or falsify a person, organization, review, or authorization. Use an accurate Git author identity appropriate to your contribution. You do not need to adopt the maintainer's name, claim code ownership, or use a fabricated identity to contribute.

贡献者不得冒充、捏造或伪造个人、组织、审阅或授权。请使用与贡献相符且真实准确的 Git author identity。你不需要采用维护者姓名、声称代码所有权或使用虚构身份来贡献。

## Security and conduct / 安全与行为

Do not disclose vulnerabilities in a public issue before following [SECURITY.md](SECURITY.md). Follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for respectful participation. Use the issue and pull-request templates under `.github/` when available.

在按照 [SECURITY.md](SECURITY.md) 报告前，不要在公开 issue 中披露漏洞。请遵守 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) 进行友善协作；如 `.github/` 下提供 issue 和 PR 模板，请使用这些模板。
