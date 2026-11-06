# Coding Agent Instructions

## Project status

SparkCall is a browser-native audio calling application. The current package version is `0.1.0` and remains pre-release. Do not describe it as production-verified or deployed without fresh evidence. Production deployment is gated and must be explicitly approved by a maintainer; automated production deployment on pushes must remain disabled.

## Repository map

- `apps/web/src/`: React, TypeScript, Vite and Tailwind frontend, including pages, layouts, components, contexts and browser API helpers.
- `workers/api/src/`: Cloudflare Worker REST API, authentication, database helpers, call signaling, Durable Objects, TURN and webhook integration.
- `migrations/`: ordered D1 SQL migrations. Add new migrations rather than editing a migration already used by another environment.
- `scripts/`: local development and verification tooling, including the isolated HTTP/D1 integration runner.
- `.github/workflows/`: quality checks, pull-request build artifacts and gated deployment.
- `docs/`: architecture, deployment, API references and testing notes.

Do not create empty packages or services solely to match an aspirational diagram. Extract shared modules when real reuse warrants them. Tests are colocated as `*.test.ts`; local integration tooling lives under `scripts/`.

## Commands

Use Node.js 22+, npm and Python 3. From the repository root:

```sh
npm ci
npm run check
npm run lint
npm test
npm run build
npm run quality
npm run test:integration
```

The integration runner needs an existing frontend build. It starts a temporary local Wrangler instance, applies migrations only to isolated local D1, removes inherited Cloudflare credentials, makes real loopback HTTP/WebSocket requests and removes temporary state. It does not verify actual microphone access, cross-NAT audio, remote TURN or production deployment.

For interactive development, follow the README setup before running `npm run dev:worker` and optionally `npm run dev:web`. Use `.dev.vars.example` as a template; never commit `.dev.vars`.

## Engineering boundaries

- Keep TypeScript strict, validate inputs and parameterize D1 queries. Do not trust client-supplied caller/owner IDs or internal authorization headers.
- Authorize every REST mutation and WebSocket entry point; enforce same-origin checks, ownership and blocklists on the server.
- Keep `/makecall/:username` under authenticated routing and use the existing call-creation API. Resolve only valid, non-temporary, unexpired usernames through parameterized case-insensitive D1 queries; retain rate limits, block, incoming-call preference and busy checks. Do not add anonymous call creation or a public username-lookup endpoint.
- Use `julianday()` for SQLite comparisons of ISO and SQLite-format timestamps; do not compare incompatible time strings lexicographically.
- Records are private by default. Publishing is explicit. Filter participant names by consent, redact sensitive metadata and keep public pages `noindex`.
- Temporary record ownership capabilities must outlive temporary-account cleanup. Store only capability hashes; never substitute predictable IDs for authorization.
- Durable Objects carry signaling, not audio. Browser peer connections carry encrypted audio directly or through Cloudflare TURN.
- TURN credentials are short-lived and generated server-side. Analytics are sampled estimates, not exact billing or real-time accounting. Missing configuration must be shown as unavailable, not zero usage.
- Use documented Cloudflare APIs. R2 avatar uploads and KV caching are not currently implemented; do not claim otherwise or add fake data to conceal missing integration.
- Never commit credentials, tokens, personal data, production secrets, generated build output or unrelated environment files.

## Git and collaboration

- The default branch is `Main`, with that capitalization.
- Write English Conventional Commit subjects in the form `<type>: <imperative summary>`, such as `fix: preserve temporary record ownership` or `docs: explain local test setup`.
- Project commits use the repository owner's `BOOMDEE` identity. Do not add an agent co-author trailer.
- Keep changes focused, preserve concurrent work and do not rewrite history or force-push without explicit maintainer authorization.
- Describe migration impact, affected routes/bindings, tests and remaining limitations in pull requests.

## Verification and reporting

Run relevant regression tests and the quality gate. Document what passed and what remains untested. Never claim that a placeholder, dry run, UI rendering or unit test proves real cross-NAT audio, TURN accounting or production readiness. Keep README facts accurate in both Chinese and English. See `CONTRIBUTING.md`, `SECURITY.md` and `CODE_OF_CONDUCT.md` for community policies.
