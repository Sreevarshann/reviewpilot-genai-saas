import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MailService } from '../src/mail/mail.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp, ORIGIN, resetDb, signUp } from './helpers.js';

describe('organizations, roles and tenant isolation', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(() => resetDb(app));
  afterAll(() => app.close());

  const lastToken = () => app.get(MailService).outbox.at(-1)!.text.split('token=')[1];

  it('registration with an organization makes the user its owner', async () => {
    const { agent, user } = await signUp(app, 'owner@acme.test', { organizationName: 'Acme Robotics' });
    expect(user.memberships[0]).toMatchObject({ role: 'OWNER', organization: { slug: 'acme-robotics' } });
    const org = (await agent.get('/api/orgs/acme-robotics').expect(200)).body;
    expect(org).toMatchObject({ role: 'OWNER', plan: 'FREE', limits: { seats: 3, projects: 2 } });
  });

  it('users of another organization cannot see or touch it (404, never 403)', async () => {
    const a = await signUp(app, 'a@acme.test', { organizationName: 'Acme' });
    const b = await signUp(app, 'b@globex.test', { organizationName: 'Globex' });
    const project = (await a.agent.post('/api/orgs/acme/projects').set('Origin', ORIGIN).send({ name: 'api' }).expect(201)).body;
    for (const path of ['/api/orgs/acme', '/api/orgs/acme/members', '/api/orgs/acme/projects', '/api/orgs/acme/audit']) {
      await b.agent.get(path).expect(404);
    }
    await b.agent.post('/api/orgs/acme/projects').set('Origin', ORIGIN).send({ name: 'x' }).expect(404);
    await b.agent.delete(`/api/orgs/acme/projects/${project.id}`).set('Origin', ORIGIN).expect(404);
    // using A's project id inside B's own organization must not reach A's data
    await b.agent.delete(`/api/orgs/globex/projects/${project.id}`).set('Origin', ORIGIN).expect(404);
    expect(await prisma.project.count({ where: { id: project.id } })).toBe(1);
    expect((await b.agent.get('/api/orgs').expect(200)).body.map((m: { organization: { slug: string } }) => m.organization.slug)).toEqual(['globex']);
  });

  it('enforces roles: viewers read, only admins manage', async () => {
    const owner = await signUp(app, 'o@acme.test', { organizationName: 'Acme' });
    await owner.agent.post('/api/orgs/acme/invitations').set('Origin', ORIGIN).send({ email: 'v@acme.test', role: 'VIEWER' }).expect(201);
    const token = lastToken();
    const viewer = await signUp(app, 'v@acme.test');
    await viewer.agent.post('/api/invitations/accept').set('Origin', ORIGIN).send({ token }).expect(200);
    await viewer.agent.get('/api/orgs/acme/projects').expect(200);
    const denied = await viewer.agent.post('/api/orgs/acme/projects').set('Origin', ORIGIN).send({ name: 'x' }).expect(403);
    expect(denied.body.error).toBe('forbidden');
    await viewer.agent.get('/api/orgs/acme/audit').expect(403);
    await viewer.agent.patch('/api/orgs/acme').set('Origin', ORIGIN).send({ name: 'Hacked' }).expect(403);
  });

  it('invitations are bound to the invited email, single-use and revocable', async () => {
    const owner = await signUp(app, 'o@acme.test', { organizationName: 'Acme' });
    await owner.agent.post('/api/orgs/acme/invitations').set('Origin', ORIGIN).send({ email: 'r@acme.test' }).expect(201);
    const token = lastToken();
    const stranger = await signUp(app, 'stranger@evil.test');
    expect((await stranger.agent.post('/api/invitations/accept').set('Origin', ORIGIN).send({ token }).expect(403)).body.error).toBe('wrong_account');
    const r = await signUp(app, 'r@acme.test');
    expect((await r.agent.post('/api/invitations/accept').set('Origin', ORIGIN).send({ token }).expect(200)).body).toEqual({ organization: 'acme', role: 'REVIEWER' });
    await r.agent.post('/api/invitations/accept').set('Origin', ORIGIN).send({ token }).expect(400);
    const inv = (await owner.agent.post('/api/orgs/acme/invitations').set('Origin', ORIGIN).send({ email: 'late@acme.test' }).expect(201)).body;
    const lateToken = lastToken();
    await owner.agent.delete(`/api/orgs/acme/invitations/${inv.id}`).set('Origin', ORIGIN).expect(204);
    const late = await signUp(app, 'late@acme.test');
    await late.agent.post('/api/invitations/accept').set('Origin', ORIGIN).send({ token: lateToken }).expect(400);
  });

  it('expired invitations cannot be accepted', async () => {
    const owner = await signUp(app, 'o@acme.test', { organizationName: 'Acme' });
    await owner.agent.post('/api/orgs/acme/invitations').set('Origin', ORIGIN).send({ email: 'x@acme.test' }).expect(201);
    const token = lastToken();
    await prisma.invitation.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    const x = await signUp(app, 'x@acme.test');
    await x.agent.post('/api/invitations/accept').set('Origin', ORIGIN).send({ token }).expect(400);
  });

  it('admins cannot grant admin/owner; the last owner cannot be demoted or removed', async () => {
    const owner = await signUp(app, 'o@acme.test', { organizationName: 'Acme' });
    await owner.agent.post('/api/orgs/acme/invitations').set('Origin', ORIGIN).send({ email: 'adm@acme.test', role: 'ADMIN' }).expect(201);
    const t = lastToken();
    const admin = await signUp(app, 'adm@acme.test');
    await admin.agent.post('/api/invitations/accept').set('Origin', ORIGIN).send({ token: t }).expect(200);
    await admin.agent.post('/api/orgs/acme/invitations').set('Origin', ORIGIN).send({ email: 'z@acme.test', role: 'ADMIN' }).expect(403);
    await admin.agent.patch(`/api/orgs/acme/members/${owner.user.id}`).set('Origin', ORIGIN).send({ role: 'VIEWER' }).expect(403);
    expect((await owner.agent.patch(`/api/orgs/acme/members/${owner.user.id}`).set('Origin', ORIGIN).send({ role: 'ADMIN' }).expect(400)).body.error).toBe('last_owner');
    await owner.agent.delete(`/api/orgs/acme/members/${owner.user.id}`).set('Origin', ORIGIN).expect(400);
    await admin.agent.delete(`/api/orgs/acme/members/${admin.user.id}`).set('Origin', ORIGIN).expect(204); // members may leave
  });

  it('plan limits apply to seats and projects', async () => {
    const owner = await signUp(app, 'o@acme.test', { organizationName: 'Acme' });
    await owner.agent.post('/api/orgs/acme/invitations').set('Origin', ORIGIN).send({ email: 'u1@acme.test' }).expect(201);
    await owner.agent.post('/api/orgs/acme/invitations').set('Origin', ORIGIN).send({ email: 'u2@acme.test' }).expect(201);
    const seat = await owner.agent.post('/api/orgs/acme/invitations').set('Origin', ORIGIN).send({ email: 'u3@acme.test' }).expect(403);
    expect(seat.body).toMatchObject({ error: 'plan_limit', limit: 'seats' });
    await owner.agent.post('/api/orgs/acme/projects').set('Origin', ORIGIN).send({ name: 'p1' }).expect(201);
    await owner.agent.post('/api/orgs/acme/projects').set('Origin', ORIGIN).send({ name: 'p1' }).expect(409);
    await owner.agent.post('/api/orgs/acme/projects').set('Origin', ORIGIN).send({ name: 'p2' }).expect(201);
    expect((await owner.agent.post('/api/orgs/acme/projects').set('Origin', ORIGIN).send({ name: 'p3' }).expect(403)).body.limit).toBe('projects');
  });

  it('records an audit trail of administrative actions', async () => {
    const owner = await signUp(app, 'o@acme.test', { organizationName: 'Acme' });
    await owner.agent.post('/api/orgs/acme/projects').set('Origin', ORIGIN).send({ name: 'web' }).expect(201);
    await owner.agent.patch('/api/orgs/acme').set('Origin', ORIGIN).send({ retentionDays: 30 }).expect(200);
    const actions = (await owner.agent.get('/api/orgs/acme/audit').expect(200)).body.map((e: { action: string }) => e.action);
    expect(actions).toEqual(['org.updated', 'project.created', 'org.created']);
  });
});
