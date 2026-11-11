import { Injectable, NotFoundException } from '@nestjs/common';
import type { FindingState } from '../generated/prisma/enums.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Tenant } from '../tenancy/tenancy.js';

const CSV_COLUMNS = ['severity', 'category', 'confidence', 'state', 'path', 'lineStart', 'lineEnd', 'title', 'description', 'evidence', 'suggestedFix', 'source'] as const;

function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // neutralise spreadsheet formula injection
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const SARIF_LEVEL: Record<string, string> = { CRITICAL: 'error', HIGH: 'error', MEDIUM: 'warning', LOW: 'note', INFO: 'note' };

@Injectable()
export class FindingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async load(t: Tenant, id: string) {
    const f = await this.prisma.finding.findFirst({ where: { id, organizationId: t.organizationId } });
    if (!f) throw new NotFoundException({ error: 'not_found', message: 'Finding not found' });
    return f;
  }

  async setState(t: Tenant, id: string, state: FindingState, note?: string) {
    const f = await this.load(t, id);
    const updated = await this.prisma.finding.update({ where: { id: f.id }, data: { state, stateChangedBy: t.userId, stateChangedAt: new Date() } });
    if (note) await this.prisma.findingComment.create({ data: { organizationId: t.organizationId, findingId: f.id, authorId: t.userId ?? 'api-token', body: note } });
    await this.audit.record({ organizationId: t.organizationId, actorId: t.userId, action: 'finding.state_changed', targetType: 'finding', targetId: f.id, metadata: { from: f.state, to: state, reviewId: f.reviewId } });
    return updated;
  }

  async comment(t: Tenant, id: string, body: string) {
    const f = await this.load(t, id);
    return this.prisma.findingComment.create({ data: { organizationId: t.organizationId, findingId: f.id, authorId: t.userId ?? 'api-token', body } });
  }

  /** Compare two versions of a review by finding fingerprint (path, line, category, title). */
  async compare(t: Tenant, baseId: string, headId: string) {
    const [base, head] = await Promise.all([baseId, headId].map((id) => this.prisma.review.findFirst({ where: { id, organizationId: t.organizationId }, select: { id: true, version: true, findings: true } })));
    if (!base || !head) throw new NotFoundException({ error: 'not_found', message: 'Review not found' });
    const b = new Map(base.findings.map((f) => [f.fingerprint, f]));
    const h = new Map(head.findings.map((f) => [f.fingerprint, f]));
    return {
      base: { id: base.id, version: base.version },
      head: { id: head.id, version: head.version },
      introduced: head.findings.filter((f) => !b.has(f.fingerprint)),
      resolved: base.findings.filter((f) => !h.has(f.fingerprint)),
      persisting: head.findings.filter((f) => b.has(f.fingerprint)),
    };
  }

  async export(t: Tenant, reviewId: string, format: 'json' | 'csv' | 'md' | 'sarif'): Promise<{ body: string; type: string; ext: string }> {
    const review = await this.prisma.review.findFirst({ where: { id: reviewId, organizationId: t.organizationId }, include: { findings: { orderBy: [{ severity: 'asc' }, { path: 'asc' }, { lineStart: 'asc' }] }, project: { select: { name: true } } } });
    if (!review) throw new NotFoundException({ error: 'not_found', message: 'Review not found' });
    const fs = review.findings;
    if (format === 'json') return { body: JSON.stringify({ review: { id: review.id, title: review.title, version: review.version, project: review.project.name, model: review.model, completedAt: review.completedAt }, findings: fs }, null, 2), type: 'application/json', ext: 'json' };
    if (format === 'csv') return { body: [CSV_COLUMNS.join(','), ...fs.map((f) => CSV_COLUMNS.map((c) => csvCell(f[c])).join(','))].join('\n') + '\n', type: 'text/csv; charset=utf-8', ext: 'csv' };
    if (format === 'sarif') {
      return {
        type: 'application/sarif+json',
        ext: 'sarif',
        body: JSON.stringify({
          $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
          version: '2.1.0',
          runs: [{
            tool: { driver: { name: 'ReviewPilot', informationUri: 'https://github.com/Sreevarshann/reviewpilot-genai-saas', rules: [...new Set(fs.map((f) => f.source))].map((id) => ({ id })) } },
            results: fs.map((f) => ({ ruleId: f.source, level: SARIF_LEVEL[f.severity], message: { text: `${f.title}: ${f.description}` }, locations: [{ physicalLocation: { artifactLocation: { uri: f.path }, region: { startLine: f.lineStart, endLine: f.lineEnd } } }], properties: { category: f.category, confidence: f.confidence, state: f.state } })),
          }],
        }, null, 2),
      };
    }
    const lines = [`# Review: ${review.title} (v${review.version})`, '', `Project: ${review.project.name} · Model: ${review.model ?? 'n/a'} · ${fs.length} findings`, '', '> Suggested fixes are suggestions, not verified patches. MODEL findings are machine-generated and unverified.', ''];
    for (const f of fs) lines.push(`## [${f.severity}] ${f.title}`, '', `\`${f.path}:${f.lineStart}\` · ${f.category} · ${f.confidence} · ${f.state}`, '', f.description, '', '```', f.evidence, '```', ...(f.suggestedFix ? ['', `**Suggested fix:** ${f.suggestedFix}`] : []), '');
    return { body: lines.join('\n'), type: 'text/markdown; charset=utf-8', ext: 'md' };
  }
}
