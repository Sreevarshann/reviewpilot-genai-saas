# Security

| Area | Control |
|---|---|
| Passwords | argon2id; ≥ 12 chars (NIST 800-63B length over composition); unknown-user logins still hash (timing) |
| Sessions | 256-bit random token in an HttpOnly, SameSite=Lax cookie (`__Host-` prefix + Secure when `COOKIE_SECURE=true`); only SHA-256 stored; idle (72 h) and absolute (14 d) expiry; rotation on login; logout-all |
| CSRF | SameSite=Lax plus an Origin check (or `Sec-Fetch-Site: same-origin`) on every cookie-authenticated POST/PUT/PATCH/DELETE |
| Password reset | single-use, 30-minute, hashed token; all sessions revoked on reset; responses do not reveal whether an account exists |
| Authorization | global AuthGuard; TenantGuard + role hierarchy on every org route; cross-tenant → 404 |
| API tokens | `rpk_` + 256-bit, hash-only storage, shown once, org-bound, REVIEWER rights, revocable, audited |
| Webhooks | token + HMAC-SHA256 over raw body, 5-minute window, delivery-id replay protection |
| Input | Zod schemas on every body / query (422), 5 MB JSON limit, plan diff limits, diff path-traversal rejection |
| Abuse | `@nestjs/throttler` global limit plus stricter auth limits |
| Secrets in diffs | redacted in evidence and in model context |
| Model output | schema-validated, grounded against the diff, never executed; CRITICAL reserved for rules |
| Headers | helmet defaults |
| Audit | invitations, membership and role changes, project changes, triage, tokens, plan changes, retention |
| Retention | per-org window (default 90 days, 7–3650) enforced daily by a BullMQ job scheduler and on demand |
| Dev-only surfaces | `/api/dev/outbox` requires `DEV_MAIL_OUTBOX=true`; configuration refuses it in production |
| Supply chain | `npm audit` and full-history gitleaks in CI; lockfile generated on Linux |

**Not implemented (known gaps):** MFA, SSO/SAML, email verification at sign-up, per-token
scopes beyond the REVIEWER role, encryption of diff contents at rest beyond what PostgreSQL
provides, and a real mail transport.
