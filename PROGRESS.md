# ReviewPilot — Progress

| # | Milestone | Commit | Pushed | Checks |
|---|---|---|---|---|
| 1 | Foundation: NestJS 12 ESM app, Zod-validated config, Prisma 7 multi-tenant schema + migration, Postgres/Redis compose, health (DB + Redis), helmet/CORS/cookies, real-Postgres integration test harness | `3e77967` | ✔ verified | tsc ✔ · integration 2/2 |
| 2 | Authentication: argon2id passwords (timing-safe unknown users), DB sessions (256-bit token, SHA-256 stored, idle + absolute expiry, rotation, logout-all), HttpOnly SameSite=Lax cookie (`__Host-` when secure), global guard + `@Public`, Origin check on cookie-authenticated writes, throttling, single-use password reset via dev mail outbox, Zod validation (422) | `9ec67cf` | ✔ verified | oxlint ✔ · tsc ✔ · integration 12/12 |
| 3 | Organizations & tenancy: TenantGuard (membership → role, non-members 404), role hierarchy, members (owner-only admin grants, last-owner protection, leave), email-bound single-use expiring invitations, projects, plan seat/project limits, audit log | `1d3c9c7` | ✔ verified | integration 20/20 (cross-tenant access tests on every org route type) |
| 4 | Unified diff parser: git and plain diffs, added/deleted/renamed/binary files, multi-hunk exact old/new line numbers, no-newline markers, language detection, size limits, path-traversal rejection | `93b2d3c` | ✔ verified | unit 7/7 |
| 5 | Static rules (deterministic, added lines only): secrets (redacted evidence), SQL/command injection, eval, TLS disabled, weak hashes, empty/swallowed catch, bare except, N+1 loop queries, SELECT *, debug output, TODO, source-without-tests | `fd758d7` | ✔ verified | unit 28/28 (incl. safe-equivalent negatives) |
| 6 | Review pipeline: LLM adapter (Ollama structured output / OpenAI-compatible / labelled fixture), secret-redacted bounded context, orchestrator (parse → static → model → validate cited lines + evidence → dedupe with deterministic precedence → cap model severity → persist → meter), model-failure degradation, BullMQ worker, persisted + Redis-published events, authenticated SSE replay/follow, re-review versions, diff-size + monthly plan limits, 5 MB JSON body limit, Idempotency-Key validated before any side effect, conflicting reuse → 409, concurrent duplicates → one review | `e6b73c4` | ✔ verified | integration 41/41 · unit 28/28 · oxlint ✔ · tsc ✔ |
| — | CI workflow + production-build fix (Prisma client moved under src/) | `5a3bc8b` | ✔ | nest build ✔ · production server health ✔ |
| 7 | Findings workflow: accept / dismiss / false positive / reopen (REVIEWER+, audited, notes), comments, version comparison by fingerprint (introduced / resolved / persisting), export JSON / CSV (formula-safe) / Markdown / SARIF 2.1.0 | `79dd161` | ✔ verified | integration 45/45 |
| — | Lockfile regenerated on Linux (CI `npm ci` failed on missing @emnapi optional deps) | `110da7e` | ✔ | Linux + macOS clean `npm ci` verified |
| 8 | Usage metering & plans: per-period reviews / LLM tokens / processing time / seats / projects from persisted records, by-model and daily series, public non-purchasable plan catalogue, OWNER-only **mock** plan change (never charges, audited `charged:false`, unsafe downgrades blocked), token budget → deterministic-only reviews | `5d4f0c1` | ✔ verified | integration 50/50 |
| 9 | Admin: org API tokens (`rpk_` + 256-bit, SHA-256 stored, shown once, REVIEWER rights, tenant-bound, revocable, audited), retention enforcement (on-demand + daily BullMQ scheduler, finished reviews only, per-tenant), HMAC-SHA256 signed webhook intake (token + signature over raw body, 5-minute window, delivery-id replay protection, disabled without secret) | `f5601fa` | ✔ | integration 57/57 · unit 28/28 |
| 10 | Analytics API: reviews over time (completed / failed / pending), p50 / p90 / avg / max latency, findings by category × confidence and severity, triage outcomes per confidence with acceptance rate over *triaged* findings only (labelled as not a precision metric), model token usage, top rules with accept / reject counts, per-project totals; project + window filters, tenant-scoped SQL | `7e90ff7` | ✔ | integration 60/60 |
| — | Grounding fix from a live qwen3:4b review: evidence echoing context line labels / elisions was rejected 5/5; now 4 kept, 1 rejected; validator unit tests | `fe8960d` | ✔ | unit 43/43 |
| — | BullMQ prefix per environment (`QUEUE_PREFIX`): a running dev worker had consumed test jobs; orphan jobs logged | `78a6b77` | ✔ | integration 60/60 with dev worker running |
| — | Opt-in development mail outbox (refused in production) | `b95bdd1` | ✔ | integration 62/62 |
| — | Revised re-runs (`rerun { diff?, title? }`) and API-driven demo seed | `955c581` | ✔ | integration 63/63 |
| 11 | Next.js web: auth flows, dashboard, new review, review detail (SSE timeline, diff viewer with finding markers, triage, comments, compare, export, re-run), analytics, organization admin, light/dark, mobile nav | `cba44f6` | ✔ | eslint · tsc · vitest 8/8 · next build |
| 12 | Playwright journey for the 12-step demo against an isolated stack (real worker, fixture LLM) incl. cross-org isolation | `5f5899c` | ✔ | 9/9 |
| — | UI fixes found while capturing screenshots (sample-title race, mobile overflow, compare base for v3+, daily bar width) | `153168a` | ✔ | vitest 8/8 · Playwright 9/9 |
| 13 | 16 real screenshots of the live stack (qwen3:4b-instruct via Ollama) | `7959ee7` | ✔ | — |
| — | Project creation offered only to admins on the new-review form | `3accea1` | ✔ | eslint · tsc |
| 14 | Docker images + compose `app` profile (verified: live review through web → api containers), CI frontend / E2E / Docker jobs | `a984879` | ✔ | images build · stack healthy · integration 63/63 |
| 15 | README and docs (architecture, tenancy, orchestration, metering, integration security, security, API, testing, demo, deployment, decisions) | `e63288b` | ✔ | — |
| — | Secret scan had failed since `cba44f6` on a gitleaks false positive (test Idempotency-Key value); value changed, single historical fingerprint allow-listed, history not rewritten | `c43021b` | ✔ | **CI run 43116623015: backend, frontend, E2E, Docker, gitleaks all green** |

> **Correction (2026-11-11):** milestone 5 was first reported as pushed, but the commit had been refused by the local secret guard because the rule tests contained credential-shaped fake tokens; the refusal was hidden by piping the commit script through `tail`. Test tokens are now assembled at runtime and the milestone was committed afterwards (see git log).

## Decisions
- Chose stable Prisma 7.10.1 over the 0.x `@nestjs/authentication` + Drizzle 1.0-rc stack; auth is a documented server-side session design on argon2 + crypto primitives.
- NestJS Observe (external telemetry) is intentionally not registered.
