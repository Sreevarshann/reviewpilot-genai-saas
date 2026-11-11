import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SAMPLE_DIFF } from '../src/demo/sample-diff.js';
import { FixtureProvider, LlmFactory } from '../src/llm/llm.js';
import { MailService } from '../src/mail/mail.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp, ORIGIN, resetDb, signUp } from './helpers.js';

describe('findings workflow', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await createTestApp({}, (b) => b.overrideProvider(LlmFactory).useValue({ create: () => new FixtureProvider() }));
    prisma = app.get(PrismaService);
  });
  beforeEach(() => resetDb(app));
  afterAll(() => app.close());

  async function reviewed() {
    const s = await signUp(app, 'dev@acme.test', { organizationName: 'Acme' });
    const project = (await s.agent.post('/api/orgs/acme/projects').set('Origin', ORIGIN).send({ name: 'orders' }).expect(201)).body;
    const review = (await s.agent.post('/api/orgs/acme/reviews').set('Origin', ORIGIN).send({ projectId: project.id, title: 'Orders', diff: SAMPLE_DIFF }).expect(202)).body;
    const findings = (await s.agent.get(`/api/orgs/acme/reviews/${review.id}/findings`).expect(200)).body as { id: string; source: string; state: string; title: string }[];
    return { ...s, project, review, findings };
  }

  it('accepts, dismisses, marks false positives and reopens findings with an audit trail', async () => {
    const { agent, findings } = await reviewed();
    const sql = findings.find((f) => f.source === 'rule:sql-injection-concat')!;
    const todo = findings.find((f) => f.source === 'rule:todo')!;
    const debug = findings.find((f) => f.source === 'rule:debug-output')!;
    expect((await agent.patch(`/api/orgs/acme/findings/${sql.id}`).set('Origin', ORIGIN).send({ state: 'ACCEPTED' }).expect(200)).body).toMatchObject({ state: 'ACCEPTED' });
    await agent.patch(`/api/orgs/acme/findings/${todo.id}`).set('Origin', ORIGIN).send({ state: 'DISMISSED', note: 'Tracked in JIRA-123' }).expect(200);
    await agent.patch(`/api/orgs/acme/findings/${debug.id}`).set('Origin', ORIGIN).send({ state: 'FALSE_POSITIVE' }).expect(200);
    await agent.patch(`/api/orgs/acme/findings/${debug.id}`).set('Origin', ORIGIN).send({ state: 'OPEN' }).expect(200);
    await agent.patch(`/api/orgs/acme/findings/${debug.id}`).set('Origin', ORIGIN).send({ state: 'MERGED' }).expect(422);
    const todoRow = await prisma.finding.findUniqueOrThrow({ where: { id: todo.id }, include: { comments: true } });
    expect(todoRow.comments[0].body).toBe('Tracked in JIRA-123');
    expect(todoRow.stateChangedBy).toBeTruthy();
    expect(await prisma.auditEvent.count({ where: { action: 'finding.state_changed' } })).toBe(4);
  });

  it('viewers cannot change findings; other tenants get 404', async () => {
    const { agent, findings } = await reviewed();
    await agent.post('/api/orgs/acme/invitations').set('Origin', ORIGIN).send({ email: 'v@acme.test', role: 'VIEWER' }).expect(201);
    const token = app.get(MailService).outbox.at(-1)!.text.split('token=')[1];
    const viewer = await signUp(app, 'v@acme.test');
    await viewer.agent.post('/api/invitations/accept').set('Origin', ORIGIN).send({ token }).expect(200);
    await viewer.agent.patch(`/api/orgs/acme/findings/${findings[0].id}`).set('Origin', ORIGIN).send({ state: 'DISMISSED' }).expect(403);
    const other = await signUp(app, 'x@globex.test', { organizationName: 'Globex' });
    await other.agent.patch(`/api/orgs/globex/findings/${findings[0].id}`).set('Origin', ORIGIN).send({ state: 'DISMISSED' }).expect(404);
    await other.agent.post(`/api/orgs/globex/findings/${findings[0].id}/comments`).set('Origin', ORIGIN).send({ body: 'hi' }).expect(404);
  });

  it('compares review versions by fingerprint', async () => {
    const { agent, project, review } = await reviewed();
    const fixedDiff = SAMPLE_DIFF.replace(`return db.query("SELECT * FROM orders WHERE id = '" + id + "'");`, "return db.query('SELECT id, status FROM orders WHERE id = $1', [id]);");
    const v2 = (await agent.post('/api/orgs/acme/reviews').set('Origin', ORIGIN).send({ projectId: project.id, title: 'Orders v2', diff: fixedDiff }).expect(202)).body;
    const cmp = (await agent.get(`/api/orgs/acme/reviews/${review.id}/compare/${v2.id}`).expect(200)).body;
    expect(cmp.resolved.map((f: { source: string }) => f.source).sort()).toEqual(['rule:select-star', 'rule:sql-injection-concat']);
    expect(cmp.introduced).toEqual([]);
    expect(cmp.persisting.length).toBeGreaterThan(4);
  });

  it('exports JSON, CSV (formula-safe), Markdown and SARIF', async () => {
    const { agent, review, findings } = await reviewed();
    await prisma.finding.update({ where: { id: findings[0].id }, data: { title: '=HYPERLINK("http://evil")' } });
    const csv = await agent.get(`/api/orgs/acme/reviews/${review.id}/export?format=csv`).expect(200);
    expect(csv.headers['content-disposition']).toContain('.csv');
    expect(csv.text.split('\n')[0]).toBe('severity,category,confidence,state,path,lineStart,lineEnd,title,description,evidence,suggestedFix,source');
    expect(csv.text).toContain(`"'=HYPERLINK(""http://evil"")"`);
    const sarif = JSON.parse((await agent.get(`/api/orgs/acme/reviews/${review.id}/export?format=sarif`).expect(200)).text);
    expect(sarif.version).toBe('2.1.0');
    expect(sarif.runs[0].results).toHaveLength(findings.length);
    expect(sarif.runs[0].results[0].locations[0].physicalLocation.region.startLine).toBeGreaterThan(0);
    const md = (await agent.get(`/api/orgs/acme/reviews/${review.id}/export?format=md`).expect(200)).text;
    expect(md).toContain('Suggested fixes are suggestions');
    const json = JSON.parse((await agent.get(`/api/orgs/acme/reviews/${review.id}/export`).expect(200)).text);
    expect(json.findings).toHaveLength(findings.length);
  });
});
