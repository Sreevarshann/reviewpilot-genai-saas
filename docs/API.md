# API

Base path `/api`. JSON bodies; validation errors are `422 { message: string[] }`; other errors
are `{ error: <code>, message }`. Organization routes resolve `:org` by slug, require membership
(else **404**) and the role shown. Authentication: the `rp_session` cookie (browsers; writes need a
matching `Origin`) or `Authorization: Bearer rpk_…` (organization API token, REVIEWER rights).

## Auth and account
| Method | Path | Notes |
|---|---|---|
| POST | `/auth/register` | `{ email, name, password ≥ 12, organizationName? }` → user + cookie |
| POST | `/auth/login` | `{ email, password }` |
| POST | `/auth/logout`, `/auth/logout-all` | |
| GET | `/auth/me` | user + memberships (session only) |
| POST | `/auth/password-reset/request` | 202 whether or not the account exists |
| POST | `/auth/password-reset/confirm` | `{ token, password }`; revokes all sessions |
| GET | `/dev/outbox?email=` | only when `DEV_MAIL_OUTBOX=true` |
| GET | `/health` | DB, Redis, provider, model |

## Organizations
| Method | Path | Role |
|---|---|---|
| POST / GET | `/orgs` | signed in |
| POST | `/invitations/accept` `{ token }` | signed in, invited email |
| GET / PATCH | `/orgs/:org` (`{ name?, retentionDays? }`) | VIEWER / ADMIN |
| GET | `/orgs/:org/members` | VIEWER |
| PATCH / DELETE | `/orgs/:org/members/:userId` | ADMIN (OWNER for admin/owner grants); any member may DELETE themself to leave |
| GET / POST / DELETE | `/orgs/:org/invitations[/:id]` | ADMIN |
| GET / POST / DELETE | `/orgs/:org/projects[/:id]` | VIEWER / ADMIN / ADMIN |
| GET | `/orgs/:org/audit?limit=` | ADMIN |

## Reviews and findings
| Method | Path | Role / notes |
|---|---|---|
| POST | `/orgs/:org/reviews` `{ projectId, title, diff }` | REVIEWER; optional `Idempotency-Key`; 202 |
| GET | `/orgs/:org/reviews?projectId=&status=&take=` | VIEWER |
| GET | `/orgs/:org/reviews/:id` · `/diff` · `/findings?severity=&state=&confidence=` | VIEWER |
| GET | `/orgs/:org/reviews/:id/events` | VIEWER; SSE `event: progress` with `Last-Event-ID` resume |
| POST | `/orgs/:org/reviews/:id/rerun` `{ diff?, title? }` | REVIEWER; next version |
| GET | `/orgs/:org/reviews/:base/compare/:head` | VIEWER; introduced / resolved / persisting |
| GET | `/orgs/:org/reviews/:id/export?format=json\|csv\|md\|sarif` | VIEWER |
| PATCH | `/orgs/:org/findings/:id` `{ state, note? }` | REVIEWER |
| POST | `/orgs/:org/findings/:id/comments` `{ body }` | REVIEWER |

## Usage, analytics, admin
| Method | Path | Role |
|---|---|---|
| GET | `/plans` | public |
| GET | `/orgs/:org/usage` | VIEWER |
| POST | `/orgs/:org/billing/plan` `{ plan }` | OWNER; mock, never charges |
| GET | `/orgs/:org/analytics?days=1..365&projectId=` | VIEWER |
| GET / POST / DELETE | `/orgs/:org/api-tokens[/:id]` | ADMIN; POST returns the raw token once |
| POST | `/orgs/:org/retention/run` | ADMIN |
| POST | `/webhooks/reviews` | API token + HMAC signature; see [GITHUB_INTEGRATION_SECURITY.md](GITHUB_INTEGRATION_SECURITY.md) |

Error codes include `invalid_idempotency_key` (400), `invalid_diff` (400), `idempotency_conflict`
(409), `plan_limit` (403/413, with `limit`), `downgrade_blocked` (409), `bad_origin` (403),
`bad_signature` / `stale_signature` / `bad_token` (401), `webhooks_disabled` (503).
