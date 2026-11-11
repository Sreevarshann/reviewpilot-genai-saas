# ReviewPilot — Progress

| # | Milestone | Commit | Pushed | Checks |
|---|---|---|---|---|
| 1 | Foundation: NestJS 12 ESM app, Zod-validated config, Prisma 7 multi-tenant schema + migration, Postgres/Redis compose, health (DB + Redis), helmet/CORS/cookies, real-Postgres integration test harness | (this commit) | — | tsc ✔ · integration 2/2 |

## Decisions
- Chose stable Prisma 7.10.1 over the 0.x `@nestjs/authentication` + Drizzle 1.0-rc stack; auth is a documented server-side session design on argon2 + crypto primitives.
- NestJS Observe (external telemetry) is intentionally not registered.
