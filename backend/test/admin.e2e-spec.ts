import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { signWebhook } from '../src/admin/webhook.controller.js';
import { SAMPLE_DIFF } from '../src/demo/sample-diff.js';
import { FixtureProvider, LlmFactory } from '../src/llm/llm.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, createTestApp, ORIGIN, resetDb, signUp } from './helpers.js';

// assembled at runtime so the repository never contains a secret-looking literal
const SECRET = ['test', 'webhook', 'secret', 'value'].join('-');

describe('API tokens, retention and signed webhook intake', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await createTestApp({ WEBHOOK_SECRET: SECRET }, (b) => b.overrideProvider(LlmFactory).useValue({ create: () => new FixtureProvider() }));
    prisma = app.get(PrismaService);
  });
  beforeEach(() => resetDb(app));
  afterAll(() => app.close());

  async function setup() {
    const a = await signUp(app, 'a@acme.test', { organizationName: 'Acme' });
    const b = await signUp(app, 'b@globex.test', { organizationName: 'Globex' });
    const project = (await a.agent.post('/api/orgs/acme/projects').set('Origin', ORIGIN).send({ name: 'orders' }).expect(201)).body;
    await b.agent.post('/api/orgs/globex/projects').set('Origin', ORIGIN).send({ name: 'billing' }).expect(201);
    const tok = (await a.agent.post('/api/orgs/acme/api-tokens').set('Origin', ORIGIN).send({ name: 'ci' }).expect(201)).body;
    return { a, b, project, tok };
  }

  it('shows the raw token once, stores only its hash, and authenticates org routes', async () => {
    const { a, project, tok } = await setup();
    expect(tok.token).toMatch(/^rpk_[\w-]{43}$/);
    const row = await prisma.apiToken.findUniqueOrThrow({ where: { id: tok.id } });
    expect(row.tokenHash).not.toContain(tok.token);
    expect(JSON.stringify(row)).not.toContain(tok.token);
    const listed = (await a.agent.get('/api/orgs/acme/api-tokens').expect(200)).body;
    expect(listed).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain(tok.token);
    const r = (await api(app).post('/api/orgs/acme/reviews').set('Authorization', `Bearer ${tok.token}`).send({ projectId: project.id, title: 'via token', diff: SAMPLE_DIFF }).expect(202)).body;
    expect(r.status).toBe('COMPLETED');
    await api(app).get(`/api/orgs/acme/reviews/${r.id}`).set('Authorization', `Bearer ${tok.token}`).expect(200);
    const audit = await prisma.auditEvent.findMany({ where: { action: { startsWith: 'api_token' } } });
    expect(audit.map((e) => e.action)).toEqual(['api_token.created']);
  });

  it('isolates tokens to their organization and limits them to reviewer rights', async () => {
    const { tok } = await setup();
    const bearer = `Bearer ${tok.token}`;
    await api(app).get('/api/orgs/globex/reviews').set('Authorization', bearer).expect(404);
    await api(app).get('/api/orgs/acme/api-tokens').set('Authorization', bearer).expect(403);
    await api(app).post('/api/orgs/acme/billing/plan').set('Authorization', bearer).send({ plan: 'TEAM' }).expect(403);
    await api(app).get('/api/auth/me').set('Authorization', bearer).expect(401);
    await api(app).get('/api/orgs/acme/reviews').set('Authorization', 'Bearer rpk_not-a-real-token').expect(401);
  });

  it('revoked tokens stop working immediately and cannot be revoked cross-tenant', async () => {
    const { a, b, tok } = await setup();
    await b.agent.delete(`/api/orgs/globex/api-tokens/${tok.id}`).set('Origin', ORIGIN).expect(404);
    await api(app).get('/api/orgs/acme/reviews').set('Authorization', `Bearer ${tok.token}`).expect(200);
    await a.agent.delete(`/api/orgs/acme/api-tokens/${tok.id}`).set('Origin', ORIGIN).expect(204);
    await api(app).get('/api/orgs/acme/reviews').set('Authorization', `Bearer ${tok.token}`).expect(401);
    await a.agent.delete(`/api/orgs/acme/api-tokens/${tok.id}`).set('Origin', ORIGIN).expect(404);
  });

  it('retention deletes only finished reviews older than the org window, within the tenant', async () => {
    const { a, b, project } = await setup();
    const old = (await a.agent.post('/api/orgs/acme/reviews').set('Origin', ORIGIN).send({ projectId: project.id, title: 'old', diff: SAMPLE_DIFF }).expect(202)).body;
    const fresh = (await a.agent.post('/api/orgs/acme/reviews').set('Origin', ORIGIN).send({ projectId: project.id, title: 'fresh', diff: SAMPLE_DIFF }).expect(202)).body;
    const gp = await prisma.project.findFirstOrThrow({ where: { name: 'billing' } });
    const other = (await b.agent.post('/api/orgs/globex/reviews').set('Origin', ORIGIN).send({ projectId: gp.id, title: 'globex old', diff: SAMPLE_DIFF }).expect(202)).body;
    const past = new Date(Date.now() - 120 * 86_400_000);
    await prisma.review.updateMany({ where: { id: { in: [old.id, other.id] } }, data: { createdAt: past } });
    expect((await a.agent.post('/api/orgs/acme/retention/run').set('Origin', ORIGIN).expect(200)).body).toEqual({ deletedReviews: 1 });
    expect(await prisma.review.findUnique({ where: { id: old.id } })).toBeNull();
    expect(await prisma.finding.count({ where: { reviewId: old.id } })).toBe(0);
    expect(await prisma.review.findUnique({ where: { id: fresh.id } })).not.toBeNull();
    expect(await prisma.review.findUnique({ where: { id: other.id } })).not.toBeNull();
    expect(await prisma.auditEvent.count({ where: { action: 'retention.enforced' } })).toBe(1);
  });

  describe('webhook', () => {
    const send = (body: string, headers: Record<string, string>) => {
      let req = api(app).post('/api/webhooks/reviews').set('Content-Type', 'application/json');
      for (const [k, v] of Object.entries(headers)) req = req.set(k, v);
      return req.send(body);
    };
    const payload = (deliveryId = 'delivery-0001', project = 'orders') => JSON.stringify({ deliveryId, project, title: 'CI push', diff: SAMPLE_DIFF });

    it('accepts a correctly signed delivery once and replays duplicates', async () => {
      const { tok } = await setup();
      const body = payload();
      const now = Math.floor(Date.now() / 1000);
      const h = { Authorization: `Bearer ${tok.token}`, 'X-ReviewPilot-Signature': signWebhook(SECRET, now, body) };
      const first = (await send(body, h).expect(202)).body;
      expect(first).toMatchObject({ status: 'COMPLETED', replayed: false });
      const again = (await send(body, h).expect(202)).body;
      expect(again).toEqual({ ...first, replayed: true });
      expect(await prisma.review.count()).toBe(1);
    });

    it('rejects bad, stale or missing signatures and foreign projects without creating reviews', async () => {
      const { tok } = await setup();
      const body = payload();
      const now = Math.floor(Date.now() / 1000);
      const auth = `Bearer ${tok.token}`;
      expect((await send(body, { Authorization: auth }).expect(401)).body.error).toBe('bad_signature');
      expect((await send(body, { Authorization: auth, 'X-ReviewPilot-Signature': signWebhook('wrong-secret-value-xx', now, body) }).expect(401)).body.error).toBe('bad_signature');
      expect((await send(body, { Authorization: auth, 'X-ReviewPilot-Signature': signWebhook(SECRET, now - 600, body) }).expect(401)).body.error).toBe('stale_signature');
      const tampered = body.replace('CI push', 'CI pwn');
      expect((await send(tampered, { Authorization: auth, 'X-ReviewPilot-Signature': signWebhook(SECRET, now, body) }).expect(401)).body.error).toBe('bad_signature');
      expect((await send(body, { 'X-ReviewPilot-Signature': signWebhook(SECRET, now, body) }).expect(401)).body.error).toBe('bad_token');
      const foreign = payload('delivery-0002', 'billing');
      expect((await send(foreign, { Authorization: auth, 'X-ReviewPilot-Signature': signWebhook(SECRET, now, foreign) }).expect(401)).body.error).toBe('unknown_project');
      expect(await prisma.review.count()).toBe(0);
    });
  });
});

describe('webhook intake without a configured secret', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await createTestApp({ WEBHOOK_SECRET: '' });
  });
  afterAll(() => app.close());
  it('is disabled', async () => {
    await api(app).post('/api/webhooks/reviews').send({ deliveryId: 'delivery-0001', project: 'x', title: 't', diff: 'diff --git a b' }).expect(503);
  });
});
