/**
 * Deterministic static checks over the ADDED lines of a diff. Findings produced here are
 * labelled confidence=DETERMINISTIC (pattern-matched, reproducible) and always point at a
 * real added line. They are heuristics, not a full program analysis.
 */
import type { Category, Severity } from '../../generated/prisma/enums.js';
import { addedLines, type DiffFile, type DiffLine } from './diff.js';

export interface RawFinding {
  path: string;
  lineStart: number;
  lineEnd: number;
  category: Category;
  severity: Severity;
  title: string;
  description: string;
  evidence: string;
  suggestedFix?: string;
  confidence: 'DETERMINISTIC' | 'MODEL';
  source: string;
}

interface LineRule {
  id: string;
  languages?: string[];
  pattern: RegExp;
  category: Category;
  severity: Severity;
  title: string;
  description: string;
  fix?: string;
  redact?: boolean;
}

const CODE = ['typescript', 'javascript', 'python', 'go', 'ruby', 'java', 'kotlin', 'php', 'csharp', 'rust'];
const JS = ['typescript', 'javascript'];

const RULES: LineRule[] = [
  { id: 'secret-aws-key', pattern: /\bAKIA[0-9A-Z]{16}\b/, category: 'SECURITY', severity: 'CRITICAL', title: 'Hard-coded AWS access key', description: 'An AWS access key id appears in source code. Committed credentials must be treated as compromised.', fix: 'Remove the key, rotate it in AWS IAM, and load credentials from the environment or a secrets manager.', redact: true },
  { id: 'secret-private-key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/, category: 'SECURITY', severity: 'CRITICAL', title: 'Private key committed', description: 'A private key is being added to the repository.', fix: 'Remove the key from the change and history, revoke it, and store it in a secrets manager.', redact: true },
  { id: 'secret-token', pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|xox[baprs]-[A-Za-z0-9-]{10,}|sk_live_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{32,})\b/, category: 'SECURITY', severity: 'CRITICAL', title: 'Hard-coded API token', description: 'A token matching a known provider format appears in the change.', fix: 'Revoke the token and read it from configuration at runtime.', redact: true },
  { id: 'secret-assignment', languages: [...CODE, 'yaml', 'json', 'shell', 'text'], pattern: /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token|client[_-]?secret)\b["']?\s*[:=]\s*["'][^"'\s]{8,}["']/i, category: 'SECURITY', severity: 'HIGH', title: 'Credential assigned as a literal', description: 'A credential-like variable is assigned a string literal.', fix: 'Load the value from environment variables or a secrets manager; never commit it.', redact: true },
  { id: 'sql-injection-concat', languages: CODE, pattern: /\b(?:query|execute|exec|raw|prepare|queryRaw(?:Unsafe)?)\s*\(\s*(?:`[^`]*\$\{|"[^"]*"\s*\+|'[^']*'\s*\+|f"[^"]*\{|f'[^']*\{)/, category: 'SECURITY', severity: 'HIGH', title: 'SQL built from untrusted values', description: 'The SQL text is assembled with string concatenation or interpolation, which allows SQL injection if any part is user-controlled.', fix: 'Use parameterised queries / bound parameters (e.g. `$1`, `?`, or the ORM query builder).' },
  { id: 'command-injection', languages: CODE, pattern: /\b(?:exec|execSync|spawn|os\.system|subprocess\.(?:run|call|Popen))\s*\(\s*(?:`[^`]*\$\{|f["']|"[^"]*"\s*\+|'[^']*'\s*\+)|shell\s*=\s*True/, category: 'SECURITY', severity: 'HIGH', title: 'Shell command built from variables', description: 'A shell command is constructed from interpolated values, allowing command injection.', fix: 'Pass arguments as an array without a shell, and validate inputs against an allow-list.' },
  { id: 'eval', languages: [...JS, 'python', 'php', 'ruby'], pattern: /(?<![\w.])(?:eval|exec)\s*\(|new Function\s*\(/, category: 'SECURITY', severity: 'HIGH', title: 'Dynamic code execution', description: 'eval/exec/new Function executes code from strings.', fix: 'Replace with explicit parsing or a lookup table of allowed operations.' },
  { id: 'tls-disabled', languages: [...CODE, 'yaml'], pattern: /rejectUnauthorized\s*:\s*false|verify\s*=\s*False|InsecureSkipVerify\s*:\s*true|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0/, category: 'SECURITY', severity: 'HIGH', title: 'TLS certificate verification disabled', description: 'Disabling certificate verification allows man-in-the-middle attacks.', fix: 'Keep verification enabled; configure the correct CA bundle instead.' },
  { id: 'weak-hash', languages: CODE, pattern: /\b(?:md5|sha1)\b\s*\(|createHash\(\s*['"](?:md5|sha1)['"]\)|hashlib\.(?:md5|sha1)\(/i, category: 'SECURITY', severity: 'MEDIUM', title: 'Weak hash function', description: 'MD5/SHA-1 are broken for security purposes such as password storage or signatures.', fix: 'Use SHA-256+ for integrity, and argon2/bcrypt/scrypt for passwords.' },
  { id: 'empty-catch', languages: [...JS, 'java', 'kotlin', 'csharp', 'php'], pattern: /catch\s*(?:\([^)]*\))?\s*\{\s*\}/, category: 'ERROR_HANDLING', severity: 'MEDIUM', title: 'Exception silently swallowed', description: 'An empty catch block hides failures and makes incidents hard to diagnose.', fix: 'Handle the error, log it with context, or rethrow.' },
  { id: 'swallowed-promise', languages: JS, pattern: /\.catch\(\s*(?:\(\s*\w*\s*\)|\w+)\s*=>\s*(?:\{\s*\}|null|undefined)\s*\)/, category: 'ERROR_HANDLING', severity: 'MEDIUM', title: 'Promise rejection ignored', description: 'The rejection handler discards the error.', fix: 'Log or propagate the error; decide explicitly what the caller should see.' },
  { id: 'bare-except', languages: ['python'], pattern: /^\s*except\s*(?:Exception\s*)?:\s*(?:pass)?\s*$/, category: 'ERROR_HANDLING', severity: 'MEDIUM', title: 'Overly broad exception handler', description: 'A bare or catch-all except clause also catches programming errors and interrupts.', fix: 'Catch the specific exceptions you expect and handle or re-raise others.' },
  { id: 'select-star', languages: [...CODE, 'sql'], pattern: /\bSELECT\s+\*\s+FROM\b/i, category: 'PERFORMANCE', severity: 'LOW', title: 'SELECT * in query', description: 'Selecting all columns transfers unused data and breaks when the schema changes.', fix: 'List the columns the code needs.' },
  { id: 'debug-output', languages: [...JS, 'python'], pattern: /^\s*(?:console\.(?:log|debug)|print)\s*\(/, category: 'MAINTAINABILITY', severity: 'LOW', title: 'Debug output added', description: 'Ad-hoc console/print output tends to leak data and clutter logs.', fix: 'Use the structured logger with an appropriate level, or remove.' },
  { id: 'todo', pattern: /\b(?:TODO|FIXME|XXX|HACK)\b/, category: 'MAINTAINABILITY', severity: 'INFO', title: 'Unresolved TODO added', description: 'The change introduces a TODO/FIXME marker.', fix: 'Track the work in an issue and reference it, or resolve before merging.' },
];

const REDACT = /(["'])([^"']{4})[^"']*([^"']{2})\1|(AKIA[0-9A-Z]{2})[0-9A-Z]{14}|(gh[pousr]_|xox[baprs]-|sk_live_|sk-)[A-Za-z0-9-]+/g;
export function redact(text: string): string {
  return text.replace(REDACT, (_m, q, a, b, aws, pfx) => (aws ? `${aws}…[redacted]` : pfx ? `${pfx}…[redacted]` : `${q}${a}…[redacted]${q}`)).slice(0, 300);
}

const IS_TEST = /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[a-z]+$|_test\.(go|py)$|^test_.*\.py$/;

function n1Findings(file: DiffFile): RawFinding[] {
  const out: RawFinding[] = [];
  for (const h of file.hunks) {
    let loopDepthLine: DiffLine | null = null;
    let since = 0;
    for (const l of h.lines) {
      if (l.type === 'del') continue;
      if (/\bfor\s*\(|\.forEach\(|\bfor\s+\w+\s+in\b|\bwhile\s*\(/.test(l.text)) {
        loopDepthLine = l;
        since = 0;
        continue;
      }
      if (loopDepthLine && ++since <= 6 && l.type === 'add' && /\bawait\b.*\.(?:find\w*|query|select|get|fetch|execute)\s*\(|\.objects\.(?:get|filter)\(/.test(l.text)) {
        out.push({ path: file.path, lineStart: l.newLine!, lineEnd: l.newLine!, category: 'PERFORMANCE', severity: 'MEDIUM', title: 'Query inside a loop (possible N+1)', description: `A database or network call runs on every iteration of the loop that starts at line ${loopDepthLine.newLine}.`, evidence: l.text.trim().slice(0, 300), suggestedFix: 'Batch the lookups (e.g. WHERE id IN (...), a join, or a DataLoader) outside the loop.', confidence: 'DETERMINISTIC', source: 'rule:n-plus-one' });
        loopDepthLine = null;
      }
    }
  }
  return out;
}

export function runRules(files: DiffFile[]): RawFinding[] {
  const out: RawFinding[] = [];
  for (const f of files) {
    if (f.status === 'deleted' || f.status === 'binary') continue;
    for (const l of addedLines(f)) {
      for (const r of RULES) {
        if (r.languages && !r.languages.includes(f.language)) continue;
        if (!r.pattern.test(l.text)) continue;
        out.push({ path: f.path, lineStart: l.newLine!, lineEnd: l.newLine!, category: r.category, severity: r.severity, title: r.title, description: r.description, evidence: r.redact ? redact(l.text.trim()) : l.text.trim().slice(0, 300), suggestedFix: r.fix, confidence: 'DETERMINISTIC', source: `rule:${r.id}` });
      }
    }
    out.push(...n1Findings(f));
  }
  // Source changed without any test change in the diff.
  const src = files.filter((f) => CODE.includes(f.language) && !IS_TEST.test(f.path) && f.additions >= 5 && f.status !== 'deleted');
  if (src.length && !files.some((f) => IS_TEST.test(f.path))) {
    for (const f of src) {
      const first = addedLines(f)[0];
      out.push({ path: f.path, lineStart: first.newLine!, lineEnd: first.newLine!, category: 'TESTING', severity: 'MEDIUM', title: 'Code change without tests', description: `${f.additions} lines were added to ${f.path} but the change includes no test files.`, evidence: `${f.additions} added lines, 0 test files changed`, suggestedFix: 'Add or update tests covering the new behaviour.', confidence: 'DETERMINISTIC', source: 'rule:missing-tests' });
    }
  }
  return out;
}
