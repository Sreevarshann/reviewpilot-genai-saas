# ReviewPilot — Progress

| # | Milestone | Commit | Pushed | Checks |
|---|---|---|---|---|
| 1 | Foundation: NestJS 12 ESM app, Zod-validated config, Prisma 7 multi-tenant schema + migration, Postgres/Redis compose, health (DB + Redis), helmet/CORS/cookies, real-Postgres integration test harness | `3e77967` | ✔ verified | tsc ✔ · integration 2/2 |
| 2 | Authentication: argon2id passwords (timing-safe unknown users), DB sessions (256-bit token, SHA-256 stored, idle + absolute expiry, rotation, logout-all), HttpOnly SameSite=Lax cookie (`__Host-` when secure), global guard + `@Public`, Origin check on cookie-authenticated writes, throttling, single-use password reset via dev mail outbox, Zod validation (422) | `9ec67cf` | ✔ verified | oxlint ✔ · tsc ✔ · integration 12/12 |
| 3 | Organizations & tenancy: TenantGuard (membership → role, non-members 404), role hierarchy, members (owner-only admin grants, last-owner protection, leave), email-bound single-use expiring invitations, projects, plan seat/project limits, audit log | see git log | ✔ | integration 20/20 (cross-tenant access tests on every org route type) |

## Decisions
- Chose stable Prisma 7.10.1 over the 0.x `@nestjs/authentication` + Drizzle 1.0-rc stack; auth is a documented server-side session design on argon2 + crypto primitives.
- NestJS Observe (external telemetry) is intentionally not registered.
