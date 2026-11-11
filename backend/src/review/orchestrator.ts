import { Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import type { Category, Severity } from '../generated/prisma/enums.js';
import { sha256 } from '../common/crypto.js';
import { CONFIG, type AppConfig } from '../config.js';
import { type LlmProvider, LlmFactory } from '../llm/llm.js';
import { PLANS } from '../billing/plans.js';
import { UsageService } from '../billing/usage.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { buildContext } from './context.js';
import { type DiffFile, parseDiff, visibleNewLines } from './diff.js';
import { ReviewEventsService } from './events.service.js';
import { REVIEW_SCHEMA, REVIEW_SYSTEM } from './prompts.js';
import { type RawFinding, runRules } from './rules.js';

const ModelFinding = z.object({
  path: z.string().max(500),
  line_start: z.number().int().positive(),
  line_end: z.number().int().positive().optional(),
  category: z.enum(['BUG', 'SECURITY', 'ERROR_HANDLING', 'PERFORMANCE', 'MAINTAINABILITY', 'TESTING', 'DOCUMENTATION']),
  severity: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']),
  title: z.string().min(3).max(160),
  description: z.string().min(3).max(2000),
  evidence: z.string().min(1).max(1000),
  suggested_fix: z.string().max(2000).optional(),
});

const SEVERITY_ORDER: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];
const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

export interface ValidationOutcome {
  accepted: RawFinding[];
  rejected: { reason: string; path?: string; line?: number; title?: string }[];
}

/** Every model finding must cite an existing file and visible lines, and quote code that
 * actually appears on those lines. Model severities are capped at HIGH. */
export function validateModelFindings(raw: unknown, files: DiffFile[]): ValidationOutcome {
  const out: ValidationOutcome = { accepted: [], rejected: [] };
  const list = (raw as { findings?: unknown })?.findings;
  if (!Array.isArray(list)) return { accepted: [], rejected: [{ reason: 'response had no findings array' }] };
  const byPath = new Map(files.map((f) => [f.path, f]));
  for (const item of list.slice(0, 30)) {
    const p = ModelFinding.safeParse(item);
    if (!p.success) {
      out.rejected.push({ reason: `schema: ${p.error.issues[0]?.path.join('.')} ${p.error.issues[0]?.message}` });
      continue;
    }
    const f = p.data;
    const file = byPath.get(f.path.replace(/^[ab]\//, ''));
    const end = f.line_end ?? f.line_start;
    if (!file) {
      out.rejected.push({ reason: 'file not in diff', path: f.path, line: f.line_start, title: f.title });
      continue;
    }
    const visible = visibleNewLines(file);
    if (end < f.line_start || end - f.line_start > 50 || !visible.has(f.line_start) || !visible.has(end)) {
      out.rejected.push({ reason: 'cited lines are not part of the diff', path: file.path, line: f.line_start, title: f.title });
      continue;
    }
    const code = file.hunks.flatMap((h) => h.lines).filter((l) => l.newLine !== null && l.newLine >= f.line_start && l.newLine <= end).map((l) => l.text).join('\n');
    if (!norm(code).includes(norm(f.evidence).replace(/^[+\s]+/, '').slice(0, 200))) {
      out.rejected.push({ reason: 'evidence does not match the cited lines', path: file.path, line: f.line_start, title: f.title });
      continue;
    }
    const severity: Severity = f.severity === 'CRITICAL' ? 'HIGH' : f.severity;
    out.accepted.push({ path: file.path, lineStart: f.line_start, lineEnd: end, category: f.category as Category, severity, title: f.title, description: f.description, evidence: f.evidence.slice(0, 300), suggestedFix: f.suggested_fix, confidence: 'MODEL', source: 'model' });
  }
  return out;
}

export function fingerprint(f: Pick<RawFinding, 'path' | 'lineStart' | 'category' | 'title'>): string {
  return sha256(`${f.path}|${f.lineStart}|${f.category}|${norm(f.title)}`).slice(0, 32);
}

/** Deterministic findings win over model findings on the same file/line/category. */
export function dedupe(findings: RawFinding[]): RawFinding[] {
  const seen = new Set<string>();
  const det = new Set(findings.filter((f) => f.confidence === 'DETERMINISTIC').map((f) => `${f.path}|${f.lineStart}|${f.category}`));
  const out: RawFinding[] = [];
  for (const f of [...findings].sort((a, b) => (a.confidence === b.confidence ? 0 : a.confidence === 'DETERMINISTIC' ? -1 : 1))) {
    const key = fingerprint(f);
    if (seen.has(key)) continue;
    if (f.confidence === 'MODEL' && det.has(`${f.path}|${f.lineStart}|${f.category}`)) continue;
    seen.add(key);
    out.push(f);
  }
  return out.sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) || a.path.localeCompare(b.path) || a.lineStart - b.lineStart);
}

@Injectable()
export class ReviewOrchestrator {
  private readonly log = new Logger('ReviewOrchestrator');

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: ReviewEventsService,
    private readonly llmFactory: LlmFactory,
    private readonly usage: UsageService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  llm(): LlmProvider {
    return this.llmFactory.create();
  }

