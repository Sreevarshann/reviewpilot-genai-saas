import { describe, expect, it } from 'vitest';
import { addedLines, DiffError, languageOf, parseDiff, visibleNewLines } from './diff.js';

const MODIFY = `diff --git a/src/users.ts b/src/users.ts
index 1111111..2222222 100644
--- a/src/users.ts
+++ b/src/users.ts
@@ -10,6 +10,8 @@ export class Users {
   constructor(private db: Db) {}
 
-  find(id: string) {
-    return this.db.query("SELECT * FROM users WHERE id = '" + id + "'");
+  async find(id: string) {
+    const rows = await this.db.query('SELECT * FROM users WHERE id = $1', [id]);
+    if (!rows.length) throw new NotFound();
+    return rows[0];
   }
 }
@@ -40,2 +42,3 @@ function helper() {
   a();
+  b();
   c();
`;

describe('parseDiff', () => {
  it('parses hunks with exact line numbers', () => {
    const d = parseDiff(MODIFY);
    expect(d.files).toHaveLength(1);
    const f = d.files[0];
    expect(f).toMatchObject({ path: 'src/users.ts', status: 'modified', language: 'typescript', additions: 5, deletions: 2 });
    expect(f.hunks.map((h) => [h.oldStart, h.newStart, h.header])).toEqual([[10, 10, 'export class Users {'], [40, 42, 'function helper() {']]);
    const adds = addedLines(f);
    expect(adds.map((l) => l.newLine)).toEqual([12, 13, 14, 15, 43]);
    expect(adds[1].text).toContain('$1');
    const del = f.hunks[0].lines.filter((l) => l.type === 'del');
    expect(del.map((l) => l.oldLine)).toEqual([12, 13]);
    expect(visibleNewLines(f).has(16)).toBe(true);
    expect(visibleNewLines(f).has(30)).toBe(false);
  });

  it('handles added, deleted, renamed and binary files', () => {
    const d = parseDiff(`diff --git a/new.py b/new.py
new file mode 100644
--- /dev/null
+++ b/new.py
@@ -0,0 +1,2 @@
+import os
+print(os.environ["SECRET"])
diff --git a/old.go b/old.go
deleted file mode 100644
--- a/old.go
+++ /dev/null
@@ -1 +0,0 @@
-package main
diff --git a/a.js b/lib/a.js
similarity index 90%
rename from a.js
rename to lib/a.js
diff --git a/logo.png b/logo.png
Binary files a/logo.png and b/logo.png differ
`);
    expect(d.files.map((f) => [f.path, f.status, f.oldPath])).toEqual([
      ['new.py', 'added', null],
      ['old.go', 'deleted', null],
      ['lib/a.js', 'renamed', 'a.js'],
      ['logo.png', 'binary', null],
    ]);
    expect(d.files[0].additions).toBe(2);
    expect(d.files[1].deletions).toBe(1);
  });

  it('parses plain diffs without git headers and ignores no-newline markers', () => {
    const d = parseDiff('--- a/x.sql\n+++ b/x.sql\n@@ -1 +1 @@\n-select 1\n\\ No newline at end of file\n+select 2\n\\ No newline at end of file\n');
    expect(d.files[0]).toMatchObject({ path: 'x.sql', additions: 1, deletions: 1, language: 'sql' });
  });

  it.each(['diff --git a/../../etc/passwd b/../../etc/passwd\n', 'diff --git a//etc/x b//etc/x\n'])('rejects unsafe paths', (bad) => {
    expect(() => parseDiff(bad)).toThrow(DiffError);
  });

  it('rejects empty input and oversized diffs', () => {
    expect(() => parseDiff('hello world')).toThrow(/No file changes/);
    expect(() => parseDiff('diff --git a/x b/x\n' + '+a\n'.repeat(70_000))).toThrow(/exceeds/);
  });

  it('detects languages', () => {
    expect(languageOf('Dockerfile')).toBe('dockerfile');
    expect(languageOf('app/main.py')).toBe('python');
    expect(languageOf('README')).toBe('text');
  });
});
