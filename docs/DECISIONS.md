# Decisions

1. **Stable Prisma 7 + a custom session design** instead of `@nestjs/authentication` 0.1.x and Drizzle 1.0-rc: both were pre-release when the project started. Sessions follow the OWASP session-management cheat sheet on argon2id and Node crypto.
2. **Server-side sessions, not JWTs.** Logout, logout-all and password reset must revoke immediately; a session row makes that trivial.
3. **Cross-tenant access returns 404**, not 403, so organization slugs and ids cannot be probed.
4. **Deterministic rules first, model second, and the model must quote the diff.** The rules give a reliable floor and the model adds judgement. Grounding keeps hallucinated findings out of the product. CRITICAL is reserved for rules.
5. **Degrade instead of failing** when the model is unavailable, times out or the token budget is exhausted.
6. **Worker in the API process** (concurrency 1) for a single-machine demo with a local 4B model; BullMQ makes a separate worker deployment a configuration change.
7. **Custom unified-diff viewer instead of Monaco.** Reviews store hunks, not full before/after files, so a side-by-side editor would need content the system does not have. The viewer renders the stored hunks with exact line numbers and links gutter markers to findings.
8. **Mock billing.** Plans and limits are real and enforced; plan changes are recorded as `provider: mock, charged: false`. No payment flow exists, so no payment can be implied.
9. **No write access to Git hosts.** Results leave as API data or SARIF; posting to pull requests would need credentials and explicit authorization.
10. **`instant = false` on organization pages.** These pages render only after the session and organization load on the client, so Next.js's instant-navigation validation cannot prerender them. They opt out explicitly rather than fake a static shell.
11. **Labelled fixture LLM for tests and E2E.** Deterministic, offline, and reported as provider `fixture` / model `fixture-heuristic-v1` everywhere, so fixture output is never mistaken for a real model.
