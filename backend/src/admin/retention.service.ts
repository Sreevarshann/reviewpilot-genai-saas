import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { AuditService } from '../audit/audit.service.js';
import { CONFIG, type AppConfig } from '../config.js';
import { PrismaService } from '../prisma/prisma.service.js';

export const MAINTENANCE_QUEUE = 'maintenance';

@Injectable()
export class RetentionService implements OnModuleInit {
  private readonly log = new Logger('Retention');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @InjectQueue(MAINTENANCE_QUEUE) private readonly queue: Queue,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.config.NODE_ENV === 'test') return;
    // one scheduler across all instances (upsert is idempotent by scheduler id)
    await this.queue.upsertJobScheduler('retention-daily', { pattern: '17 3 * * *' }, { name: 'retention', opts: { removeOnComplete: 50, removeOnFail: 50 } });
  }

  /** Deletes reviews (and their files, findings, events by cascade) older than the org's retention. */
  async enforce(organizationId: string, actorId: string | null = null): Promise<number> {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { retentionDays: true } });
    const cutoff = new Date(Date.now() - org.retentionDays * 86_400_000);
    const r = await this.prisma.review.deleteMany({ where: { organizationId, createdAt: { lt: cutoff }, status: { in: ['COMPLETED', 'FAILED'] } } });
    if (r.count) await this.audit.record({ organizationId, actorId, action: 'retention.enforced', metadata: { deletedReviews: r.count, cutoff: cutoff.toISOString() } });
    return r.count;
  }

  async enforceAll(): Promise<number> {
    let total = 0;
    for (const o of await this.prisma.organization.findMany({ select: { id: true } })) total += await this.enforce(o.id);
    this.log.log(`retention removed ${total} reviews`);
    return total;
  }
}

@Processor(MAINTENANCE_QUEUE)
export class MaintenanceProcessor extends WorkerHost {
  constructor(private readonly retention: RetentionService) {
    super();
  }

  async process(): Promise<void> {
    await this.retention.enforceAll();
  }
}
