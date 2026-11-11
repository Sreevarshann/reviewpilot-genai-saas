# CI / Git-host integration security

ReviewPilot **does not** post to pull requests, push commits or hold repository credentials.
Integration is one-directional: a CI job sends a diff, ReviewPilot reviews it, and results are
read back through the API or exported as SARIF (which GitHub code scanning can ingest).

## Signed webhook intake — `POST /api/webhooks/reviews`

Both checks are required:

1. **Who:** `Authorization: Bearer rpk_…`, an organization API token. Tokens are 256-bit random
   values shown once; only their SHA-256 hash is stored; they are bound to one organization, act as
   REVIEWER, can be revoked instantly and record `lastUsedAt`.
2. **Integrity and freshness:** `X-ReviewPilot-Signature: t=<unix>,v1=<hex>` where
   `v1 = HMAC-SHA256(WEBHOOK_SECRET, "<t>.<raw body>")`. The signature is computed over the exact
   received bytes (`rawBody`), compared in constant time, and `t` must be within 300 s.

Payload: `{ deliveryId, project, title, diff }`. The `deliveryId` becomes the idempotency key
`wh_<deliveryId>`, so a replayed delivery returns the original review (`replayed: true`) instead
of creating a second one. The project must belong to the token's organization. Intake is
**disabled (503)** unless `WEBHOOK_SECRET` (≥ 16 chars) is configured.

```bash
body='{"deliveryId":"build-1234","project":"orders-service","title":"CI #1234","diff":"..."}'
t=$(date +%s)
sig=$(printf '%s.%s' "$t" "$body" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" -hex | sed 's/^.* //')
curl -X POST http://127.0.0.1:8113/api/webhooks/reviews \
  -H "Authorization: Bearer $REVIEWPILOT_TOKEN" -H "X-ReviewPilot-Signature: t=$t,v1=$sig" \
  -H 'Content-Type: application/json' --data "$body"
```

Tests (`test/admin.e2e-spec.ts`) cover a valid delivery, replay, a missing, wrong, stale or
tampered signature, a missing token, a foreign-organization project and the disabled state; no
review is created in any rejected case.

## Diff content

Diffs are untrusted input. They are size-limited per plan, parsed defensively (path traversal
rejected), secrets in added lines are redacted before being shown as evidence or sent to the model,
and model output is never executed. It is validated against the diff as described in
[REVIEW_ORCHESTRATION.md](REVIEW_ORCHESTRATION.md).
