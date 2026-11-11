# Testing

| Suite | Command | What it uses | Count |
|---|---|---|---|
| Backend unit | `cd backend && npm test` | Vitest | 43 (diff parser, 17 rules incl. safe negatives, evidence grounding, validation, dedupe) |
| Backend integration | `cd backend && npm run test:e2e` | Vitest + supertest against a **real PostgreSQL** (`reviewpilot_test`, recreated per run) and Redis | 63 |
| Frontend unit | `cd frontend && npm test` | Vitest + Testing Library (jsdom) | 8 |
| End-to-end | `cd frontend && npx playwright test` | Chromium against an isolated stack (fresh `reviewpilot_e2e` DB, own BullMQ prefix, real worker + SSE, fixture LLM, production web build) | 9 tests / 12 demo steps |
| Screenshots | `SCREENSHOT_BASE_URL=http://localhost:3103 npx playwright test` | the running stack with the live model | 16 images |

Integration tests use the labelled `FixtureProvider` (provider `fixture`, model
`fixture-heuristic-v1`) and `REVIEW_INLINE=true` except where the worker itself is under test.
Fake credentials in rule tests are assembled at runtime, so the repository never contains
credential-shaped literals and secret scanning stays meaningful.

**Coverage highlights**
- Auth: registration, login timing, session expiry / rotation / logout-all, Origin check, reset, throttling.
- Tenancy: every org route type with a foreign session; role hierarchy; last-owner protection; invitations.
- Reviews: limits, invalid diffs, **invalid Idempotency-Key rejected before any side effect**, replay, conflicting reuse (409), concurrent duplicates, worker lifecycle and event sequence, SSE replay, versions and revised re-runs, model degradation, token budget.
- Findings: triage, comments, compare, CSV formula-injection safety, SARIF.
- Admin: token hashing / isolation / revocation, retention scoping, webhook signature cases.
- Analytics: figures equal stored rows, tenant isolation, filters.

**Environment isolation.** Tests set `QUEUE_PREFIX=reviewpilot-test-<pid>`. Before that existed, a
running dev API's worker consumed test jobs from the shared Redis (see `78a6b77`).

CI (`.github/workflows/ci.yml`) runs backend lint, types, unit and integration on Postgres/Redis
services; frontend lint, types, unit and build; Playwright E2E; Docker image builds; `npm audit`;
and full-history gitleaks.
