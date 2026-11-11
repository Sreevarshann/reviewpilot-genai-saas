import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import type { Prisma } from '../generated/prisma/client.js';
import { CONFIG, type AppConfig } from '../config.js';
import { PrismaService } from '../prisma/prisma.service.js';

export const channel = (reviewId: string) => `reviewpilot:review:${reviewId}`;
export const TERMINAL = new Set(['completed', 'failed']);

/** Review progress events: persisted (replayable) and published on Redis for live streams. */
@Injectable()
export class ReviewEventsService implements OnModuleDestroy {
  private readonly pub: Redis;
  private seq = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CONFIG) config: AppConfig,
  ) {
    this.pub = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2, lazyConnect: false });
  }

  async emit(reviewId: string, stage: string, status: string, detail: Prisma.InputJsonValue = {}): Promise<void> {
    const next = (this.seq.get(reviewId) ?? (await this.prisma.reviewEvent.count({ where: { reviewId } }))) + 1;
    this.seq.set(reviewId, next);
    const e = await this.prisma.reviewEvent.create({ data: { reviewId, seq: next, stage, status, detail } });
    await this.pub.publish(channel(reviewId), JSON.stringify({ seq: e.seq, stage, status, detail, at: e.createdAt })).catch(() => 0);
    if (TERMINAL.has(stage)) this.seq.delete(reviewId);
  }

  onModuleDestroy(): void {
    this.pub.disconnect();
  }
}
