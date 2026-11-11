import { describe, expect, it } from 'vitest';
import { SAMPLE_DIFF } from '../demo/sample-diff.js';
import { parseDiff } from './diff.js';
import { dedupe, evidenceMatches, validateModelFindings } from './orchestrator.js';

const files = parseDiff(SAMPLE_DIFF).files;
const REPO = 'src/orders/orders.repository.ts';
const SQL = `return db.query("SELECT * FROM orders WHERE id = '" + id + "'");`;
const finding = (over: Record<string, unknown>) => ({ path: REPO, line_start: 6, category: 'SECURITY', severity: 'HIGH', title: 'SQL injection', description: 'Concatenated SQL', evidence: SQL, ...over });

describe('evidenceMatches', () => {
  it('accepts exact quotes regardless of whitespace and case', () => {
    expect(evidenceMatches(`    ${SQL}`, SQL.toUpperCase())).toBe(true);
  });
  // Observed with qwen3:4b-instruct: evidence echoes the context's "L<n>" labels and elides code.
  it.each([`L6: ${SQL}`, `L6 + ${SQL}`, `+ ${SQL}`, `L10-13: const result = [];`])('strips line labels and diff markers: %s', (ev) => {
    expect(evidenceMatches(`const result = [];\n${SQL}`, ev)).toBe(true);
  });
  it('matches elided quotes only when every fragment appears in order', () => {
    const code = 'const result = [];\nfor (const id of orderIds) {\n  const items = await db.query(x);\n}';
    expect(evidenceMatches(code, 'const result = []; for (const id of orderIds) { ... }')).toBe(true);
    expect(evidenceMatches(code, 'for (const id of orderIds) ... const result = [];')).toBe(false);
  });
  it('rejects fabricated or trivial evidence', () => {
    expect(evidenceMatches(SQL, 'eval(userInput)')).toBe(false);
    expect(evidenceMatches(SQL, '{ ... }')).toBe(false);
    expect(evidenceMatches(SQL, 'L6:')).toBe(false);
  });
});

describe('validateModelFindings', () => {
  it('accepts grounded findings and caps model CRITICAL to HIGH', () => {
    const out = validateModelFindings({ findings: [finding({ severity: 'CRITICAL', evidence: `L6: ${SQL}` })] }, files);
    expect(out.rejected).toEqual([]);
    expect(out.accepted[0]).toMatchObject({ path: REPO, lineStart: 6, severity: 'HIGH', confidence: 'MODEL' });
  });
  it.each([
    [{ path: 'src/elsewhere.ts' }, 'file not in diff'],
    [{ line_start: 400 }, 'cited lines are not part of the diff'],
    [{ evidence: 'L6: eval(req.body)' }, 'evidence does not match the cited lines'],
    [{ line_start: 2, evidence: SQL }, 'evidence does not match the cited lines'],
    [{ severity: 'URGENT' }, 'schema'],
  ])('rejects %o (%s)', (over, reason) => {
    const out = validateModelFindings({ findings: [finding(over)] }, files);
    expect(out.accepted).toEqual([]);
    expect(out.rejected[0].reason).toContain(reason);
  });
  it('rejects a response without a findings array', () => {
    expect(validateModelFindings({ nope: true }, files).rejected[0].reason).toMatch(/no findings array/);
  });
});

describe('dedupe', () => {
  it('keeps the deterministic finding when a model finding duplicates it', () => {
    const det = { path: REPO, lineStart: 6, lineEnd: 6, category: 'SECURITY', severity: 'HIGH', title: 'SQL built from untrusted values', description: 'd', evidence: SQL, confidence: 'DETERMINISTIC', source: 'rule:sql-injection-concat' } as const;
    const model = { ...det, title: 'SQL injection', confidence: 'MODEL', source: 'model' } as const;
    const out = dedupe([model, det]);
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe('rule:sql-injection-concat');
  });
});
