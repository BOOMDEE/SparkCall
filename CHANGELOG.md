# Changelog

Changes use English Conventional Commits. Version `0.1.0` is currently an
unreleased development version; this file does not announce a production rollout.

## 0.1.0 — Unreleased

### Added

- React/Vite calling workspace with accounts, contacts, blocklists, history,
  private/shareable records, audio preferences and usage views.
- Cloudflare Worker API, D1 migrations, signaling/presence Durable Objects,
  server-issued TURN credentials and optional sampled usage analytics.
- Per-account and bulk monthly TURN relay limits, plus administrator-only
  temporary-account usage estimates; unavailable Analytics remains fail-open.
- Direct username dialing from the authenticated call field, alongside
  username call links; exact number matches take precedence.
- Authentication, validation and call-entry unit tests plus an isolated local
  Worker/D1 HTTP integration runner in CI.
- Browser-local do-not-disturb and optional generic missed-call notifications;
  expired unanswered invitations now settle promptly in call history.
- Bilingual project and contribution documentation, security/conduct policies,
  coding Agent instructions, issue/PR templates and formatting conventions.

### Fixed

- PBKDF2 Base64url decoding and mixed-format timestamp expiry comparisons.
- Cross-origin call creation and an invalid pre-accept connection transition.
- Cloudflare TURN Analytics now receives GraphQL Date bounds in `YYYY-MM-DD`
  format; timestamp bounds could prevent usage estimates and snapshots from loading.
- Temporary-user cleanup cascading into independently owned records; record
  ownership capabilities and captured call metadata now survive user removal.

### Not yet verified

- Real cross-network audio, TURN relay paths, multi-device concurrency and
  production Durable Object lifecycle behavior require separate acceptance tests.
- A pre-release public preview exists; no production SLA, cross-network audio
  acceptance, or tagged release is claimed.
