import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/bootstrap.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { TEST_DB_URL } from './global-setup.js';

export async function createTestApp(env: Record<string, string> = {}): Promise<INestApplication> {
  Object.assign(process.env, { NODE_ENV: 'test', DATABASE_URL: TEST_DB_URL, LLM_PROVIDER: 'fixture', REVIEW_INLINE: 'true', ...env });
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

export const api = (app: INestApplication) => request(app.getHttpServer());
