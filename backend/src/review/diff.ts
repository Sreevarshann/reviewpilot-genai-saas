/**
 * Unified-diff (git format) parser. Produces per-file hunks with exact old/new line numbers
 * so every finding can be validated against lines that actually exist in the change.
 * Input is untrusted: sizes are bounded and paths are sanitised.
 */

export type LineType = 'add' | 'del' | 'ctx';
export interface DiffLine { type: LineType; oldLine: number | null; newLine: number | null; text: string }
export interface Hunk { oldStart: number; oldLines: number; newStart: number; newLines: number; header: string; lines: DiffLine[] }
export type FileStatus = 'added' | 'deleted' | 'modified' | 'renamed' | 'binary';
export interface DiffFile { path: string; oldPath: string | null; status: FileStatus; language: string; additions: number; deletions: number; hunks: Hunk[] }
export interface ParsedDiff { files: DiffFile[]; additions: number; deletions: number }

export class DiffError extends Error {
  override name = 'DiffError';
}

export const LIMITS = { maxFiles: 300, maxLines: 60_000, maxLineLength: 5_000 };

const LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  py: 'python', go: 'go', rb: 'ruby', java: 'java', kt: 'kotlin', rs: 'rust', php: 'php', cs: 'csharp',
  sql: 'sql', sh: 'shell', yml: 'yaml', yaml: 'yaml', json: 'json', md: 'markdown', html: 'html', css: 'css',
};

export function languageOf(path: string): string {
  const base = path.split('/').pop() ?? '';
  if (/^dockerfile$/i.test(base)) return 'dockerfile';
  const ext = base.includes('.') ? base.split('.').pop()!.toLowerCase() : '';
  return LANG[ext] ?? 'text';
}

function hasControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) < 0x20) return true;
  return false;
}

function cleanPath(raw: string): string {
  let p = raw.trim().replace(/^"(.*)"$/, '$1');
  p = p.replace(/^[ab]\//, '');
  if (p === '/dev/null') return p;
  if (p.startsWith('/') || p.split('/').some((s) => s === '..') || hasControlChar(p)) throw new DiffError(`Unsafe path in diff: ${p.slice(0, 100)}`);
  if (p.length > 500) throw new DiffError('Path too long');
  return p;
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

export function parseDiff(input: string): ParsedDiff {
  const text = input.replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  if (lines.length > LIMITS.maxLines) throw new DiffError(`Diff exceeds ${LIMITS.maxLines} lines`);
  const files: DiffFile[] = [];
  let file: DiffFile | null = null;
  let hunk: Hunk | null = null;
  let oldNo = 0;
  let newNo = 0;

  const startFile = (oldPath: string | null, path: string): DiffFile => {
    const f: DiffFile = { path, oldPath, status: 'modified', language: languageOf(path), additions: 0, deletions: 0, hunks: [] };
    files.push(f);
    if (files.length > LIMITS.maxFiles) throw new DiffError(`Diff touches more than ${LIMITS.maxFiles} files`);
    hunk = null;
    return f;
  };

  for (const line of lines) {
    if (line.length > LIMITS.maxLineLength) throw new DiffError('Diff contains an over-long line');
    if (line.startsWith('diff --git ')) {
      const m = /^diff --git (\S+) (\S+)$/.exec(line);
      const a = m ? cleanPath(m[1]) : '';
      const b = m ? cleanPath(m[2]) : '';
      file = startFile(a, b);
      if (a === b) file.oldPath = null;
      continue;
    }
    if (line.startsWith('--- ') && (!hunk || (hunk && oldNo >= hunk.oldStart + hunk.oldLines))) {
      const p = cleanPath(line.slice(4).split('\t')[0]);
      if (!file || file.hunks.length) file = startFile(p === '/dev/null' ? null : p, p);
      if (p === '/dev/null') file.status = 'added';
      continue;
    }
    if (line.startsWith('+++ ') && file && !file.hunks.length && (!hunk || newNo >= (hunk as Hunk).newStart + (hunk as Hunk).newLines)) {
      const p = cleanPath(line.slice(4).split('\t')[0]);
      if (p === '/dev/null') file.status = 'deleted';
      else {
        if (file.path !== p) file.oldPath = file.oldPath ?? file.path;
        file.path = p;
        file.language = languageOf(p);
      }
      continue;
    }
    if (!file) continue;
    if (line.startsWith('new file mode')) { file.status = 'added'; continue; }
    if (line.startsWith('deleted file mode')) { file.status = 'deleted'; continue; }
    if (line.startsWith('rename from ')) { file.oldPath = cleanPath(line.slice(12)); file.status = 'renamed'; continue; }
    if (line.startsWith('rename to ')) { file.path = cleanPath(line.slice(10)); file.language = languageOf(file.path); file.status = 'renamed'; continue; }
    if (/^Binary files .* differ$/.test(line) || line === 'GIT binary patch') { file.status = 'binary'; continue; }
    const h = HUNK.exec(line);
    if (h) {
      hunk = { oldStart: +h[1], oldLines: h[2] === undefined ? 1 : +h[2], newStart: +h[3], newLines: h[4] === undefined ? 1 : +h[4], header: h[5].trim(), lines: [] };
      file.hunks.push(hunk);
      oldNo = hunk.oldStart;
      newNo = hunk.newStart;
      continue;
    }
    if (!hunk) continue;
    if (line.startsWith('\\')) continue; // "\ No newline at end of file"
    const c = line[0];
    if (c === '+') {
      hunk.lines.push({ type: 'add', oldLine: null, newLine: newNo++, text: line.slice(1) });
      file.additions++;
    } else if (c === '-') {
      hunk.lines.push({ type: 'del', oldLine: oldNo++, newLine: null, text: line.slice(1) });
      file.deletions++;
    } else if (c === ' ' || line === '') {
      if (line === '' && oldNo >= hunk.oldStart + hunk.oldLines && newNo >= hunk.newStart + hunk.newLines) continue;
      hunk.lines.push({ type: 'ctx', oldLine: oldNo++, newLine: newNo++, text: line.slice(1) });
    }
  }
  if (files.length === 0) throw new DiffError('No file changes found. Paste a unified diff (e.g. output of `git diff`).');
  for (const f of files) {
    if (f.oldPath === f.path) f.oldPath = null;
    if (f.status === 'modified' && f.oldPath) f.status = 'renamed';
  }
  return { files, additions: files.reduce((n, f) => n + f.additions, 0), deletions: files.reduce((n, f) => n + f.deletions, 0) };
}

/** New-side line numbers that are additions or context in this file's hunks. */
export function visibleNewLines(file: DiffFile): Set<number> {
  const s = new Set<number>();
  for (const h of file.hunks) for (const l of h.lines) if (l.newLine !== null) s.add(l.newLine);
  return s;
}

export function addedLines(file: DiffFile): DiffLine[] {
  return file.hunks.flatMap((h) => h.lines.filter((l) => l.type === 'add'));
}
