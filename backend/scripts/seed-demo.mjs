#!/usr/bin/env node
// Seeds a local demo through the public HTTP API (so every row goes through the real
// validation, tenancy, metering and review pipeline). Requires the API running with
// DEV_MAIL_OUTBOX=true. Demo-only credentials; never use them anywhere real.
//
//   API=http://127.0.0.1:8113 node scripts/seed-demo.mjs
import { readFileSync } from 'node:fs';

const API = (process.env.API ?? 'http://127.0.0.1:8113') + '/api';
const ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:3103';
export const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'reviewpilot-demo-only';
const USERS = {
  owner: { email: 'maya@acme.test', name: 'Maya Chen', organizationName: 'Acme Engineering' },
  reviewer: { email: 'leo@acme.test', name: 'Leo Park' },
  outsider: { email: 'sam@globex.test', name: 'Sam Rivera', organizationName: 'Globex Labs' },
};

class Client {
  cookie = '';
  async call(method, path, body, headers = {}) {
    const res = await fetch(API + path, { method, headers: { Origin: ORIGIN, 'Content-Type': 'application/json', Cookie: this.cookie, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    const text = await res.text();
    const data = text ? JSON.parse(text) : undefined;
    if (!res.ok) throw Object.assign(new Error(`${method} ${path} → ${res.status} ${text.slice(0, 200)}`), { status: res.status, data });
    return data;
  }
}

async function account(u) {
  const c = new Client();
  try {
    await c.call('POST', '/auth/register', { ...u, password: DEMO_PASSWORD });
    console.log(`registered ${u.email}`);
  } catch (e) {
    if (e.status !== 409) throw e;
    await c.call('POST', '/auth/login', { email: u.email, password: DEMO_PASSWORD });
    console.log(`signed in ${u.email}`);
  }
  return c;
}

async function waitFor(c, org, id) {
  for (let i = 0; i < 180; i++) {
    const r = await c.call('GET', `/orgs/${org}/reviews/${id}`);
    if (r.status === 'COMPLETED' || r.status === 'FAILED') return r;
    await new Promise((s) => setTimeout(s, 1000));
  }
  throw new Error(`review ${id} did not finish`);
}

const sample = readFileSync(new URL('../../frontend/public/sample.diff', import.meta.url), 'utf8');
const fixed = sample
  .replace(`+    return db.query("SELECT * FROM orders WHERE id = '" + id + "'");`, `+    return db.query('SELECT id, status, total FROM orders WHERE id = $1', [id]);`)
  .replace('+    } catch (e) {}', "+    } catch (e) {\n+      logger.error('markPaid failed', { id, e });\n+      throw e;\n+    }");
if (fixed === sample) throw new Error('sample diff changed; update the revision edits in seed-demo.mjs');

const owner = await account(USERS.owner);
const me = await owner.call('GET', '/auth/me');
const org = me.memberships[0].organization.slug;
const projects = await owner.call('GET', `/orgs/${org}/projects`);
const project = projects.find((p) => p.name === 'orders-service') ?? (await owner.call('POST', `/orgs/${org}/projects`, { name: 'orders-service', repoUrl: 'https://example.test/acme/orders-service' }));
if (!projects.some((p) => p.name === 'storefront-web')) await owner.call('POST', `/orgs/${org}/projects`, { name: 'storefront-web' });

const reviewer = await account(USERS.reviewer);
const members = await owner.call('GET', `/orgs/${org}/members`);
if (!members.some((m) => m.user.email === USERS.reviewer.email)) {
  await owner.call('POST', `/orgs/${org}/invitations`, { email: USERS.reviewer.email, role: 'REVIEWER' });
  const mail = await owner.call('GET', `/dev/outbox?email=${encodeURIComponent(USERS.reviewer.email)}`);
  const token = new URL(mail[0].text.match(/https?:\/\/\S+/)[0]).searchParams.get('token');
  await reviewer.call('POST', '/invitations/accept', { token });
  console.log(`${USERS.reviewer.email} joined ${org} as REVIEWER`);
}
const existing = await owner.call('GET', `/orgs/${org}/reviews`);
if (!existing.length) {
  const v1 = await owner.call('POST', `/orgs/${org}/reviews`, { projectId: project.id, title: 'Orders: item listing and discount endpoint', diff: sample }, { 'Idempotency-Key': 'demo-seed-v1' });
  console.log(`submitted ${v1.id}; waiting for the worker…`);
  const r1 = await waitFor(owner, org, v1.id);
  console.log(`v1 ${r1.status} in ${r1.durationMs} ms with ${r1.provider}/${r1.model}`);
  const fs = await reviewer.call('GET', `/orgs/${org}/reviews/${v1.id}/findings`);
  const pick = (src) => fs.find((f) => f.source === src);
  for (const [src, state, note] of [['rule:sql-injection-concat', 'ACCEPTED', 'Real injection; fixing before merge'], ['rule:empty-catch', 'ACCEPTED', null], ['rule:todo', 'DISMISSED', 'Tracked in the backlog'], ['rule:select-star', 'FALSE_POSITIVE', 'Fixed together with the injection']]) {
    const f = pick(src);
    if (f) await reviewer.call('PATCH', `/orgs/${org}/findings/${f.id}`, { state, ...(note ? { note } : {}) });
  }
  const sql = pick('rule:sql-injection-concat');
  if (sql) await reviewer.call('POST', `/orgs/${org}/findings/${sql.id}/comments`, { body: 'Switching to a bound parameter in the next revision.' });
  const model = fs.find((f) => f.confidence === 'MODEL');
  if (model) await reviewer.call('PATCH', `/orgs/${org}/findings/${model.id}`, { state: 'ACCEPTED' });

  // version 2: the author fixes the injection and the swallowed error, then re-requests review
  const v2 = await owner.call('POST', `/orgs/${org}/reviews/${v1.id}/rerun`, { diff: fixed, title: 'Orders: item listing and discount endpoint (revised)' });
  const r2 = await waitFor(owner, org, v2.id);
  console.log(`v${r2.version} ${r2.status} in ${r2.durationMs} ms`);
  // a second team's review, used to demonstrate tenant isolation
  const other = await account(USERS.outsider);
  const oslug = (await other.call('GET', '/auth/me')).memberships[0].organization.slug;
  const op = (await other.call('GET', `/orgs/${oslug}/projects`))[0] ?? (await other.call('POST', `/orgs/${oslug}/projects`, { name: 'billing-api' }));
  const o1 = await other.call('POST', `/orgs/${oslug}/reviews`, { projectId: op.id, title: 'Billing: invoice export', diff: sample }, { 'Idempotency-Key': 'demo-seed-globex' });
  await waitFor(other, oslug, o1.id);
}
console.log(`\nDemo ready: ${ORIGIN}/login  (users: ${Object.values(USERS).map((u) => u.email).join(', ')}; password: see DEMO_PASSWORD in backend/scripts/seed-demo.mjs)`);
