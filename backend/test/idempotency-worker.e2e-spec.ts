import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SAMPLE_DIFF } from '../src/demo/sample-diff.js';
import { FixtureProvider, LlmFactory } from '../src/llm/llm.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { ReviewOrchestrator } from '../src/review/orchestrator.js';
import { createTestApp, ORIGIN, resetDb, signUp } from './helpers.js';

const factory = { create: () => new FixtureProvider() };

async function setup(app: INestApplication) {
  const s = await signUp(app, 'dev@acme.test', { organizationName: 'Acme' });
  const project = (await s.agent.post('/api/orgs/acme/projects').set('Origin', ORIGIN).send({ name: 'orders' }).expect(201)).body;
  return { ...s, project };
}

async function sideEffects(prisma: PrismaService) {
  const [reviews, events, usage, audit] = await Promise.all([prisma.review.count(), prisma.reviewEvent.count(), prisma.usageRecord.count(), prisma.auditEvent.count({ where: { action: 'review.submitted' } })]);
  return { reviews, events, usage, audit };
}

describe('Idempotency-Key handling', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await createTestApp({}, (b) => b.overrideProvider(LlmFactory).useValue(factory));
    prisma = app.get(PrismaService);
  });
  beforeEach(() => resetDb(app));
  afterAll(() => app.close());

  it.each(['short', 'has spaces in it', 'semi;colon-key', 'x'.repeat(101), 'unicodé-key-123'])('rejects invalid key %j with 400 and no side effects', async (key) => {
    const { agent, project } = await setup(app);
    const before = await sideEffects(prisma);
    const res = await agent.post('/api/orgs/acme/reviews').set('Origin', ORIGIN).set('Idempotency-Key', key).send({ projectId: project.id, title: 't', diff: SAMPLE_DIFF }).expect(400);
    expect(res.body.error).toBe('invalid_idempotency_key');
    expect(await sideEffects(prisma)).toEqual(before);
  });

  it('replays the same request and rejects key reuse with a different payload', async () => {
    const { agent, project } = await setup(app);
    const body = { projectId: project.id, title: 'once', diff: SAMPLE_DIFF };
    const first = await agent.post('/api/orgs/acme/reviews').set('Origin', ORIGIN).set('Idempotency-Key', 'key-0001-abcd').send(body).expect(202);
    const after = await sideEffects(prisma);
    const replay = await agent.post('/api/orgs/acme/reviews').set('Origin', ORIGIN).set('Idempotency-Key', 'key-0001-abcd').send(body).expect(202);
    expect(replay.body.id).toBe(first.body.id);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    const conflict = await agent.post('/api/orgs/acme/reviews').set('Origin', ORIGIN).set('Idempotency-Key', 'key-0001-abcd').send({ ...body, title: 'different' }).expect(409);
    expect(conflict.body.error).toBe('idempotency_conflict');
    expect(await sideEffects(prisma)).toEqual(after); // neither the replay nor the conflict did anything
  });

  it('concurrent duplicate submissions with one key create exactly one review', async () => {
    const { agent, project } = await setup(app);
    const body = { projectId: project.id, title: 'race', diff: SAMPLE_DIFF };
    const results = await Promise.all(Array.from({ length: 4 }, () => agent.post('/api/orgs/acme/reviews').set('Origin', ORIGIN).set('Idempotency-Key', 'race-key-0001').send(body)));
    expect(results.map((r) => r.status)).toEqual([202, 202, 202, 202]);
    expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
    expect(await prisma.review.count()).toBe(1);
    expect(await prisma.usageRecord.count({ where: { kind: 'review' } })).toBe(1);
  });

  it('keys are scoped per organization', async () => {
    const a = await setup(app);
    const b = await signUp(app, 'b@globex.test', { organizationName: 'Globex' });
    const bp = (await b.agent.post('/api/orgs/globex/projects').set('Origin', ORIGIN).send({ name: 'orders' }).expect(201)).body;
    const ra = await a.agent.post('/api/orgs/acme/reviews').set('Origin', ORIGIN).set('Idempotency-Key', 'shared-key-001').send({ projectId: a.project.id, title: 'a', diff: SAMPLE_DIFF }).expect(202);
    const rb = await b.agent.post('/api/orgs/globex/reviews').set('Origin', ORIGIN).set('Idempotency-Key', 'shared-key-001').send({ projectId: bp.id, title: 'a', diff: SAMPLE_DIFF }).expect(202);
    expect(rb.body.id).not.toBe(ra.body.id);
  });
});

