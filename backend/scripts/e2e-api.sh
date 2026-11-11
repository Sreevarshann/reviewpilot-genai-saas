#!/usr/bin/env bash
# Isolated API for Playwright: fresh reviewpilot_e2e database, own BullMQ prefix, real worker
# (REVIEW_INLINE=false), labelled fixture LLM so journeys are deterministic and need no model.
set -euo pipefail
cd "$(dirname "$0")/.."
export E2E_DATABASE_URL="${E2E_DATABASE_URL:-postgresql://reviewpilot:reviewpilot_local_only@127.0.0.1:55503/reviewpilot_e2e}"
node --input-type=module -e "
import pg from 'pg';
const u = new URL(process.env.E2E_DATABASE_URL); const name = u.pathname.slice(1); u.pathname = '/postgres';
const c = new pg.Client({ connectionString: u.toString() }); await c.connect();
await c.query('DROP DATABASE IF EXISTS \"' + name + '\" WITH (FORCE)'); await c.query('CREATE DATABASE \"' + name + '\"'); await c.end();"
export DATABASE_URL="$E2E_DATABASE_URL" NODE_ENV=development PORT="${E2E_API_PORT:-8193}" WEB_ORIGIN="${E2E_WEB_ORIGIN:-http://127.0.0.1:3193}" \
  LLM_PROVIDER=fixture REVIEW_INLINE=false QUEUE_PREFIX=reviewpilot-e2e DEV_MAIL_OUTBOX=true COOKIE_SECURE=false AUTH_RATE_MULTIPLIER=50
npx prisma migrate deploy >/dev/null
npm run build >/dev/null
exec node dist/main.js
