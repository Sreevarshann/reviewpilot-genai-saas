import { describe, expect, it } from 'vitest';
import { parseDiff } from './diff.js';
import { redact, runRules } from './rules.js';

// Fake credentials are assembled at runtime so no credential-shaped literal exists in the
// source tree (keeps secret scanners such as gitleaks meaningful for real leaks).
const FAKE = {
  aws: ['AK', 'IA', 'ABCDEFGHIJKLMNOP'].join(''),
  stripe: ['sk', '_live_', 'abcdefghijklmnopqrstuvwx'].join(''),
  github: ['gh', 'p_', 'abcdefghijklmnopqrstuvwxyz0123456789'].join(''),
  password: ['not-a-real', '-pass'].join(''),
};

const diff = (path: string, added: string[]) => `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1,1 +1,${added.length + 1} @@\n ctx\n${added.map((l) => '+' + l).join('\n')}\n`;
const ids = (path: string, lines: string[]) => runRules(parseDiff(diff(path, lines)).files).map((f) => f.source);

describe('static rules', () => {
  it.each([
    ['src/db.ts', ['const r = await db.query("SELECT id FROM users WHERE id = \'" + id + "\'");'], 'rule:sql-injection-concat'],
    ['src/db.ts', ['await db.query(`DELETE FROM t WHERE id = ${id}`);'], 'rule:sql-injection-concat'],
    ['app/db.py', ['cur.execute(f"SELECT * FROM users WHERE name = \'{name}\'")'], 'rule:sql-injection-concat'],
    ['src/run.ts', ['execSync(`git clone ${url}`);'], 'rule:command-injection'],
    ['app/x.py', ['subprocess.run(cmd, shell=True)'], 'rule:command-injection'],
    ['src/x.ts', ['const v = eval(input);'], 'rule:eval'],
    ['src/http.ts', ['const agent = new https.Agent({ rejectUnauthorized: false });'], 'rule:tls-disabled'],
    ['src/x.ts', ['try { save() } catch (e) {}'], 'rule:empty-catch'],
    ['src/x.ts', ['load().catch(() => {});'], 'rule:swallowed-promise'],
    ['app/x.py', ['except:'], 'rule:bare-except'],
    ['src/x.ts', ['const h = createHash("md5").update(pw).digest("hex");'], 'rule:weak-hash'],
    ['src/x.ts', [`const key = "${FAKE.aws}";`], 'rule:secret-aws-key'],
    ['config/app.yml', [`api_key: "${FAKE.stripe}"`], 'rule:secret-token'],
    ['src/x.ts', [`const password = "${FAKE.password}";`], 'rule:secret-assignment'],
    ['src/x.ts', ['console.log(user);'], 'rule:debug-output'],
    ['src/x.ts', ['// TODO handle retries'], 'rule:todo'],
  ])('%s flags %s', (path, lines, rule) => {
    expect(ids(path, lines)).toContain(rule);
  });

  it('does not flag safe equivalents', () => {
    const safe = ['const r = await db.query("SELECT id FROM users WHERE id = $1", [id]);', 'execFile("git", ["clone", url]);', 'try { save() } catch (e) { logger.error(e); throw e; }', 'const evaluate = (x: number) => x * 2;'];
    expect(ids('src/test/safe.test.ts', safe)).toEqual([]);
  });

  it('points at the exact added line and redacts secrets', () => {
    const f = runRules(parseDiff(diff('src/x.ts', ['const a = 1;', `const token = "${FAKE.github}";`])).files).find((x) => x.source === 'rule:secret-token')!;
    expect(f.lineStart).toBe(3);
    expect(f.evidence).not.toContain('abcdefghijklmnop');
    expect(f.evidence).toContain('[redacted]');
  });

  it('detects queries inside loops', () => {
    const r = runRules(parseDiff(diff('src/orders.ts', ['for (const id of ids) {', '  const o = await prisma.order.findUnique({ where: { id } });', '}'])).files);
    expect(r.find((x) => x.source === 'rule:n-plus-one')).toMatchObject({ lineStart: 3, category: 'PERFORMANCE' });
  });

  it('flags source changes without tests, but not when tests are included', () => {
    const lines = ['export function a() {', '  return 1;', '}', 'export const b = 2;', 'export const c = 3;'];
    expect(ids('src/feature.ts', lines)).toContain('rule:missing-tests');
    const withTest = parseDiff(diff('src/feature.ts', lines) + diff('src/feature.spec.ts', ['it("works", () => {});']));
    expect(runRules(withTest.files).map((f) => f.source)).not.toContain('rule:missing-tests');
  });

  it('redacts quoted literals', () => {
    expect(redact('password = "supersecretvalue"')).toBe('password = "supe…[redacted]"');
  });
});
