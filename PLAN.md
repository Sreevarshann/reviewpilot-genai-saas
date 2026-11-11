# ReviewPilot — Plan

Ports: API 8113, web 3103, Postgres 55503, Redis 56503 (verified free 2026-11-11).

## Architecture
- **NestJS 12 (ESM) + Prisma 7 (pg driver adapter) + PostgreSQL 16**; Redis + BullMQ queue for reviews.
- **Auth**: server-side sessions (256-bit random token, only SHA-256 stored), argon2id passwords,
  HttpOnly SameSite=Lax cookie, idle + absolute expiry, rotation at sign-in, Origin check on
  state-changing requests, single-use password reset tokens, rate limiting.
- **Tenancy**: every tenant row has `organizationId`; an org guard resolves membership + role
  per request; services take an explicit tenant context; cross-tenant ids return 404.
- **Review pipeline** (BullMQ worker): validate → parse unified diff → files/languages →
  deterministic rules (secrets, injection, error handling, tests, perf) → bounded context →
  LLM suggestions (JSON) → validate line references against the diff → dedupe → severity →
  persist; progress events stored and streamed via authenticated SSE.
- **Findings**: deterministic vs model confidence; accept / dismiss / false positive; comments;
  re-review versions and comparison; export.
- **SaaS**: plans (Free/Team/Business, mock billing — no payments), usage metering (reviews,
  tokens, duration), limits (reviews/month, projects, seats, diff size), audit log, API tokens,
  retention settings, signed webhook intake.
- **Frontend**: Next.js graphite/sapphire/copper developer UI; review dashboard, diff viewer
  with inline markers, findings inspector, org admin, Plotly analytics.
  *Changed during build:* a custom unified-diff viewer replaced the planned Monaco diff editor,
  because reviews store hunks rather than full before/after files (see docs/DECISIONS.md #7).

## Milestones
1. SaaS foundation (Nest, Prisma schema, compose, real-DB tests)
2. Authentication + sessions
3. Organizations, memberships, invitations, tenant isolation
4. Diff parser
5. Static analysis rules
6. LLM adapter + review orchestrator + queue
7. Streaming progress
8. Findings workflow + re-review
9. Usage metering, plans, limits
10. Admin: audit, API tokens, retention, webhooks
11. Analytics API
12. Frontend
13. E2E, docs, screenshots, CI, deployment

All milestones are complete. See PROGRESS.md for commits and checks.
