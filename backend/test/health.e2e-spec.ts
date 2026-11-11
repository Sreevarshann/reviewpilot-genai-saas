import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createTestApp } from './helpers.js';

describe('health', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('reports database and redis status', async () => {
    const res = await api(app).get('/api/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', database: true, redis: true, llmProvider: 'fixture' });
  });

  it('sets security headers', async () => {
    const res = await api(app).get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
