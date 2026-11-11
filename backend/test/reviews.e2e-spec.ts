import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EXPECTED_DETERMINISTIC, SAMPLE_DIFF } from '../src/demo/sample-diff.js';
import { LlmFactory, LlmError, type LlmProvider, type LlmResult } from '../src/llm/llm.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp, ORIGIN, resetDb, signUp } from './helpers.js';

class Scripted implements LlmProvider {
  readonly name = 'scripted';
  readonly model = 'scripted-v1';
  constructor(private readonly reply: () => Promise<LlmResult>) {}
  completeJson(): Promise<LlmResult> {
    return this.reply();
  }
}

let next: LlmProvider | null = null;
const factory = { create: () => next ?? new (class extends Scripted {})(() => Promise.resolve({ json: { findings: [] }, tokensIn: 0, tokensOut: 0, latencyMs: 0 })) };

async function setup(app: INestApplication, email = 'dev@acme.test', org = 'Acme') {
  const s = await signUp(app, email, { organizationName: org });
  const slug = s.user.memberships[0].organization.slug;
  const project = (await s.agent.post(`/api/orgs/${slug}/projects`).set('Origin', ORIGIN).send({ name: 'orders-service' }).expect(201)).body;
  return { ...s, slug, project };
}

describe('review pipeline', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await createTestApp({}, (b) => b.overrideProvider(LlmFactory).useValue(factory));
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => {
    next = null;
    await resetDb(app);
  });
  afterAll(() => app.close());

  it('reports every planted deterministic defect on the exact line', async () => {
    const { agent, slug, project } = await setup(app);
    const r = (await agent.post(`/api/orgs/${slug}/reviews`).set('Origin', ORIGIN).send({ projectId: project.id, title: 'Orders refactor', diff: SAMPLE_DIFF }).expect(202)).body;
    expect(r.status).toBe('COMPLETED');
    expect(r.files.map((f: { path: string }) => f.path)).toEqual(['src/orders/orders.repository.ts', 'src/orders/orders.controller.ts']);
    const findings = (await agent.get(`/api/orgs/${slug}/reviews/${r.id}/findings`).expect(200)).body as { path: string; lineStart: number; source: string; confidence: string }[];
    for (const e of EXPECTED_DETERMINISTIC) {
      expect(findings.some((f) => f.path === e.path && f.lineStart === e.line && f.source === e.rule), JSON.stringify(e)).toBe(true);
    }
    expect(findings.every((f) => f.confidence === 'DETERMINISTIC')).toBe(true);
    expect((await prisma.usageRecord.findMany({ where: { reviewId: r.id } })).map((u) => u.kind).sort()).toEqual(['llm_tokens', 'review', 'review_ms']);
  });

  it('keeps grounded model suggestions and rejects hallucinated ones with reasons', async () => {
    next = new Scripted(() => Promise.resolve({ tokensIn: 900, tokensOut: 120, latencyMs: 5, json: { findings: [
      { path: 'src/orders/orders.controller.ts', line_start: 13, category: 'BUG', severity: 'CRITICAL', title: 'parseInt without radix or NaN check', description: 'An invalid percent becomes NaN.', evidence: "parseInt(req.body.percent)", suggested_fix: 'Validate with a schema.' },
      { path: 'src/orders/orders.controller.ts', line_start: 400, category: 'BUG', severity: 'HIGH', title: 'Made-up line', description: 'Refers to a line that does not exist.', evidence: 'x' },
      { path: 'src/payments/stripe.ts', line_start: 3, category: 'SECURITY', severity: 'HIGH', title: 'File not in diff', description: 'Refers to a file that was not changed.', evidence: 'x' },
      { path: 'src/orders/orders.controller.ts', line_start: 13, category: 'SECURITY', severity: 'HIGH', title: 'Wrong evidence', description: 'Quotes code that is not on this line.', evidence: 'eval(userInput)' },
      { path: 'src/orders/orders.repository.ts', line_start: 6, category: 'SECURITY', severity: 'HIGH', title: 'SQL injection (model duplicate)', description: 'Duplicates the deterministic rule.', evidence: 'db.query("SELECT * FROM orders' },
      { bogus: true },
    ] } }));
    const { agent, slug, project } = await setup(app);
    const r = (await agent.post(`/api/orgs/${slug}/reviews`).set('Origin', ORIGIN).send({ projectId: project.id, title: 't', diff: SAMPLE_DIFF }).expect(202)).body;
    const model = (await agent.get(`/api/orgs/${slug}/reviews/${r.id}/findings?confidence=MODEL`).expect(200)).body;
    expect(model).toHaveLength(1);
    expect(model[0]).toMatchObject({ lineStart: 13, severity: 'HIGH', title: 'parseInt without radix or NaN check', source: 'model' }); // CRITICAL capped
    expect(r.stats).toMatchObject({ modelAccepted: 2, modelRejected: 4 }); // the duplicate is accepted then deduped
    const events = (await prisma.reviewEvent.findMany({ where: { reviewId: r.id, stage: 'validation', status: 'completed' } }))[0].detail as { rejectedReasons: { reason: string }[] };
    expect(events.rejectedReasons.map((x) => x.reason).sort()).toEqual(['cited lines are not part of the diff', 'evidence does not match the cited lines', 'file not in diff', 'schema: path Invalid input: expected string, received undefined'].sort());
    expect(r.tokensIn).toBe(900);
  });

  it('completes with deterministic findings when the model fails', async () => {
    next = new Scripted(() => Promise.reject(new LlmError('Model request failed: TimeoutError')));
    const { agent, slug, project } = await setup(app);
    const r = (await agent.post(`/api/orgs/${slug}/reviews`).set('Origin', ORIGIN).send({ projectId: project.id, title: 't', diff: SAMPLE_DIFF }).expect(202)).body;
    expect(r.status).toBe('COMPLETED');
    expect(r.stats.modelError).toContain('TimeoutError');
    expect(r.stats.deterministic).toBeGreaterThan(5);
  });

  it('rejects invalid diffs and unsafe paths', async () => {
    const { agent, slug, project } = await setup(app);
    expect((await agent.post(`/api/orgs/${slug}/reviews`).set('Origin', ORIGIN).send({ projectId: project.id, title: 't', diff: 'just some words here' }).expect(400)).body.error).toBe('invalid_diff');
    await agent.post(`/api/orgs/${slug}/reviews`).set('Origin', ORIGIN).send({ projectId: project.id, title: 't', diff: 'diff --git a/../x b/../x\n' }).expect(400);
  });

  it('is idempotent with an Idempotency-Key', async () => {
    const { agent, slug, project } = await setup(app);
    const body = { projectId: project.id, title: 'once', diff: SAMPLE_DIFF };
    const a = await agent.post(`/api/orgs/${slug}/reviews`).set('Origin', ORIGIN).set('Idempotency-Key', 'submit-123456').send(body).expect(202);
    const b = await agent.post(`/api/orgs/${slug}/reviews`).set('Origin', ORIGIN).set('Idempotency-Key', 'submit-123456').send(body).expect(202);
    expect(b.body.id).toBe(a.body.id);
    expect(b.headers['idempotent-replayed']).toBe('true');
    expect(await prisma.review.count()).toBe(1);
    await agent.post(`/api/orgs/${slug}/reviews`).set('Origin', ORIGIN).set('Idempotency-Key', 'bad key!').send(body).expect(400);
  });

  it('enforces the diff-size and monthly review limits of the plan', async () => {
    const { agent, slug, project } = await setup(app);
    const huge = SAMPLE_DIFF + '+'.padEnd(10, 'x').concat('\n').repeat(30_000);
    expect((await agent.post(`/api/orgs/${slug}/reviews`).set('Origin', ORIGIN).send({ projectId: project.id, title: 't', diff: huge }).expect(413)).body.limit).toBe('diff_size');
    const org = await prisma.organization.findUniqueOrThrow({ where: { slug } });
    const now = new Date();
    await prisma.review.createMany({ data: Array.from({ length: 25 }, (_, i) => ({ organizationId: org.id, projectId: project.id, authorId: 'seed', title: `r${i}`, diff: 'x', diffSha256: 'x', status: 'COMPLETED' as const, createdAt: now })) });
    expect((await agent.post(`/api/orgs/${slug}/reviews`).set('Origin', ORIGIN).send({ projectId: project.id, title: 't', diff: SAMPLE_DIFF }).expect(403)).body.limit).toBe('reviews_per_month');
  });

  it('isolates reviews between organizations', async () => {
    const a = await setup(app, 'a@acme.test', 'Acme');
    const b = await setup(app, 'b@globex.test', 'Globex');
    const r = (await a.agent.post(`/api/orgs/${a.slug}/reviews`).set('Origin', ORIGIN).send({ projectId: a.project.id, title: 'secret', diff: SAMPLE_DIFF }).expect(202)).body;
    await b.agent.get(`/api/orgs/${a.slug}/reviews/${r.id}`).expect(404);
    await b.agent.get(`/api/orgs/${b.slug}/reviews/${r.id}`).expect(404);
    await b.agent.get(`/api/orgs/${b.slug}/reviews/${r.id}/findings`).expect(404);
    await b.agent.get(`/api/orgs/${b.slug}/reviews/${r.id}/diff`).expect(404);
    await b.agent.post(`/api/orgs/${b.slug}/reviews`).set('Origin', ORIGIN).send({ projectId: a.project.id, title: 'x', diff: SAMPLE_DIFF }).expect(404);
    expect((await b.agent.get(`/api/orgs/${b.slug}/reviews`).expect(200)).body).toEqual([]);
  });

  it('streams real progress events over SSE and creates versions on re-review', async () => {
    const { agent, slug, project } = await setup(app);
    const r = (await agent.post(`/api/orgs/${slug}/reviews`).set('Origin', ORIGIN).send({ projectId: project.id, title: 't', diff: SAMPLE_DIFF }).expect(202)).body;
    const sse = await agent.get(`/api/orgs/${slug}/reviews/${r.id}/events`).buffer(true).parse((res, cb) => {
      let d = '';
      res.on('data', (c: Buffer) => (d += c.toString()));
      res.on('end', () => cb(null, d));
    });
    expect(sse.headers['content-type']).toContain('text/event-stream');
    const stages = [...String(sse.body).matchAll(/"stage":"(\w+)","status":"(\w+)"/g)].map((m) => `${m[1]}:${m[2]}`);
    expect(stages).toEqual(['parsing:started', 'parsing:completed', 'static_checks:started', 'static_checks:completed', 'model_analysis:started', 'model_analysis:completed', 'validation:started', 'validation:completed', 'completed:completed']);
    const v2 = (await agent.post(`/api/orgs/${slug}/reviews/${r.id}/rerun`).set('Origin', ORIGIN).expect(202)).body;
    expect(v2).toMatchObject({ version: 2, parentReviewId: r.id, status: 'COMPLETED' });
    await agent.get(`/api/orgs/${slug}/reviews/${r.id}/events`).set('Origin', 'x').expect(200); // GET is not origin-checked
  });

  it('viewers cannot submit reviews', async () => {
    const owner = await setup(app);
    await owner.agent.post(`/api/orgs/${owner.slug}/invitations`).set('Origin', ORIGIN).send({ email: 'v@acme.test', role: 'VIEWER' }).expect(201);
    const { MailService } = await import('../src/mail/mail.service.js');
    const token = app.get(MailService).outbox.at(-1)!.text.split('token=')[1];
    const v = await signUp(app, 'v@acme.test');
    await v.agent.post('/api/invitations/accept').set('Origin', ORIGIN).send({ token }).expect(200);
    await v.agent.post(`/api/orgs/${owner.slug}/reviews`).set('Origin', ORIGIN).send({ projectId: owner.project.id, title: 't', diff: SAMPLE_DIFF }).expect(403);
  });
});

describe('queued processing', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await createTestApp({ REVIEW_INLINE: 'false' }, (b) => b.overrideProvider(LlmFactory).useValue(factory));
  });
  afterAll(() => app.close());

  it('processes reviews asynchronously through the BullMQ worker', async () => {
    await resetDb(app);
    const { agent, slug, project } = await setup(app, 'q@acme.test', 'Queue Co');
    const r = (await agent.post(`/api/orgs/${slug}/reviews`).set('Origin', ORIGIN).send({ projectId: project.id, title: 'async', diff: SAMPLE_DIFF }).expect(202)).body;
    expect(['QUEUED', 'RUNNING']).toContain(r.status);
    let status = r.status;
    for (let i = 0; i < 50 && status !== 'COMPLETED'; i++) {
      await new Promise((ok) => setTimeout(ok, 200));
      status = (await agent.get(`/api/orgs/${slug}/reviews/${r.id}`)).body.status;
    }
    expect(status).toBe('COMPLETED');
  });
});