  async run(reviewId: string, llm: LlmProvider = this.llm()): Promise<void> {
    const t0 = Date.now();
    const review = await this.prisma.review.findUnique({ where: { id: reviewId } });
    if (!review || review.status !== 'QUEUED') return; // idempotent: only queued reviews run
    await this.prisma.review.update({ where: { id: reviewId }, data: { status: 'RUNNING', startedAt: new Date(), provider: llm.name, model: llm.model } });
    try {
      await this.events.emit(reviewId, 'parsing', 'started');
      const diff = parseDiff(review.diff);
      await this.prisma.reviewFile.createMany({ data: diff.files.map((f) => ({ reviewId, path: f.path, oldPath: f.oldPath, language: f.language, status: f.status, additions: f.additions, deletions: f.deletions, hunks: f.hunks as unknown as object })) });
      const fileIds = new Map((await this.prisma.reviewFile.findMany({ where: { reviewId }, select: { id: true, path: true } })).map((f) => [f.path, f.id]));
      await this.events.emit(reviewId, 'parsing', 'completed', { files: diff.files.length, additions: diff.additions, deletions: diff.deletions, languages: [...new Set(diff.files.map((f) => f.language))] });

      await this.events.emit(reviewId, 'static_checks', 'started');
      const deterministic = runRules(diff.files);
      await this.events.emit(reviewId, 'static_checks', 'completed', { findings: deterministic.length });

      await this.events.emit(reviewId, 'model_analysis', 'started', { provider: llm.name, model: llm.model });
      const ctx = buildContext(diff.files);
      let modelOutcome: ValidationOutcome = { accepted: [], rejected: [] };
      let tokensIn = 0;
      let tokensOut = 0;
      let modelError: string | null = null;
      const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: review.organizationId }, select: { plan: true } });
      const budget = PLANS[org.plan].llmTokensPerMonth - (await this.usage.tokensThisMonth(review.organizationId));
      if (ctx.text && budget <= 0) modelError = 'Monthly LLM token budget exhausted; deterministic checks only';
      else if (ctx.text) {
        try {
          const res = await llm.completeJson(REVIEW_SYSTEM, ctx.text, REVIEW_SCHEMA);
          tokensIn = res.tokensIn;
          tokensOut = res.tokensOut;
          modelOutcome = validateModelFindings(res.json, diff.files);
        } catch (e) {
          modelError = (e as Error).message.slice(0, 200);
          this.log.warn(`model analysis failed for ${reviewId}: ${modelError}`);
        }
      }
      await this.events.emit(reviewId, 'model_analysis', modelError ? 'degraded' : 'completed', { suggestions: modelOutcome.accepted.length + modelOutcome.rejected.length, error: modelError, contextTruncated: ctx.truncated });

      await this.events.emit(reviewId, 'validation', 'started');
      const final = dedupe([...deterministic, ...modelOutcome.accepted]);
      await this.events.emit(reviewId, 'validation', 'completed', { accepted: modelOutcome.accepted.length, rejected: modelOutcome.rejected.length, rejectedReasons: modelOutcome.rejected.slice(0, 20), final: final.length });

      const bySeverity = Object.fromEntries(SEVERITY_ORDER.map((s) => [s, final.filter((f) => f.severity === s).length]));
      const durationMs = Date.now() - t0;
      await this.prisma.$transaction([
        this.prisma.finding.createMany({ data: final.map((f) => ({ organizationId: review.organizationId, reviewId, fileId: fileIds.get(f.path) ?? null, path: f.path, lineStart: f.lineStart, lineEnd: f.lineEnd, category: f.category, severity: f.severity, title: f.title, description: f.description, evidence: f.evidence, suggestedFix: f.suggestedFix, confidence: f.confidence, source: f.source, fingerprint: fingerprint(f) })) }),
        this.prisma.review.update({ where: { id: reviewId }, data: { status: 'COMPLETED', completedAt: new Date(), durationMs, tokensIn, tokensOut, stats: { files: diff.files.length, additions: diff.additions, deletions: diff.deletions, bySeverity, deterministic: deterministic.length, modelAccepted: modelOutcome.accepted.length, modelRejected: modelOutcome.rejected.length, modelError, contextTruncated: ctx.truncated } } }),
        this.prisma.usageRecord.createMany({ data: [
          { organizationId: review.organizationId, reviewId, kind: 'review', quantity: 1, provider: llm.name, model: llm.model },
          { organizationId: review.organizationId, reviewId, kind: 'llm_tokens', quantity: tokensIn + tokensOut, provider: llm.name, model: llm.model },
          { organizationId: review.organizationId, reviewId, kind: 'review_ms', quantity: durationMs, provider: llm.name, model: llm.model },
        ] }),
      ]);
      await this.events.emit(reviewId, 'completed', 'completed', { findings: final.length, bySeverity, durationMs });
    } catch (e) {
      const message = (e as Error).name === 'DiffError' ? (e as Error).message : 'Review failed unexpectedly';
      if ((e as Error).name !== 'DiffError') this.log.error(`review ${reviewId} failed`, (e as Error).stack);
      await this.prisma.review.update({ where: { id: reviewId }, data: { status: 'FAILED', error: message, completedAt: new Date(), durationMs: Date.now() - t0 } });
      await this.events.emit(reviewId, 'failed', 'failed', { error: message });
    }
  }
}
