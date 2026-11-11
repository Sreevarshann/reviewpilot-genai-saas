import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Tenant } from '../tenancy/tenancy.js';

const n = (v: bigint | number | null | undefined): number => (v == null ? 0 : Number(v));
const rate = (num: number, den: number): number | null => (den === 0 ? null : Math.round((num / den) * 1000) / 1000);

/**
 * Organization analytics. Every figure is aggregated from persisted reviews, findings and
 * triage decisions inside the caller's tenant; nothing is estimated. "Acceptance rate" is the
 * share of *triaged* findings that a human accepted — it is a signal of usefulness, not a
 * measured precision, because untriaged findings are excluded.
 */
@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(t: Tenant, days: number, projectId?: string) {
    const org = t.organizationId;
    if (projectId && !(await this.prisma.project.findFirst({ where: { id: projectId, organizationId: org }, select: { id: true } }))) throw new NotFoundException({ error: 'not_found', message: 'Project not found' });
    const to = new Date();
    const from = new Date(to.getTime() - days * 86_400_000);
    const proj = projectId ? Prisma.sql`AND r."projectId" = ${projectId}` : Prisma.empty;
    const base = Prisma.sql`r."organizationId" = ${org} AND r."createdAt" >= ${from} ${proj}`;

    const [daily, latency, byCategory, bySeverity, triage, models, rules, projects] = await Promise.all([
      this.prisma.$queryRaw<{ day: Date; completed: bigint; failed: bigint; pending: bigint }[]>`
        SELECT date_trunc('day', r."createdAt") AS day,
          COUNT(*) FILTER (WHERE r.status = 'COMPLETED') AS completed,
          COUNT(*) FILTER (WHERE r.status = 'FAILED') AS failed,
          COUNT(*) FILTER (WHERE r.status IN ('QUEUED','RUNNING')) AS pending
        FROM "Review" r WHERE ${base} GROUP BY 1 ORDER BY 1`,
      this.prisma.$queryRaw<{ count: bigint; p50: number | null; p90: number | null; avg: number | null; max: number | null }[]>`
        SELECT COUNT(*) AS count,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY r."durationMs") AS p50,
          percentile_cont(0.9) WITHIN GROUP (ORDER BY r."durationMs") AS p90,
          AVG(r."durationMs")::float AS avg, MAX(r."durationMs") AS max
        FROM "Review" r WHERE ${base} AND r.status = 'COMPLETED' AND r."durationMs" IS NOT NULL`,
      this.prisma.$queryRaw<{ category: string; confidence: string; count: bigint }[]>`
        SELECT f.category::text, f.confidence::text, COUNT(*) AS count FROM "Finding" f JOIN "Review" r ON r.id = f."reviewId"
        WHERE ${base} GROUP BY 1, 2 ORDER BY 1, 2`,
      this.prisma.$queryRaw<{ severity: string; count: bigint }[]>`
        SELECT f.severity::text, COUNT(*) AS count FROM "Finding" f JOIN "Review" r ON r.id = f."reviewId"
        WHERE ${base} GROUP BY 1`,
      this.prisma.$queryRaw<{ confidence: string; state: string; count: bigint }[]>`
        SELECT f.confidence::text, f.state::text, COUNT(*) AS count FROM "Finding" f JOIN "Review" r ON r.id = f."reviewId"
        WHERE ${base} GROUP BY 1, 2`,
      this.prisma.$queryRaw<{ provider: string | null; model: string | null; reviews: bigint; tokens_in: bigint; tokens_out: bigint; avg_ms: number | null }[]>`
        SELECT r.provider, r.model, COUNT(*) AS reviews, SUM(r."tokensIn") AS tokens_in, SUM(r."tokensOut") AS tokens_out, AVG(r."durationMs")::float AS avg_ms
        FROM "Review" r WHERE ${base} AND r.status = 'COMPLETED' GROUP BY 1, 2 ORDER BY 3 DESC`,
      this.prisma.$queryRaw<{ source: string; count: bigint; accepted: bigint; rejected: bigint }[]>`
        SELECT f.source, COUNT(*) AS count,
          COUNT(*) FILTER (WHERE f.state = 'ACCEPTED') AS accepted,
          COUNT(*) FILTER (WHERE f.state IN ('DISMISSED','FALSE_POSITIVE')) AS rejected
        FROM "Finding" f JOIN "Review" r ON r.id = f."reviewId" WHERE ${base} GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 15`,
      this.prisma.$queryRaw<{ id: string; name: string; reviews: bigint; findings: bigint }[]>`
        SELECT p.id, p.name, COUNT(DISTINCT r.id) AS reviews, COUNT(f.id) AS findings
        FROM "Project" p JOIN "Review" r ON r."projectId" = p.id LEFT JOIN "Finding" f ON f."reviewId" = r.id
        WHERE ${base} GROUP BY 1, 2 ORDER BY 3 DESC`,
    ]);

    const triageBy = (conf?: string) => {
      const rows = triage.filter((r) => !conf || r.confidence === conf);
      const get = (s: string) => rows.filter((r) => r.state === s).reduce((a, r) => a + n(r.count), 0);
      const accepted = get('ACCEPTED');
      const dismissed = get('DISMISSED');
      const falsePositive = get('FALSE_POSITIVE');
      const open = get('OPEN');
      return { open, accepted, dismissed, falsePositive, triaged: accepted + dismissed + falsePositive, acceptanceRate: rate(accepted, accepted + dismissed + falsePositive) };
    };
    const l = latency[0];
    const totals = daily.reduce((a, d) => ({ completed: a.completed + n(d.completed), failed: a.failed + n(d.failed), pending: a.pending + n(d.pending) }), { completed: 0, failed: 0, pending: 0 });

    return {
      range: { from: from.toISOString(), to: to.toISOString(), days, projectId: projectId ?? null },
      reviews: { ...totals, total: totals.completed + totals.failed + totals.pending, failureRate: rate(totals.failed, totals.completed + totals.failed) },
      reviewsOverTime: daily.map((d) => ({ day: d.day.toISOString().slice(0, 10), completed: n(d.completed), failed: n(d.failed), pending: n(d.pending) })),
      latencyMs: { samples: n(l?.count), p50: l?.p50 ?? null, p90: l?.p90 ?? null, avg: l?.avg == null ? null : Math.round(l.avg), max: l?.max ?? null },
      findingsByCategory: byCategory.map((r) => ({ category: r.category, confidence: r.confidence, count: n(r.count) })),
      findingsBySeverity: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'].map((s) => ({ severity: s, count: n(bySeverity.find((r) => r.severity === s)?.count) })),
      triage: { all: triageBy(), deterministic: triageBy('DETERMINISTIC'), model: triageBy('MODEL'), note: 'acceptanceRate = accepted / triaged findings; untriaged findings are excluded, so this is not a precision measurement' },
      models: models.map((m) => ({ provider: m.provider, model: m.model, reviews: n(m.reviews), tokensIn: n(m.tokens_in), tokensOut: n(m.tokens_out), avgMs: m.avg_ms == null ? null : Math.round(m.avg_ms) })),
      topRules: rules.map((r) => ({ source: r.source, count: n(r.count), accepted: n(r.accepted), rejected: n(r.rejected) })),
      projects: projects.map((p) => ({ id: p.id, name: p.name, reviews: n(p.reviews), findings: n(p.findings) })),
    };
  }
}
