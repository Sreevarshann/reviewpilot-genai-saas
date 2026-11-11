import { Controller, Get, Inject } from '@nestjs/common';
import { Redis } from 'ioredis';
import { Public } from '../auth/decorators.js';
import { CONFIG, type AppConfig } from '../config.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Get()
  async health(): Promise<Record<string, unknown>> {
    let database = false;
    let redis = false;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      database = true;
    } catch {
      database = false;
    }
    const client = new Redis(this.config.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 1500 });
    try {
      await client.connect();
      redis = (await client.ping()) === 'PONG';
    } catch {
      redis = false;
    } finally {
      client.disconnect();
    }
    return { status: database && redis ? 'ok' : 'degraded', database, redis, llmProvider: this.config.LLM_PROVIDER, model: this.config.LLM_MODEL };
  }
}
