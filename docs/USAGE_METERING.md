# Usage metering and plans

| Plan | Reviews / month | Projects | Seats | Max diff | LLM tokens / month |
|---|---|---|---|---|---|
| Free | 25 | 2 | 3 | 200 KB | 200k |
| Team | 500 | 20 | 25 | 1 MB | 5M |
| Business | 5,000 | 200 | 250 | 4 MB | 50M |

These are **local demo tiers**. There is no payment provider: `POST /api/orgs/:org/billing/plan`
(OWNER) switches the plan immediately, records `billing.plan_changed` with
`{ provider: 'mock', charged: false }` in the audit log, and the UI says that nothing is charged.
No card or payment details are collected anywhere.

**What is metered** (`UsageRecord.kind`): `review` (1 per completed run; failed runs are not metered), `llm_tokens`
(prompt + completion tokens reported by the provider), `review_ms` (wall-clock processing time).
`GET /api/orgs/:org/usage` aggregates those rows for the current calendar month (UTC); the monthly review limit counts non-failed reviews. Seats
and projects come from live counts. Nothing is estimated client-side.

**Enforcement points**
- Diff size → `413 plan_limit / diff_size` before parsing.
- Monthly reviews → `403 plan_limit / reviews_per_month` before insert.
- Projects and seats → `403 plan_limit` on create / invite.
- Token budget → when exhausted, reviews still run deterministic checks and are marked
  `modelError: "Monthly LLM token budget exhausted; deterministic checks only"`.
- Downgrades that would exceed seats or projects are refused with `409 downgrade_blocked`.
