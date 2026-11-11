# Architecture

```
 Browser ── Next.js 16 web (:3103) ── /api/* rewrite ──▶ NestJS 12 API (:8113)
                                                          │   ├─ AuthGuard (session cookie │ Bearer rpk_ token)
                                                          │   ├─ TenantGuard (org membership → role)
                                                          │   ├─ Reviews / Findings / Billing / Analytics / Admin
                                                          │   └─ BullMQ worker (in-process, concurrency 1)
                                                          │          └─ ReviewOrchestrator
                                                          ▼
                                   PostgreSQL 16 (Prisma 7)   Redis 7 (queue + pub/sub)   Ollama (host)
```

| Layer | Technology | Notes |
|---|---|---|
| Web | Next.js 16 (cache components), React 19, TanStack Query, Tailwind 4, Radix, Plotly | Same-origin proxy keeps the HttpOnly session cookie first-party |
| API | NestJS 12 (ESM), Zod via Standard Schema pipe (422 on invalid input) | helmet, CORS, 5 MB JSON limit, throttling |
| Data | PostgreSQL 16 via Prisma 7.10 + `@prisma/adapter-pg` | Every tenant table carries `organizationId` |
| Queue | BullMQ on Redis, `QUEUE_PREFIX` per environment | Job id = review id; 2 attempts with backoff |
| Streaming | Server-Sent Events, events persisted then published on `reviewpilot:review:<id>` | Reloads replay stored events, then follow live |
| Model | `OllamaProvider` (structured JSON output), `OpenAICompatibleProvider`, labelled `FixtureProvider` | Default `qwen3:4b-instruct` on local Ollama; nothing paid by default |

## Request path for a review

1. `POST /api/orgs/:org/reviews` — `AuthGuard` resolves the session (or API token), `TenantGuard`
   resolves membership and enforces `REVIEWER`. The Idempotency-Key is validated **before** any
   read or write; then replay → project ownership → plan diff size → diff parse → monthly limit →
   insert (unique `(organizationId, idempotencyKey)`) → audit → enqueue.
2. The worker runs `ReviewOrchestrator.run(reviewId)` (only if the review is still `QUEUED`), which
   emits `parsing → static_checks → model_analysis → validation → completed|failed` events.
3. The web page opens `GET .../reviews/:id/events` (SSE). Stored events are replayed first, then
   the API subscribes to Redis and closes the stream on a terminal stage.

See [REVIEW_ORCHESTRATION.md](REVIEW_ORCHESTRATION.md), [MULTI_TENANT.md](MULTI_TENANT.md) and
[USAGE_METERING.md](USAGE_METERING.md).

## Module map (`backend/src`)

| Module | Responsibility |
|---|---|
| `auth/` | argon2id passwords, DB sessions, global guard, Origin check, password reset |
| `orgs/`, `tenancy/` | organizations, members, invitations, projects, audit log; `TenantGuard`, role hierarchy |
| `review/` | diff parser, deterministic rules, context builder, prompts, orchestrator, events, queue processor |
| `llm/` | provider adapters and factory |
| `findings/` | triage states, comments, version compare, JSON / CSV / Markdown / SARIF export |
| `billing/` | plan catalogue, usage summary, mock plan change |
| `analytics/` | tenant-scoped aggregate SQL |
| `admin/` | API tokens, retention job, signed webhook intake |
| `mail/` | development transport + opt-in dev outbox |
