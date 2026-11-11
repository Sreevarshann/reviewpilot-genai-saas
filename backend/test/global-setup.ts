import { execSync } from 'node:child_process';
import pg from 'pg';

/** Integration tests run against a REAL PostgreSQL database, recreated for every run. */
export const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://reviewpilot:reviewpilot_local_only@127.0.0.1:55503/reviewpilot_test';

export default async function setup(): Promise<void> {
  const url = new URL(TEST_DB_URL);
  const dbName = url.pathname.slice(1);
  const admin = new pg.Client({ connectionString: Object.assign(new URL(TEST_DB_URL), { pathname: '/postgres' }).toString() });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await admin.query(`CREATE DATABASE "${dbName}"`);
  await admin.end();
  execSync('npx prisma migrate deploy', { env: { ...process.env, DATABASE_URL: TEST_DB_URL }, stdio: 'pipe' });
}
