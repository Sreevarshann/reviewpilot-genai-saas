import { ConflictException, Injectable } from '@nestjs/common';
import type { Plan } from '../generated/prisma/enums.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { monthStart } from '../common/period.js';
import type { Tenant } from '../tenancy/tenancy.js';
import { PLANS } from './plans.js';

@Injectable()
export class UsageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async tokensThisMonth(orgId: string): Promise<number> {
    const r = await this.prisma.usageRecord.aggregate({ where: { organizationId: orgId, kind: 'llm_tokens', createdAt: { gte: monthStart() } }, _sum: { quantity: true } });
    return r._sum.quantity ?? 0;
  }

  /** Current-period usage against plan limits; every number comes from persisted records. */
  async summary(t: Tenant) {
    const since = monthStart();
    const limits = PLANS[t.plan];
    const [reviews, tokens, ms, members, projects, byModel, daily] = await Promise.all([
      this.prisma.review.count({ where: { organizationId: t.organizationId, createdAt: { gte: since }, status: { not: 'FAILED' } } }),
      this.tokensThisMonth(t.organizationId),
      this.prisma.usageRecord.aggregate({ where: { organizationId: t.organizationId, kind: 'review_ms', createdAt: { gte: since } }, _sum: { quantity: true }, _avg: { quantity: true } }),
      this.prisma.membership.count({ where: { organizationId: t.organizationId } }),
      this.prisma.project.count({ where: { organizationId: t.organizationId } }),
      this.prisma.usageRecord.groupBy({ by: ['provider', 'model'], where: { organizationId: t.organizationId, kind: 'llm_tokens', createdAt: { gte: since } }, _sum: { quantity: true }, _count: true }),
      this.prisma.$queryRaw<{ day: Date; reviews: bigint; tokens: bigint }[]>`
        SELECT date_trunc('day', "createdAt") AS day,
               SUM(CASE WHEN kind = 'review' THEN quantity ELSE 0 END) AS reviews,
               SUM(CASE WHEN kind = 'llm_tokens' THEN quantity ELSE 0 END) AS tokens
        FROM "UsageRecord" WHERE "organizationId" = ${t.organizationId} AND "createdAt" >= ${since}
        GROUP BY 1 ORDER BY 1`,
    ]);
    return {
      plan: t.plan,
      planLabel: limits.label,
      period: { start: since.toISOString() },
      reviews: { used: reviews, limit: limits.reviewsPerMonth },
      llmTokens: { used: tokens, limit: limits.llmTokensPerMonth },
      processing: { totalMs: ms._sum.quantity ?? 0, avgMs: Math.round(ms._avg.quantity ?? 0) },
      seats: { used: members, limit: limits.seats },
      projects: { used: projects, limit: limits.projects },
      maxDiffBytes: limits.maxDiffBytes,
      byModel: byModel.map((m) => ({ provider: m.provider, model: m.model, tokens: m._sum.quantity ?? 0, reviews: m._count })),
      daily: daily.map((d) => ({ day: d.day.toISOString().slice(0, 10), reviews: Number(d.reviews), tokens: Number(d.tokens) })),
    };
  }

  /**
   * MOCK billing provider: changes the plan immediately without charging anything and records
   * provider "mock". No payment method is collected and no payment is ever claimed.
   */
  async changePlan(t: Tenant, plan: Plan) {
    const target = PLANS[plan];
    const [members, projects] = await Promise.all([this.prisma.membership.count({ where: { organizationId: t.organizationId } }), this.prisma.project.count({ where: { organizationId: t.organizationId } })]);
    const blockers = [members > target.seats && `${members} members exceed ${target.seats} seats`, projects > target.projects && `${projects} projects exceed ${target.projects}`].filter(Boolean);
    if (blockers.length) throw new ConflictException({ error: 'downgrade_blocked', message: `Cannot switch to ${target.label}: ${blockers.join('; ')}` });
    await this.prisma.organization.update({ where: { id: t.organizationId }, data: { plan } });
    await this.audit.record({ organizationId: t.organizationId, actorId: t.userId, action: 'billing.plan_changed', metadata: { from: t.plan, to: plan, provider: 'mock', charged: false } });
    return { plan, provider: 'mock', charged: false, note: 'Demo plan change. No payment provider is configured and nothing was charged.' };
  }
}
