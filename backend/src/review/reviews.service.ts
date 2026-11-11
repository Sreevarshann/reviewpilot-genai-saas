import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { Prisma } from '../../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import { PLANS } from '../billing/plans.js';
import { sha256 } from '../common/crypto.js';
import { CONFIG, type AppConfig } from '../config.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Tenant } from '../tenancy/tenancy.js';
import { DiffError, parseDiff } from './diff.js';
import { ReviewOrchestrator } from './orchestrator.js';

export const REVIEW_QUEUE = 'reviews';
export const IDEMPOTENCY_KEY = /^[\w-]{8,100}$/;

export function assertIdempotencyKey(key: string | undefined): void {
  if (key !== undefined && !IDEMPOTENCY_KEY.test(key)) throw new BadRequestException({ error: 'invalid_idempotency_key', message: 'Idempotency-Key must be 8-100 characters of [A-Za-z0-9_-]' });
}

export function monthStart(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orchestrator: ReviewOrchestrator,
    private readonly audit: AuditService,
    @InjectQueue(REVIEW_QUEUE) private readonly queue: Queue,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  /** A replay must carry the same request; otherwise the key is being reused for a different submission. */
  private async replay(t: Tenant, key: string, input: { projectId: string; title: string; diff: string }) {
    const existing = await this.prisma.review.findUnique({ where: { organizationId_idempotencyKey: { organizationId: t.organizationId, idempotencyKey: key } } });
    if (!existing) return null;
    if (existing.projectId !== input.projectId || existing.title !== input.title || existing.diffSha256 !== sha256(input.diff)) {
      throw new ConflictException({ error: 'idempotency_conflict', message: 'This Idempotency-Key was already used for a different request' });
    }
    return { review: await this.get(t, existing.id), replayed: true };
  }

  async submit(t: Tenant, input: { projectId: string; title: string; diff: string }, idempotencyKey?: string, parentReviewId?: string, version = 1) {
    // Validate the key before ANY database access or side effect.
    assertIdempotencyKey(idempotencyKey);
    if (idempotencyKey) {
      const replayed = await this.replay(t, idempotencyKey, input);
      if (replayed) return replayed;
    }
    const project = await this.prisma.project.findFirst({ where: { id: input.projectId, organizationId: t.organizationId } });
    if (!project) throw new NotFoundException({ error: 'not_found', message: 'Project not found' });
    const plan = PLANS[t.plan];
    const bytes = Buffer.byteLength(input.diff);
    if (bytes > plan.maxDiffBytes) throw new PayloadTooLargeException({ error: 'plan_limit', limit: 'diff_size', message: `Diffs are limited to ${Math.round(plan.maxDiffBytes / 1000)} KB on the ${plan.label} plan` });
    try {
      parseDiff(input.diff);
    } catch (e) {
      if (e instanceof DiffError) throw new BadRequestException({ error: 'invalid_diff', message: e.message });
      throw e;
    }
    const used = await this.prisma.review.count({ where: { organizationId: t.organizationId, createdAt: { gte: monthStart() }, status: { not: 'FAILED' } } });
    if (used >= plan.reviewsPerMonth) throw new ForbiddenException({ error: 'plan_limit', limit: 'reviews_per_month', message: `The ${plan.label} plan includes ${plan.reviewsPerMonth} reviews per month`, used });
    let review;
    try {
      review = await this.prisma.review.create({ data: { organizationId: t.organizationId, projectId: project.id, authorId: t.userId ?? 'api-token', title: input.title, diff: input.diff, diffSha256: sha256(input.diff), idempotencyKey, parentReviewId, version } });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002' && idempotencyKey) {
        // Lost a concurrent race on the unique (organizationId, idempotencyKey) index.
        const replayed = await this.replay(t, idempotencyKey, input);
        if (replayed) return replayed;
      }
      throw e;
    }
    await this.audit.record({ organizationId: t.organizationId, actorId: t.userId, action: 'review.submitted', targetType: 'review', targetId: review.id, metadata: { projectId: project.id, bytes, via: t.via } });
    if (this.config.REVIEW_INLINE) await this.orchestrator.run(review.id);
    else await this.queue.add('review', { reviewId: review.id }, { jobId: review.id, attempts: 2, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: 1000, removeOnFail: 1000 });
    return { review: await this.get(t, review.id), replayed: false };
  }

  async rerun(t: Tenant, id: string) {
    const prev = await this.prisma.review.findFirst({ where: { id, organizationId: t.organizationId } });
    if (!prev) throw new NotFoundException({ error: 'not_found', message: 'Review not found' });
    const root = prev.parentReviewId ?? prev.id;
    const latest = await this.prisma.review.aggregate({ where: { organizationId: t.organizationId, OR: [{ id: root }, { parentReviewId: root }] }, _max: { version: true } });
    return this.submit(t, { projectId: prev.projectId, title: prev.title, diff: prev.diff }, undefined, root, (latest._max.version ?? 1) + 1);
  }

  list(t: Tenant, q: { projectId?: string; status?: string; take: number }) {
    const where: Prisma.ReviewWhereInput = { organizationId: t.organizationId };
    if (q.projectId) where.projectId = q.projectId;
    if (q.status) where.status = q.status as Prisma.ReviewWhereInput['status'];
    return this.prisma.review.findMany({ where, orderBy: { createdAt: 'desc' }, take: q.take, select: { id: true, title: true, status: true, version: true, parentReviewId: true, projectId: true, project: { select: { name: true } }, stats: true, provider: true, model: true, durationMs: true, createdAt: true, completedAt: true, _count: { select: { findings: true } } } });
  }

  async get(t: Tenant, id: string) {
    const r = await this.prisma.review.findFirst({
      where: { id, organizationId: t.organizationId },
      select: { id: true, title: true, status: true, version: true, parentReviewId: true, projectId: true, project: { select: { name: true } }, authorId: true, stats: true, provider: true, model: true, tokensIn: true, tokensOut: true, durationMs: true, error: true, createdAt: true, startedAt: true, completedAt: true, files: { select: { id: true, path: true, oldPath: true, language: true, status: true, additions: true, deletions: true, hunks: true } } },
    });
    if (!r) throw new NotFoundException({ error: 'not_found', message: 'Review not found' });
    return r;
  }

  async diff(t: Tenant, id: string): Promise<string> {
    const r = await this.prisma.review.findFirst({ where: { id, organizationId: t.organizationId }, select: { diff: true } });
    if (!r) throw new NotFoundException({ error: 'not_found', message: 'Review not found' });
    return r.diff;
  }

  async findings(t: Tenant, id: string, q: { severity?: string; state?: string; confidence?: string }) {
    await this.get(t, id);
    const where: Prisma.FindingWhereInput = { organizationId: t.organizationId, reviewId: id };
    if (q.severity) where.severity = q.severity as Prisma.FindingWhereInput['severity'];
    if (q.state) where.state = q.state as Prisma.FindingWhereInput['state'];
    if (q.confidence) where.confidence = q.confidence as Prisma.FindingWhereInput['confidence'];
    return this.prisma.finding.findMany({ where, orderBy: [{ severity: 'asc' }, { path: 'asc' }, { lineStart: 'asc' }], include: { comments: { orderBy: { createdAt: 'asc' } } } });
  }

  async events(t: Tenant, id: string, afterSeq = 0) {
    await this.get(t, id);
    return this.prisma.reviewEvent.findMany({ where: { reviewId: id, seq: { gt: afterSeq } }, orderBy: { seq: 'asc' } });
  }

  async status(t: Tenant, id: string) {
    const r = await this.prisma.review.findFirst({ where: { id, organizationId: t.organizationId }, select: { status: true } });
    return r?.status;
  }
}
