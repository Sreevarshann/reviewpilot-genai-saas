import { type DiffFile } from './diff.js';
import { redact } from './rules.js';

const SECRET_LINE = /\b(?:password|passwd|secret|api[_-]?key|token|private key)\b|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY|gh[pousr]_|xox[baprs]-|sk_live_/i;

/**
 * Bounded, redacted review context: numbered lines of each hunk ("L<n> +|- |  code").
 * Secret-looking lines are redacted before anything is sent to a model.
 */
export function buildContext(files: DiffFile[], budgetChars = 12_000): { text: string; includedFiles: string[]; truncated: boolean } {
  const parts: string[] = [];
  const included: string[] = [];
  let used = 0;
  let truncated = false;
  for (const f of files) {
    if (f.status === 'binary' || f.status === 'deleted') continue;
    const lines = [`### FILE ${f.path}`, `language: ${f.language}`];
    for (const h of f.hunks) {
      lines.push(`@@ ${h.header}`);
      for (const l of h.lines) {
        if (l.type === 'del') continue;
        const code = SECRET_LINE.test(l.text) ? redact(l.text) : l.text;
        lines.push(`L${l.newLine} ${l.type === 'add' ? '+' : ' '} ${code.slice(0, 300)}`);
      }
    }
    const block = lines.join('\n');
    if (used + block.length > budgetChars) {
      truncated = true;
      break;
    }
    parts.push(block);
    included.push(f.path);
    used += block.length;
  }
  return { text: parts.join('\n\n'), includedFiles: included, truncated };
}
