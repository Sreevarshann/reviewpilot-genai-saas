import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sha256 } from '../src/common/crypto.js';
import { MailService } from '../src/mail/mail.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { api, createTestApp, ORIGIN, resetDb, signUp } from './helpers.js';

describe('authentication', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(() => resetDb(app));
  afterAll(() => app.close());

  it('registers, sets an HttpOnly SameSite session cookie and stores only its hash', async () => {
    const res = await api(app).post('/api/auth/register').set('Origin', ORIGIN).send({ email: 'Ada@Example.com', name: 'Ada', password: 'correct horse battery' }).expect(201);
    expect(res.body.email).toBe('ada@example.com');
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/rp_session=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    const raw = cookie.split('rp_session=')[1].split(';')[0];
    const session = await prisma.session.findFirstOrThrow();
    expect(session.tokenHash).toBe(sha256(raw));
    expect(session.tokenHash).not.toContain(raw);
    const user = await prisma.user.findFirstOrThrow();
    expect(user.passwordHash.startsWith('$argon2id$')).toBe(true);
  });

  it('rejects weak passwords, bad emails and duplicate accounts', async () => {
    await api(app).post('/api/auth/register').set('Origin', ORIGIN).send({ email: 'x@y.com', name: 'X', password: 'short' }).expect(422);
    await api(app).post('/api/auth/register').set('Origin', ORIGIN).send({ email: 'nope', name: 'X', password: 'correct horse battery' }).expect(422);
    await signUp(app, 'dup@example.com');
    const res = await api(app).post('/api/auth/register').set('Origin', ORIGIN).send({ email: 'dup@example.com', name: 'X', password: 'correct horse battery' }).expect(409);
    expect(res.body.error).toBe('email_taken');
  });

  it('logs in, reads /me, logs out and the session stops working', async () => {
    await signUp(app, 'bob@example.com');
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/auth/login').set('Origin', ORIGIN).send({ email: 'bob@example.com', password: 'correct horse battery' }).expect(200);
    expect((await agent.get('/api/auth/me').expect(200)).body.email).toBe('bob@example.com');
    await agent.post('/api/auth/logout').set('Origin', ORIGIN).expect(204);
    await agent.get('/api/auth/me').expect(401);
  });

  it('gives the same error for unknown email and wrong password', async () => {
    await signUp(app, 'carol@example.com');
    const a = await api(app).post('/api/auth/login').set('Origin', ORIGIN).send({ email: 'carol@example.com', password: 'wrong password!!' }).expect(401);
    const b = await api(app).post('/api/auth/login').set('Origin', ORIGIN).send({ email: 'ghost@example.com', password: 'wrong password!!' }).expect(401);
    expect(a.body).toEqual(b.body);
  });

  it('requires authentication by default', async () => {
    await api(app).get('/api/auth/me').expect(401);
    await api(app).get('/api/auth/me').set('Cookie', 'rp_session=forged-token-value').expect(401);
  });

  it('rejects cross-site state-changing requests carrying the session cookie', async () => {
    const { agent } = await signUp(app, 'dave@example.com');
    const res = await agent.post('/api/auth/logout').set('Origin', 'https://evil.example').expect(403);
    expect(res.body.error).toBe('bad_origin');
    await agent.get('/api/auth/me').expect(200);
  });

  it('rotates the session on login and logout-all revokes every session', async () => {
    const { agent } = await signUp(app, 'erin@example.com');
    await agent.post('/api/auth/login').set('Origin', ORIGIN).send({ email: 'erin@example.com', password: 'correct horse battery' }).expect(200);
    expect(await prisma.session.count()).toBe(1);
    const other = request.agent(app.getHttpServer());
    await other.post('/api/auth/login').set('Origin', ORIGIN).send({ email: 'erin@example.com', password: 'correct horse battery' }).expect(200);
    expect(await prisma.session.count()).toBe(2);
    await agent.post('/api/auth/logout-all').set('Origin', ORIGIN).expect(204);
    await other.get('/api/auth/me').expect(401);
  });

  it('expires idle and absolute sessions', async () => {
    const { agent } = await signUp(app, 'fay@example.com');
    await prisma.session.updateMany({ data: { lastSeenAt: new Date(Date.now() - 100 * 3_600_000) } });
    await agent.get('/api/auth/me').expect(401);
    const { agent: a2 } = await signUp(app, 'gus@example.com');
    await prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    await a2.get('/api/auth/me').expect(401);
  });

  it('password reset: no account enumeration, single-use token, sessions revoked', async () => {
    const { agent } = await signUp(app, 'hal@example.com');
    const mail = app.get(MailService);
    await api(app).post('/api/auth/password-reset/request').send({ email: 'nobody@example.com' }).expect(202);
    const before = mail.outbox.length;
    await api(app).post('/api/auth/password-reset/request').send({ email: 'hal@example.com' }).expect(202);
    expect(mail.outbox.length).toBe(before + 1);
    const token = mail.outbox.at(-1)!.text.split('token=')[1];
    expect(await prisma.passwordResetToken.count({ where: { tokenHash: token } })).toBe(0); // hash stored, not token
    await api(app).post('/api/auth/password-reset/confirm').send({ token, password: 'a brand new passphrase' }).expect(204);
    await api(app).post('/api/auth/password-reset/confirm').send({ token, password: 'another new passphrase' }).expect(401);
    await agent.get('/api/auth/me').expect(401);
    await api(app).post('/api/auth/login').set('Origin', ORIGIN).send({ email: 'hal@example.com', password: 'a brand new passphrase' }).expect(200);
  });
});

describe('rate limiting', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await createTestApp({ AUTH_RATE_MULTIPLIER: '1' });
  });
  afterAll(() => app.close());

  it('throttles repeated login attempts', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) {
      codes.push((await api(app).post('/api/auth/login').set('Origin', ORIGIN).send({ email: 'x@example.com', password: 'whatever pass' })).status);
    }
    expect(codes).toContain(429);
  });
});
