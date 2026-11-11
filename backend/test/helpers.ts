import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/bootstrap.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { TEST_DB_URL } from './global-setup.js';

export async function createTestApp(env: Record<string, string> = {}): Promise<INestApplication> {
  Object.assign(process.env, { NODE_ENV: 'test', DATABASE_URL: TEST_DB_URL, LLM_PROVIDER: 'fixture', REVIEW_INLINE: 'true', AUTH_RATE_MULTIPLIER: '1000', RATE_LIMIT_PER_MINUTE: '100000', ...env });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  return app;
}

/** Remove all rows between tests (tenant tables cascade from organizations/users). */
export async function resetDb(app: INestApplication): Promise<void> {
  const prisma = app.get(PrismaService);
  await prisma.$executeRawUnsafe('TRUNCATE "User", "Organization" CASCADE');
}

export const ORIGIN = 'http://localhost:3103';
export const api = (app: INestApplication) => request(app.getHttpServer());

/** A signed-in browser-like agent (keeps cookies, sends the web Origin). */
export async function signUp(app: INestApplication, email: string, extra: Record<string, unknown> = {}) {
  const agent = request.agent(app.getHttpServer());
  const res = await agent.post('/api/auth/register').set('Origin', ORIGIN).send({ email, name: email.split('@')[0], password: 'correct horse battery', ...extra });
  if (res.status !== 201) throw new Error(`signUp failed ${res.status} ${JSON.stringify(res.body)}`);
  return { agent, user: res.body as { id: string; memberships: { role: string; organization: { id: string; slug: string } }[] } };
}