describe('review worker lifecycle', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await createTestApp({ REVIEW_INLINE: 'false' }, (b) => b.overrideProvider(LlmFactory).useValue(factory));
    prisma = app.get(PrismaService);
  });
  beforeEach(() => resetDb(app));
  afterAll(() => app.close()); // must shut the BullMQ worker down cleanly or vitest hangs

  async function waitFor(id: string, statuses: string[]) {
    for (let i = 0; i < 75; i++) {
      const r = await prisma.review.findUniqueOrThrow({ where: { id } });
      if (statuses.includes(r.status)) return r;
      await new Promise((ok) => setTimeout(ok, 200));
    }
    throw new Error(`review ${id} did not reach ${statuses.join('/')}`);
  }

  it('queues, processes through the worker and records the full event sequence', async () => {
    const { agent, project } = await setup(app);
    const r = (await agent.post('/api/orgs/acme/reviews').set('Origin', ORIGIN).send({ projectId: project.id, title: 'async', diff: SAMPLE_DIFF }).expect(202)).body;
    expect(['QUEUED', 'RUNNING', 'COMPLETED']).toContain(r.status);
    const done = await waitFor(r.id, ['COMPLETED', 'FAILED']);
    expect(done.status).toBe('COMPLETED');
    const stages = (await prisma.reviewEvent.findMany({ where: { reviewId: r.id }, orderBy: { seq: 'asc' } })).map((e) => e.seq);
    expect(stages).toEqual(Array.from({ length: stages.length }, (_, i) => i + 1)); // gap-free, ordered
    expect(await prisma.finding.count({ where: { reviewId: r.id, confidence: 'MODEL' } })).toBeGreaterThan(0); // fixture model ran
  });

  it('re-running a completed review is a no-op (safe for job retries/duplicates)', async () => {
    const { agent, project } = await setup(app);
    const r = (await agent.post('/api/orgs/acme/reviews').set('Origin', ORIGIN).send({ projectId: project.id, title: 'once', diff: SAMPLE_DIFF }).expect(202)).body;
    await waitFor(r.id, ['COMPLETED']);
    const counts = async () => ({ findings: await prisma.finding.count({ where: { reviewId: r.id } }), files: await prisma.reviewFile.count({ where: { reviewId: r.id } }), usage: await prisma.usageRecord.count({ where: { reviewId: r.id } }) });
    const before = await counts();
    await app.get(ReviewOrchestrator).run(r.id);
    await app.get(ReviewOrchestrator).run(r.id);
    expect(await counts()).toEqual(before);
  });

  it('marks a review FAILED with a terminal event when its stored diff cannot be parsed', async () => {
    const { project } = await setup(app);
    const org = await prisma.organization.findUniqueOrThrow({ where: { slug: 'acme' } });
    const bad = await prisma.review.create({ data: { organizationId: org.id, projectId: project.id, authorId: 'test', title: 'corrupt', diff: 'not a diff at all', diffSha256: 'x' } });
    await app.get(ReviewOrchestrator).run(bad.id);
    const r = await prisma.review.findUniqueOrThrow({ where: { id: bad.id } });
    expect(r.status).toBe('FAILED');
    expect(r.error).toMatch(/No file changes/);
    const last = await prisma.reviewEvent.findFirstOrThrow({ where: { reviewId: bad.id }, orderBy: { seq: 'desc' } });
    expect(last).toMatchObject({ stage: 'failed', status: 'failed' });
    expect(await prisma.usageRecord.count({ where: { reviewId: bad.id } })).toBe(0); // failed reviews are not metered
  });
});
