# ReviewPilot

**Review faster. Understand every change.**

A multi-tenant generative-AI code-review SaaS: organizations, roles, invitations, diff
ingestion, deterministic static checks plus evidence-backed LLM suggestions, streamed review
progress, human approval workflow, usage metering and plan limits, audit trail and analytics.

> **Status: early development.** See [PLAN.md](PLAN.md) and [PROGRESS.md](PROGRESS.md).

```bash
make db        # Postgres :55503 + Redis :56503 (compose project "reviewpilot")
make setup && make migrate
make test      # integration tests on a real Postgres
make dev-api   # http://127.0.0.1:8113/api/health
```
