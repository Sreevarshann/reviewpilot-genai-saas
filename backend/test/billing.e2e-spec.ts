import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SAMPLE_DIFF } from '../src/demo/sample-diff.js';
import { FixtureProvider, LlmFactory } from '../src/llm/llm.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, createTestApp, ORIGIN, resetDb, signUp } from './helpers.js';

describe('usage metering and plans', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await createTestApp({}, (b) => b.overrideProvider(LlmFactory).useValue({ create: () => new FixtureProvider() }));
    prisma = app.get(PrismaService);
  });
  beforeEach(() => resetDb(app));
  afterAll(() => app.close());

  async function org() {
    const s = await signUp(app, 'o@acme.test', { organizationName: 'Acme' });
    const project = (await s.agent.post('/api/orgs/acme/projects').set('Origin', ORIGIN).send({ name: 'orders' }).expect(201)).body;
    return { ...s, project };
  }

  it('publishes the plan catalogue as non-purchasable demo tiers', async () => {
    const body = (await api(app).get('/api/plans').expect(200)).body;
    expect(body.note).toMatch(/Not purchasable/);
    expect(body.plans.map((p: { id: string }) => p.id)).toEqual(['FREE', 'TEAM', 'BUSINESS']);
  });

  it('meters reviews, tokens and processing time from persisted records', async () => {
    const { agent, project } = await org();
    for (let i = 0; i < 2; i++) await agent.post('/api/orgs/acme/reviews').set('Origin', ORIGIN).send({ projectId: project.id, title: `r${i}`, diff: SAMPLE_DIFF }).expect(202);
    const u = (await agent.get('/api/orgs/acme/usage').expect(200)).body;
    const reviews = await prisma.review.findMany();
    expect(u.reviews).toEqual({ used: 2, limit: 25 });
    expect(u.llmTokens.used).toBe(reviews.reduce((n, r) => n + r.tokensIn + r.tokensOut, 0));
    expect(u.processing.totalMs).toBe(reviews.reduce((n, r) => n + (r.durationMs ?? 0), 0));
    expect(u.byModel).toEqual([{ provider: 'fixture', model: 'fixture-heuristic-v1', tokens: u.llmTokens.used, reviews: 2 }]);
    expect(u.daily).toHaveLength(1);
    expect(u.daily[0].reviews).toBe(2);
    expect(u.seats).toEqual({ used: 1, limit: 3 });
  });

  it('skips model analysis once the monthly token budget is exhausted', async () => {
    const { agent, project } = await org();
    const o = await prisma.organization.findUniqueOrThrow({ where: { slug: 'acme' } });
    await prisma.usageRecord.create({ data: { organizationId: o.id, kind: 'llm_tokens', quantity: 200_000 } });
    const r = (await agent.post('/api/orgs/acme/reviews').set('Origin', ORIGIN).send({ projectId: project.id, title: 't', diff: SAMPLE_DIFF }).expect(202)).body;
    expect(r.status).toBe('COMPLETED');
    expect(r.stats.modelError).toMatch(/token budget exhausted/);
    expect(await prisma.finding.count({ where: { reviewId: r.id, confidence: 'MODEL' } })).toBe(0);
    expect(r.tokensIn + r.tokensOut).toBe(0);
  });

  it('mock billing changes plans without charging, owner only, and blocks unsafe downgrades', async () => {
    const { agent } = await org();
    const res = (await agent.post('/api/orgs/acme/billing/plan').set('Origin', ORIGIN).send({ plan: 'TEAM' }).expect(200)).body;
    expect(res).toMatchObject({ plan: 'TEAM', provider: 'mock', charged: false });
    expect((await agent.get('/api/orgs/acme/usage').expect(200)).body.reviews.limit).toBe(500);
    for (const n of ['a', 'b', 'c']) await agent.post('/api/orgs/acme/projects').set('Origin', ORIGIN).send({ name: n }).expect(201);
    expect((await agent.post('/api/orgs/acme/billing/plan').set('Origin', ORIGIN).send({ plan: 'FREE' }).expect(409)).body.error).toBe('downgrade_blocked');
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { action: 'billing.plan_changed' } });
    expect(audit.metadata).toMatchObject({ provider: 'mock', charged: false });
    await agent.post('/api/orgs/acme/billing/plan').set('Origin', ORIGIN).send({ plan: 'PLATINUM' }).expect(422);
  });

  it('usage of one organization is invisible to another', async () => {
    await org();
    const other = await signUp(app, 'x@globex.test', { organizationName: 'Globex' });
    await other.agent.get('/api/orgs/acme/usage').expect(404);
    expect((await other.agent.get('/api/orgs/globex/usage').expect(200)).body.reviews.used).toBe(0);
  });
});
