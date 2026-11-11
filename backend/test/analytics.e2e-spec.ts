import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SAMPLE_DIFF } from '../src/demo/sample-diff.js';
import { FixtureProvider, LlmFactory } from '../src/llm/llm.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp, ORIGIN, resetDb, signUp } from './helpers.js';

describe('analytics', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await createTestApp({}, (b) => b.overrideProvider(LlmFactory).useValue({ create: () => new FixtureProvider() }));
    prisma = app.get(PrismaService);
  });
  beforeEach(() => resetDb(app));
  afterAll(() => app.close());

  async function seed() {
    const a = await signUp(app, 'a@acme.test', { organizationName: 'Acme' });
    const b = await signUp(app, 'b@globex.test', { organizationName: 'Globex' });
    const p1 = (await a.agent.post('/api/orgs/acme/projects').set('Origin', ORIGIN).send({ name: 'orders' }).expect(201)).body;
    const p2 = (await a.agent.post('/api/orgs/acme/projects').set('Origin', ORIGIN).send({ name: 'web' }).expect(201)).body;
    const gp = (await b.agent.post('/api/orgs/globex/projects').set('Origin', ORIGIN).send({ name: 'billing' }).expect(201)).body;
    const r1 = (await a.agent.post('/api/orgs/acme/reviews').set('Origin', ORIGIN).send({ projectId: p1.id, title: 'one', diff: SAMPLE_DIFF }).expect(202)).body;
    await a.agent.post('/api/orgs/acme/reviews').set('Origin', ORIGIN).send({ projectId: p2.id, title: 'two', diff: SAMPLE_DIFF }).expect(202);
    for (let i = 0; i < 3; i++) await b.agent.post('/api/orgs/globex/reviews').set('Origin', ORIGIN).send({ projectId: gp.id, title: `g${i}`, diff: SAMPLE_DIFF }).expect(202);
    return { a, b, p1, p2, gp, r1 };
  }

  it('aggregates only the tenant’s own reviews and findings, consistently with stored rows', async () => {
    const { a } = await seed();
    const org = await prisma.organization.findUniqueOrThrow({ where: { slug: 'acme' } });
    const findings = await prisma.finding.findMany({ where: { organizationId: org.id } });
    const reviews = await prisma.review.findMany({ where: { organizationId: org.id } });
    const body = (await a.agent.get('/api/orgs/acme/analytics').expect(200)).body;
    expect(body.reviews).toMatchObject({ total: 2, completed: 2, failed: 0, failureRate: 0 });
    expect(body.reviewsOverTime).toHaveLength(1);
    expect(body.findingsBySeverity.reduce((s: number, r: { count: number }) => s + r.count, 0)).toBe(findings.length);
    expect(body.findingsByCategory.reduce((s: number, r: { count: number }) => s + r.count, 0)).toBe(findings.length);
    expect(body.latencyMs.samples).toBe(2);
    expect(body.latencyMs.max).toBe(Math.max(...reviews.map((r) => r.durationMs ?? 0)));
    expect(body.models).toEqual([{ provider: 'fixture', model: 'fixture-heuristic-v1', reviews: 2, tokensIn: reviews.reduce((s, r) => s + r.tokensIn, 0), tokensOut: reviews.reduce((s, r) => s + r.tokensOut, 0), avgMs: expect.any(Number) }]);
    expect(body.projects.map((p: { name: string }) => p.name).sort()).toEqual(['orders', 'web']);
    expect(body.triage.all).toMatchObject({ open: findings.length, triaged: 0, acceptanceRate: null });
  });

  it('reports triage outcomes per confidence and an acceptance rate over triaged findings only', async () => {
    const { a, r1 } = await seed();
    const fs = await prisma.finding.findMany({ where: { reviewId: r1.id, confidence: 'DETERMINISTIC' }, orderBy: { id: 'asc' } });
    expect(fs.length).toBeGreaterThanOrEqual(3);
    await a.agent.patch(`/api/orgs/acme/findings/${fs[0].id}`).set('Origin', ORIGIN).send({ state: 'ACCEPTED' }).expect(200);
    await a.agent.patch(`/api/orgs/acme/findings/${fs[1].id}`).set('Origin', ORIGIN).send({ state: 'ACCEPTED' }).expect(200);
    await a.agent.patch(`/api/orgs/acme/findings/${fs[2].id}`).set('Origin', ORIGIN).send({ state: 'FALSE_POSITIVE' }).expect(200);
    const t = (await a.agent.get('/api/orgs/acme/analytics').expect(200)).body.triage;
    expect(t.deterministic).toMatchObject({ accepted: 2, falsePositive: 1, dismissed: 0, triaged: 3, acceptanceRate: 0.667 });
    expect(t.model.triaged).toBe(0);
    expect(t.note).toMatch(/not a precision/);
  });

  it('filters by project and window, rejecting foreign projects and bad ranges', async () => {
    const { a, b, p1, gp } = await seed();
    const one = (await a.agent.get(`/api/orgs/acme/analytics?projectId=${p1.id}`).expect(200)).body;
    expect(one.reviews.total).toBe(1);
    expect(one.projects).toHaveLength(1);
    await a.agent.get(`/api/orgs/acme/analytics?projectId=${gp.id}`).expect(404);
    await a.agent.get('/api/orgs/acme/analytics?days=0').expect(422);
    await a.agent.get('/api/orgs/acme/analytics?days=400').expect(422);
    await prisma.review.updateMany({ where: { project: { id: p1.id } }, data: { createdAt: new Date(Date.now() - 10 * 86_400_000) } });
    expect((await a.agent.get('/api/orgs/acme/analytics?days=7').expect(200)).body.reviews.total).toBe(1);
    await b.agent.get('/api/orgs/acme/analytics').expect(404);
  });
});
