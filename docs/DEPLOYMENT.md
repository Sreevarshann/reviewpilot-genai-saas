# Deployment

## Docker Compose (local, no cloud resources)

```bash
docker compose --profile app up --build
# web http://localhost:3103   api http://localhost:8113/api/health
```

- `api` applies migrations on start, then serves the API and runs the BullMQ worker. It binds
  `0.0.0.0` inside the container; every published port is mapped to `127.0.0.1` only.
- The model is the **host's Ollama** via `host.docker.internal:11434`. Set `LLM_PROVIDER=fixture`
  for an offline stack or `LLM_PROVIDER=openai_compatible` with `LLM_BASE_URL` / `LLM_API_KEY` for
  a hosted endpoint (this may incur cost and is never the default).
- Compose project, network and volume are all named `reviewpilot`, so the stack never collides
  with other local projects. Postgres `mem_limit` 512m, Redis 192m, API 768m, web 512m.

## Configuration (validated at start-up by Zod; invalid config exits with the reasons)

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | — | required |
| `REDIS_URL` | `redis://127.0.0.1:56503` | |
| `QUEUE_PREFIX` | `reviewpilot` | isolate environments sharing Redis |
| `HOST` / `PORT` | `127.0.0.1` / `8113` | |
| `WEB_ORIGIN` | `http://localhost:3103` | CORS and the Origin check |
| `COOKIE_SECURE` | `false` | set `true` behind HTTPS (`__Host-` cookie) |
| `LLM_PROVIDER` | `ollama` | `ollama` / `openai_compatible` / `fixture` |
| `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY`, `LLM_TIMEOUT_MS` | Ollama / `qwen3:4b-instruct` / — / 120000 | |
| `REVIEW_INLINE` | `false` | run reviews in the request (tests only) |
| `WEBHOOK_SECRET` | unset | ≥ 16 chars enables webhook intake |
| `DEV_MAIL_OUTBOX` | `false` | refused when `NODE_ENV=production` |
| `SESSION_IDLE_HOURS`, `SESSION_ABSOLUTE_DAYS` | 72, 14 | |

## Before a real deployment

Use a real mail transport, HTTPS with `COOKIE_SECURE=true`, managed Postgres and Redis with
backups, a separate worker deployment if throughput matters, and secret management for
`WEBHOOK_SECRET` / `LLM_API_KEY`. No cloud deployment is included or was performed.
