# Changelog

Changes use English Conventional Commits. Version `0.1.0` is currently an
unreleased development version; this file does not announce a production rollout.

## 0.1.0 — Unreleased

### Added

- React/Vite calling workspace with accounts, contacts, blocklists, history,
  private/shareable records, audio preferences and usage views.
- Cloudflare Worker API, D1 migrations, signaling/presence Durable Objects,
  server-issued TURN credentials and optional sampled usage analytics.
- Authentication, validation and call-entry unit tests plus an isolated local
  Worker/D1 HTTP integration runner in CI.
- Bilingual project and contribution documentation, security/conduct policies,
  coding Agent instructions, issue/PR templates and formatting conventions.

### Fixed

- PBKDF2 Base64url decoding and mixed-format timestamp expiry comparisons.
- Cross-origin call creation and an invalid pre-accept connection transition.
- Temporary-user cleanup cascading into independently owned records; record
  ownership capabilities and captured call metadata now survive user removal.

### Not yet verified

- Real cross-network audio, TURN relay paths, multi-device concurrency and
  production Durable Object lifecycle behavior require separate acceptance tests.
- Production deployment is paused; no public service or tagged release is claimed.
