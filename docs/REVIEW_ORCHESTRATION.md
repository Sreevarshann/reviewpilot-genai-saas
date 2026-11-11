# Review orchestration

```
parse diff ─▶ deterministic rules ─▶ model analysis ─▶ ground & validate ─▶ dedupe ─▶ persist + meter
   (events)        (events)              (events)            (events)                    completed|failed
```

**1. Parse.** `review/diff.ts` parses unified diffs (git or plain): added / deleted / renamed /
binary files, multiple hunks with exact old and new line numbers, `\ No newline` markers, language
detection, size limits and path-traversal rejection.

**2. Deterministic rules** (`review/rules.ts`, added lines only). 17 rules: hard-coded AWS keys,
private keys, provider tokens and secret assignments (evidence is redacted), SQL built by
concatenation or interpolation, command injection, `eval`/`new Function`, TLS verification
disabled, MD5/SHA-1, empty `catch`, swallowed promise rejections, bare `except`, `SELECT *`, debug
output, TODO/FIXME, queries inside loops (N+1), and source changes without test changes. Each rule
has positive and safe-equivalent negative unit tests.

**3. Model analysis.** `review/context.ts` builds a bounded (12,000 chars), secret-redacted
context that labels each new line `L<n> +`. The provider is asked for JSON matching
`REVIEW_SCHEMA` (Ollama structured output). Failures or timeouts **degrade** the review to
deterministic-only instead of failing it.

**4. Ground & validate** (`validateModelFindings`). A model finding is kept only if it passes
the schema, cites a file in the diff and lines visible in the diff (span ≤ 50), and its quoted
evidence appears on those lines (see `evidenceMatches`). Model severity is capped at HIGH.
Rejected suggestions are not stored as findings; their reasons are recorded on the `validation`
event and shown in the UI.

> Observed with `qwen3:4b-instruct` on the sample diff: the model prefixed evidence with the
> context's own labels (`"L6: return db.query(...)"`) and elided multi-line quotes with `...`, so
> the first strict validator rejected 5 of 5 suggestions. `evidenceMatches` now strips a leading
> line label and diff marker and requires every elided fragment to appear in order (with at least
> one fragment ≥ 8 characters). Re-running the same review kept 4 and rejected 1, a quote spanning
> lines outside the cited range. That is one manual observation, not an evaluation.

**5. Dedupe.** Findings are fingerprinted by `(path, line, category, normalised title)`;
deterministic findings win over model findings on the same line and category.

**6. Persist and meter.** Findings, stats (`bySeverity`, `deterministic`, `modelAccepted`,
`modelRejected`, `contextTruncated`), tokens and duration are written in one transaction with
usage records.

**Queue semantics.** BullMQ job id = review id, 2 attempts, concurrency 1. The orchestrator only
runs reviews still in `QUEUED`, so duplicate deliveries are no-ops. Jobs for unknown reviews
are logged and ignored. `QUEUE_PREFIX` isolates environments sharing one Redis; without it, a
dev worker consumed test jobs (fixed in `78a6b77`).

**Idempotency.** `Idempotency-Key` (8–100 chars of `[A-Za-z0-9_-]`) is validated before any side
effect (invalid → 400, no review created). Same key + same payload replays the stored review
(`Idempotent-Replayed: true`); same key + different payload → 409. Concurrent duplicates race on
the unique index and resolve to one review. The web client generates one key per draft and
rotates it when the draft changes.

**Versions.** `POST /reviews/:id/rerun` creates the next version under the same root, either the
stored diff again or a revised `{ diff, title }`. `GET /reviews/:base/compare/:head` classifies
findings as introduced, resolved or persisting by fingerprint.
